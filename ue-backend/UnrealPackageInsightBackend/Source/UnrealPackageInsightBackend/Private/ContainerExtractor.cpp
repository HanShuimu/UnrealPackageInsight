#include "ContainerExtractor.h"

#include "CoreGlobals.h"
#include "HAL/CriticalSection.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "HAL/PlatformFileManager.h"
#include "IO/IoStore.h"
#include "IPlatformFilePak.h"
#include "Misc/AES.h"
#include "Misc/Base64.h"
#include "Misc/CommandLine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/CoreDelegates.h"
#include "Misc/EncryptionKeyManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Misc/KeyChainUtilities.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "Serialization/Archive.h"
#include "Templates/RefCounting.h"
#include "Templates/UniquePtr.h"
#include "PakFileUtilities.h"
#include "IoStoreUtilities.h"

namespace
{
	FCriticalSection GUpiExtractPakRuntimeInitCriticalSection;

	void UPI_EnsureMinimalUnrealRuntimeForPak()
	{
		FScopeLock Lock(&GUpiExtractPakRuntimeInitCriticalSection);

		if (!FCommandLine::IsInitialized())
		{
			FCommandLine::Set(TEXT(""));
		}

		if (GConfig == nullptr)
		{
			FConfigCacheIni::InitializeConfigSystem();
		}
	}

	int32 UPI_HexValue(TCHAR Char)
	{
		if (Char >= TEXT('0') && Char <= TEXT('9'))
		{
			return Char - TEXT('0');
		}
		if (Char >= TEXT('a') && Char <= TEXT('f'))
		{
			return Char - TEXT('a') + 10;
		}
		if (Char >= TEXT('A') && Char <= TEXT('F'))
		{
			return Char - TEXT('A') + 10;
		}
		return -1;
	}

	bool UPI_ParseOptionalAesKey(const FString& AesKey, FAES::FAESKey& OutKey, bool& bOutHasKey)
	{
		OutKey.Reset();
		bOutHasKey = false;

		FString Hex = AesKey.TrimStartAndEnd();
		if (Hex.IsEmpty())
		{
			return true;
		}

		if (Hex.StartsWith(TEXT("0x"), ESearchCase::IgnoreCase))
		{
			Hex.RightChopInline(2, EAllowShrinking::No);
		}

		const int32 KeyByteCount = Hex.Len() / 2;
		if (Hex.Len() % 2 != 0 || (KeyByteCount != 16 && KeyByteCount != FAES::FAESKey::KeySize))
		{
			return false;
		}

		for (int32 Index = 0; Index < KeyByteCount; ++Index)
		{
			const int32 High = UPI_HexValue(Hex[Index * 2]);
			const int32 Low = UPI_HexValue(Hex[Index * 2 + 1]);
			if (High < 0 || Low < 0)
			{
				return false;
			}

			OutKey.Key[Index] = static_cast<uint8>((High << 4) | Low);
		}

		bOutHasKey = true;
		return true;
	}

	FString UPI_NormalizeFilename(FString Path)
	{
		Path.ReplaceInline(TEXT("\\"), TEXT("/"));
		FPaths::NormalizeFilename(Path);
		return Path;
	}

	bool UPI_IsIoStoreDataExtension(const FString& Extension)
	{
		return Extension.Equals(TEXT("utoc"), ESearchCase::IgnoreCase) ||
			Extension.Equals(TEXT("ucas"), ESearchCase::IgnoreCase);
	}

	FString UPI_StripUcasPartitionSuffix(FString BaseFilename)
	{
		const int32 SuffixIndex = BaseFilename.Find(TEXT("_s"), ESearchCase::IgnoreCase, ESearchDir::FromEnd);
		if (SuffixIndex == INDEX_NONE)
		{
			return BaseFilename;
		}

		for (int32 Index = SuffixIndex + 2; Index < BaseFilename.Len(); ++Index)
		{
			if (!FChar::IsDigit(BaseFilename[Index]))
			{
				return BaseFilename;
			}
		}

		return BaseFilename.Left(SuffixIndex);
	}

