#include "ContainerExtractor.h"

#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "Misc/AES.h"
#include "Misc/Base64.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Misc/KeyChainUtilities.h"
#include "Misc/Paths.h"
#include "PakFileUtilities.h"
#include "IoStoreUtilities.h"

namespace
{
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

	bool UPI_EnsureOutputDirectory(const FString& OutputDirectory)
	{
		if (OutputDirectory.IsEmpty())
		{
			return false;
		}

		IFileManager& FileManager = IFileManager::Get();
		return FileManager.MakeDirectory(*OutputDirectory, true) && FileManager.DirectoryExists(*OutputDirectory);
	}

	FString UPI_CreateTemporaryPakCryptoKeysFile(const FAES::FAESKey& Key)
	{
		const FString TempFilename = FPaths::CreateTempFilename(FPlatformProcess::UserTempDir(), TEXT("upi-cryptokeys-"), TEXT(".json"));
		const FString KeyBase64 = FBase64::Encode(Key.Key, FAES::FAESKey::KeySize);
		const FString Contents = FString::Printf(
			TEXT("{\n")
			TEXT("  \"EncryptionKey\": {\n")
			TEXT("    \"Name\": \"Default\",\n")
			TEXT("    \"Guid\": \"00000000000000000000000000000000\",\n")
			TEXT("    \"Key\": \"%s\"\n")
			TEXT("  },\n")
			TEXT("  \"SecondaryEncryptionKeys\": []\n")
			TEXT("}\n"),
			*KeyBase64);

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

	void UPI_AddDefaultKeyToKeyChain(const FAES::FAESKey& Key, FKeyChain& OutKeyChain)
	{
		FNamedAESKey NamedKey;
		NamedKey.Name = TEXT("Default");
		NamedKey.Guid = FGuid();
		NamedKey.Key = Key;

		OutKeyChain.GetEncryptionKeys().Add(NamedKey.Guid, NamedKey);
		OutKeyChain.SetPrincipalEncryptionKey(OutKeyChain.GetEncryptionKeys().Find(NamedKey.Guid));
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

	FString TempCryptoKeysFile;
	const FString TempResponseFile = FPaths::CreateTempFilename(FPlatformProcess::UserTempDir(), TEXT("upi-extract-response-"), TEXT(".txt"));
	FString CommandLine = FString::Printf(
		TEXT("-Extract %s %s -ExtractToMountPoint -responseFile=%s"),
		*UPI_QuoteCommandPath(PakPath),
		*UPI_QuoteCommandPath(OutputDirectory),
		*UPI_QuoteCommandPath(TempResponseFile));

	if (bHasKey)
	{
		TempCryptoKeysFile = UPI_CreateTemporaryPakCryptoKeysFile(ParsedKey);
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
	OutResult.ContainerPath = !UtocPath.IsEmpty() ? UtocPath : UcasPath;
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
		UPI_AddDefaultKeyToKeyChain(ParsedKey, KeyChain);
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