	FString UPI_BasePathFromIoStorePath(const FString& Path)
	{
		FString NormalizedPath = UPI_NormalizeFilename(Path);
		const FString Extension = FPaths::GetExtension(NormalizedPath);
		if (!UPI_IsIoStoreDataExtension(Extension))
		{
			return NormalizedPath;
		}

		const FString Directory = FPaths::GetPath(NormalizedPath);
		const FString BaseFilename = FPaths::GetBaseFilename(NormalizedPath);
		const FString ContainerBaseFilename = Extension.Equals(TEXT("ucas"), ESearchCase::IgnoreCase)
			? UPI_StripUcasPartitionSuffix(BaseFilename)
			: BaseFilename;

		return Directory.IsEmpty() ? ContainerBaseFilename : Directory / ContainerBaseFilename;
	}

	FString UPI_ResolveIoStorePaths(const FString& UtocPath, const FString& UcasPath)
	{
		const FString PreferredPath = !UtocPath.IsEmpty() ? UtocPath : UcasPath;
		const FString BasePath = UPI_BasePathFromIoStorePath(PreferredPath);
		return BasePath.IsEmpty() ? FString() : BasePath + TEXT(".utoc");
	}

	bool UPI_ReadTocHeader(const FString& UtocPath, FIoStoreTocHeader& OutHeader)
	{
		TUniquePtr<FArchive> Reader(IFileManager::Get().CreateFileReader(*UtocPath));
		if (!Reader.IsValid() || Reader->TotalSize() < static_cast<int64>(sizeof(FIoStoreTocHeader)))
		{
			return false;
		}

		Reader->Serialize(&OutHeader, sizeof(FIoStoreTocHeader));
		return !Reader->IsError() && OutHeader.CheckMagic();
	}

	bool UPI_EnsureOutputDirectory(const FString& OutputDirectory)
	{
		if (OutputDirectory.IsEmpty())
		{
			return false;
		}

		IFileManager& FileManager = IFileManager::Get();
		return FileManager.MakeDirectory(*OutputDirectory, true) && FileManager.DirectoryExists(*OutputDirectory);
	}

	bool UPI_CanCreateFile(const FString& Filename)
	{
		TUniquePtr<FArchive> Writer(IFileManager::Get().CreateFileWriter(*Filename));
		const bool bCanCreate = Writer.IsValid() && !Writer->IsError();
		Writer.Reset();
		IFileManager::Get().Delete(*Filename, false, true);
		return bCanCreate;
	}

	FString UPI_CreateTemporaryPakCryptoKeysFile(const FAES::FAESKey& Key, const FGuid& EncryptionKeyGuid)
	{
		const FString TempFilename = FPaths::CreateTempFilename(FPlatformProcess::UserTempDir(), TEXT("upi-cryptokeys-"), TEXT(".json"));
		const FString KeyBase64 = FBase64::Encode(Key.Key, FAES::FAESKey::KeySize);
		const FString SecondaryEncryptionKeys = EncryptionKeyGuid.IsValid()
			? FString::Printf(
				TEXT("\n")
				TEXT("    {\n")
				TEXT("      \"Name\": \"Container\",\n")
				TEXT("      \"Guid\": \"%s\",\n")
				TEXT("      \"Key\": \"%s\"\n")
				TEXT("    }\n")
				TEXT("  "),
				*EncryptionKeyGuid.ToString(EGuidFormats::Digits),
				*KeyBase64)
			: FString();
		const FString Contents = FString::Printf(
			TEXT("{\n")
			TEXT("  \"EncryptionKey\": {\n")
			TEXT("    \"Name\": \"Default\",\n")
			TEXT("    \"Guid\": \"00000000000000000000000000000000\",\n")
			TEXT("    \"Key\": \"%s\"\n")
			TEXT("  },\n")
			TEXT("  \"SecondaryEncryptionKeys\": [%s]\n")
			TEXT("}\n"),
			*KeyBase64,
			*SecondaryEncryptionKeys);

		return FFileHelper::SaveStringToFile(Contents, *TempFilename) ? TempFilename : FString();
	}

	FString UPI_QuoteCommandPath(const FString& Path)
	{
		return FString::Printf(TEXT("\"%s\""), *Path);
	}

	uint32 UPI_CountLinesInFile(const FString& Filename)
	{
		TArray<FString> Lines;
		if (!FFileHelper::LoadFileToStringArray(Lines, *Filename))
		{
			return 0;
		}

		return static_cast<uint32>(Lines.Num());
	}

	bool UPI_ReadPakIndexData(const FString& PakPath, const FPakInfo& PakInfo, TArray<uint8>& OutIndexData)
	{
		if (PakInfo.IndexOffset < 0 || PakInfo.IndexSize <= 0 || PakInfo.IndexSize > static_cast<int64>(MAX_int32))
		{
			return false;
		}

		TUniquePtr<FArchive> Reader(IFileManager::Get().CreateFileReader(*PakPath));
		if (!Reader.IsValid())
		{
			return false;
		}

		const int64 TotalSize = Reader->TotalSize();
		if (PakInfo.IndexOffset > TotalSize || PakInfo.IndexSize > TotalSize - PakInfo.IndexOffset)
		{
			return false;
		}

		Reader->Seek(PakInfo.IndexOffset);
		OutIndexData.SetNum(static_cast<int32>(PakInfo.IndexSize));
		Reader->Serialize(OutIndexData.GetData(), PakInfo.IndexSize);
		return !Reader->IsError();
	}

	bool UPI_CanDecryptPakIndexWithKey(const FString& PakPath, const FPakInfo& PakInfo, const FAES::FAESKey& Key)
	{
		TArray<uint8> IndexData;
		if (!UPI_ReadPakIndexData(PakPath, PakInfo, IndexData))
		{
			return false;
		}

		FAES::DecryptData(IndexData.GetData(), IndexData.Num(), Key);

		FSHAHash ComputedHash;
		FSHA1::HashBuffer(IndexData.GetData(), IndexData.Num(), ComputedHash.Hash);
		return ComputedHash == PakInfo.IndexHash;
	}

	void UPI_RegisterPakRuntimeKey(const FGuid& EncryptionKeyGuid, const FAES::FAESKey& Key)
	{
		if (EncryptionKeyGuid.IsValid())
		{
			UE::FEncryptionKeyManager::Get().AddKey(EncryptionKeyGuid, Key);
			return;
		}

		FCoreDelegates::GetPakEncryptionKeyDelegate().BindLambda([Key](uint8 OutKey[FAES::FAESKey::KeySize])
		{
			FMemory::Memcpy(OutKey, Key.Key, FAES::FAESKey::KeySize);
		});
	}

	bool UPI_PreflightPakForExtraction(const FString& PakPath, const FAES::FAESKey& ParsedKey, bool bHasKey, FGuid& OutEncryptionKeyGuid)
	{
		UPI_EnsureMinimalUnrealRuntimeForPak();

		IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();
		TRefCountPtr<FPakFile> TrailerOnlyPak = MakeRefCount<FPakFile>(&PlatformFile, *PakPath, false, false);
		if (!TrailerOnlyPak.IsValid() || !TrailerOnlyPak->IsValid())
		{
			return false;
		}

		const FPakInfo& TrailerInfo = TrailerOnlyPak->GetInfo();
		OutEncryptionKeyGuid = TrailerInfo.EncryptionKeyGuid;
		if (bHasKey)
		{
			UPI_RegisterPakRuntimeKey(TrailerInfo.EncryptionKeyGuid, ParsedKey);
		}

		if (TrailerInfo.bEncryptedIndex != 0)
		{
			return bHasKey && UPI_CanDecryptPakIndexWithKey(PakPath, TrailerInfo, ParsedKey);
		}

		TRefCountPtr<FPakFile> PakFile = MakeRefCount<FPakFile>(&PlatformFile, *PakPath, false, true);
		if (!PakFile.IsValid() || !PakFile->IsValid())
		{
			return false;
		}

		for (FPakFile::FPakEntryIterator It(*PakFile, true); It; ++It)
		{
			const FPakEntry& Entry = It.Info();
			if (Entry.IsEncrypted() && !bHasKey)
			{
				return false;
			}
		}

		return true;
	}

	void UPI_AddKeyToKeyChain(const FGuid& EncryptionKeyGuid, const FAES::FAESKey& Key, FKeyChain& OutKeyChain)
	{
		FNamedAESKey NamedKey;
		NamedKey.Name = EncryptionKeyGuid.IsValid()
			? FString::Printf(TEXT("Container_%s"), *EncryptionKeyGuid.ToString(EGuidFormats::Digits))
			: FString(TEXT("Default"));
		NamedKey.Guid = EncryptionKeyGuid;
		NamedKey.Key = Key;

		OutKeyChain.GetEncryptionKeys().Add(NamedKey.Guid, NamedKey);
		if (!EncryptionKeyGuid.IsValid())
		{
			OutKeyChain.SetPrincipalEncryptionKey(OutKeyChain.GetEncryptionKeys().Find(NamedKey.Guid));
		}
	}

	bool UPI_ValidateCommonInputs(const FString& ContainerPath, const FString& OutputDirectory, FUpiExtractResult& OutResult)
	{
		if (ContainerPath.IsEmpty())
		{
			OutResult.Issues.Add(TEXT("extract.path_required"));
			OutResult.ErrorCount = 1;
			return false;
		}

		if (OutputDirectory.IsEmpty())
		{
			OutResult.Issues.Add(TEXT("extract.output_directory_required"));
			OutResult.ErrorCount = 1;
			return false;
		}

		if (!IFileManager::Get().FileExists(*ContainerPath))
		{
			OutResult.Issues.Add(TEXT("extract.file_not_found"));
			OutResult.ErrorCount = 1;
			return false;
		}

		if (!UPI_EnsureOutputDirectory(OutputDirectory))
		{
			OutResult.Issues.Add(TEXT("extract.invalid_output_directory"));
			OutResult.ErrorCount = 1;
			return false;
		}

		return true;
	}
}

bool UPI_ExtractPakFile(const FString& PakPath, const FString& OutputDirectory, const FString& AesKey, FUpiExtractResult& OutResult)
{
	OutResult = FUpiExtractResult();
	OutResult.ContainerPath = PakPath;
	OutResult.OutputDirectory = OutputDirectory;

	if (!UPI_ValidateCommonInputs(PakPath, OutputDirectory, OutResult))
	{
		return false;
	}

	FAES::FAESKey ParsedKey;
	bool bHasKey = false;
	if (!UPI_ParseOptionalAesKey(AesKey, ParsedKey, bHasKey))
	{
		OutResult.Issues.Add(TEXT("extract.aes_key_invalid"));
		OutResult.ErrorCount = 1;
		return false;
	}

	FGuid PakEncryptionKeyGuid;
	if (!UPI_PreflightPakForExtraction(PakPath, ParsedKey, bHasKey, PakEncryptionKeyGuid))
	{
		OutResult.Issues.Add(TEXT("pak.extract_failed"));
		OutResult.ErrorCount = 1;
		return false;
	}

	FString TempCryptoKeysFile;
	const FString TempResponseFile = FPaths::CreateTempFilename(FPlatformProcess::UserTempDir(), TEXT("upi-extract-response-"), TEXT(".txt"));
	if (!UPI_CanCreateFile(TempResponseFile))
	{
		OutResult.Issues.Add(TEXT("pak.extract_failed"));
		OutResult.ErrorCount = 1;
		return false;
	}

	FString CommandLine = FString::Printf(
		TEXT("-Extract %s %s -ExtractToMountPoint -responseFile=%s"),
		*UPI_QuoteCommandPath(PakPath),
		*UPI_QuoteCommandPath(OutputDirectory),
		*UPI_QuoteCommandPath(TempResponseFile));

	if (bHasKey)
	{
		TempCryptoKeysFile = UPI_CreateTemporaryPakCryptoKeysFile(ParsedKey, PakEncryptionKeyGuid);
		if (TempCryptoKeysFile.IsEmpty())
		{
			IFileManager::Get().Delete(*TempResponseFile, false, true);
			OutResult.Issues.Add(TEXT("extract.invalid_output_directory"));
			OutResult.ErrorCount = 1;
			return false;
		}

		CommandLine += FString::Printf(TEXT(" -cryptokeys=%s"), *UPI_QuoteCommandPath(TempCryptoKeysFile));
	}

	const bool bExtracted = ExecuteUnrealPak(*CommandLine);
	if (!TempCryptoKeysFile.IsEmpty())
	{
		IFileManager::Get().Delete(*TempCryptoKeysFile, false, true);
	}

	if (!bExtracted)
	{
		IFileManager::Get().Delete(*TempResponseFile, false, true);
		OutResult.Issues.Add(TEXT("pak.extract_failed"));
		OutResult.ErrorCount = 1;
		return false;
	}

	OutResult.ExtractedFileCount = UPI_CountLinesInFile(TempResponseFile);
	IFileManager::Get().Delete(*TempResponseFile, false, true);
	return true;
}

bool UPI_ExtractIoStoreFile(const FString& UtocPath, const FString& UcasPath, const FString& OutputDirectory, const FString& AesKey, FUpiExtractResult& OutResult)
{
	OutResult = FUpiExtractResult();
	const FString PreferredContainerPath = !UtocPath.IsEmpty() ? UtocPath : UcasPath;
	const FString ResolvedUtocPath = UPI_ResolveIoStorePaths(UtocPath, UcasPath);
	OutResult.ContainerPath = !ResolvedUtocPath.IsEmpty() && IFileManager::Get().FileExists(*ResolvedUtocPath)
		? ResolvedUtocPath
		: PreferredContainerPath;
	OutResult.OutputDirectory = OutputDirectory;

	if (!UPI_ValidateCommonInputs(OutResult.ContainerPath, OutputDirectory, OutResult))
	{
		return false;
	}

	FAES::FAESKey ParsedKey;
	bool bHasKey = false;
	if (!UPI_ParseOptionalAesKey(AesKey, ParsedKey, bHasKey))
	{
		OutResult.Issues.Add(TEXT("extract.aes_key_invalid"));
		OutResult.ErrorCount = 1;
		return false;
	}

	FKeyChain KeyChain;
	if (bHasKey)
	{
		UPI_AddKeyToKeyChain(FGuid(), ParsedKey, KeyChain);

		FIoStoreTocHeader TocHeader;
		if (!ResolvedUtocPath.IsEmpty() && UPI_ReadTocHeader(ResolvedUtocPath, TocHeader) && TocHeader.EncryptionKeyGuid.IsValid())
		{
			UPI_AddKeyToKeyChain(TocHeader.EncryptionKeyGuid, ParsedKey, KeyChain);
		}
	}

	bool bIsSigned = false;
	const bool bExtracted = ExtractFilesFromIoStoreContainer(
		*OutResult.ContainerPath,
		*OutputDirectory,
		KeyChain,
		nullptr,
		nullptr,
		nullptr,
		&bIsSigned);

	if (!bExtracted)
	{
		OutResult.Issues.Add(TEXT("iostore.extract_failed"));
		OutResult.ErrorCount = 1;
		return false;
	}

	return true;
}
