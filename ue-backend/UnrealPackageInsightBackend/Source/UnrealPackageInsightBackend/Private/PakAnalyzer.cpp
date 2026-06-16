#include "PakAnalyzer.h"

#include "Algo/Sort.h"
#include "CoreGlobals.h"
#include "HAL/CriticalSection.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"
#include "IPlatformFilePak.h"
#include "Math/UnrealMathUtility.h"
#include "Misc/AES.h"
#include "Misc/CommandLine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/CoreDelegates.h"
#include "Misc/EncryptionKeyManager.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "Serialization/Archive.h"
#include "String/BytesToHex.h"
#include "Templates/RefCounting.h"
#include "Templates/UniquePtr.h"

namespace
{
	FCriticalSection GUpiPakRuntimeInitCriticalSection;

	void UPI_EnsureMinimalUnrealRuntimeForPak()
	{
		FScopeLock Lock(&GUpiPakRuntimeInitCriticalSection);

		if (!FCommandLine::IsInitialized())
		{
			FCommandLine::Set(TEXT(""));
		}

		if (GConfig == nullptr)
		{
			FConfigCacheIni::InitializeConfigSystem();
		}
	}

	uint64 UPI_ToUInt64(int64 Value)
	{
		return Value > 0 ? static_cast<uint64>(Value) : 0;
	}

	FString UPI_NormalizeSlashes(FString Path)
	{
		Path.ReplaceInline(TEXT("\\"), TEXT("/"));
		FPaths::NormalizeFilename(Path);
		return Path;
	}

	FString UPI_CombineMountAndFilename(const FString& MountPoint, const FString& Filename)
	{
		FString NormalizedFilename = UPI_NormalizeSlashes(Filename);
		if (NormalizedFilename.IsEmpty())
		{
			return NormalizedFilename;
		}

		if (NormalizedFilename.StartsWith(TEXT("/")) || NormalizedFilename.StartsWith(TEXT("../")))
		{
			return NormalizedFilename;
		}

		FString NormalizedMountPoint = UPI_NormalizeSlashes(MountPoint);
		if (NormalizedMountPoint.IsEmpty() || NormalizedFilename.StartsWith(NormalizedMountPoint, ESearchCase::IgnoreCase))
		{
			return NormalizedFilename;
		}

		if (!NormalizedMountPoint.EndsWith(TEXT("/")))
		{
			NormalizedMountPoint.AppendChar(TEXT('/'));
		}

		return NormalizedMountPoint + NormalizedFilename;
	}

	FString UPI_CompressionName(const FPakInfo& PakInfo, uint32 CompressionMethodIndex)
	{
		if (CompressionMethodIndex == 0)
		{
			return TEXT("None");
		}

		const TOptional<FName> Method = PakInfo.TryGetCompressionMethod(CompressionMethodIndex);
		if (!Method.IsSet())
		{
			return TEXT("Unknown");
		}

		if (Method.GetValue().IsNone())
		{
			return TEXT("None");
		}

		return Method.GetValue().ToString();
	}

	FString UPI_HashToLowerHex(const uint8 Hash[20])
	{
		return BytesToHexLower(Hash, 20);
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

	bool UPI_ParseAesKey(const FString& AesKey, FAES::FAESKey& OutKey)
	{
		OutKey.Reset();

		FString Hex = AesKey.TrimStartAndEnd();
		if (Hex.StartsWith(TEXT("0x"), ESearchCase::IgnoreCase))
		{
			Hex.RightChopInline(2, EAllowShrinking::No);
		}

		const int32 KeyByteCount = Hex.Len() / 2;
		if (Hex.IsEmpty() || Hex.Len() % 2 != 0 || (KeyByteCount != 16 && KeyByteCount != FAES::FAESKey::KeySize))
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

		return OutKey.IsValid();
	}

	bool UPI_ReadPakIndexData(const FString& PakPath, const FPakInfo& PakInfo, TArray<uint8>& OutIndexData)
	{
		if (PakInfo.IndexOffset < 0 || PakInfo.IndexSize <= 0 || !IntFitsIn<int32>(PakInfo.IndexSize))
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

	void UPI_RegisterPakAesKey(const FGuid& EncryptionKeyGuid, const FAES::FAESKey& Key)
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

	void UPI_FillOverviewFromPak(const FPakFile& PakFile, FUpiPakAnalysis& OutAnalysis)
	{
		const FPakInfo& PakInfo = PakFile.GetInfo();
		OutAnalysis.MountPoint = UPI_NormalizeSlashes(PakFile.GetMountPoint());
		OutAnalysis.PakVersion = static_cast<uint32>(FMath::Max(PakInfo.Version, 0));
		OutAnalysis.PakSize = UPI_ToUInt64(PakFile.TotalSize());
		OutAnalysis.bIndexEncrypted = PakInfo.bEncryptedIndex != 0;
		OutAnalysis.EncryptionKeyGuid = PakInfo.EncryptionKeyGuid.IsValid() ? LexToString(PakInfo.EncryptionKeyGuid) : FString();

		if (OutAnalysis.PakSize == 0)
		{
			const int64 FileSize = IFileManager::Get().FileSize(*OutAnalysis.PakPath);
			OutAnalysis.PakSize = UPI_ToUInt64(FileSize);
		}
	}

	struct FUpiPakPackageWithBlocks
	{
		FUpiPakPackageRecord Record;
		TArray<FPakCompressedBlock> Blocks;
		bool bEncrypted = false;
	};
}

bool UPI_AnalyzePakFile(const FString& PakPath, const FString& AesKey, FUpiPakAnalysis& OutAnalysis)
{
	OutAnalysis = FUpiPakAnalysis();
	OutAnalysis.PakPath = PakPath;

	if (PakPath.IsEmpty())
	{
		OutAnalysis.Issues.Add(TEXT("pak.path_required"));
		return false;
	}

	if (!IFileManager::Get().FileExists(*PakPath))
	{
		OutAnalysis.Issues.Add(TEXT("pak.file_not_found"));
		return false;
	}

	UPI_EnsureMinimalUnrealRuntimeForPak();

	IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();
	TRefCountPtr<FPakFile> TrailerOnlyPak = MakeRefCount<FPakFile>(&PlatformFile, *PakPath, false, false);
	if (!TrailerOnlyPak.IsValid() || !TrailerOnlyPak->IsValid())
	{
		OutAnalysis.Issues.Add(TEXT("pak.invalid"));
		return false;
	}

	UPI_FillOverviewFromPak(*TrailerOnlyPak, OutAnalysis);

	if (OutAnalysis.bIndexEncrypted)
	{
		OutAnalysis.bHasFullDirectoryIndex = false;
		OutAnalysis.bPartialListing = true;

		if (AesKey.TrimStartAndEnd().IsEmpty())
		{
			OutAnalysis.Issues.Add(TEXT("pak.aes_key_required"));
			return false;
		}

		FAES::FAESKey ParsedKey;
		if (!UPI_ParseAesKey(AesKey, ParsedKey))
		{
			OutAnalysis.Issues.Add(TEXT("pak.aes_key_invalid"));
			return false;
		}

		const FPakInfo& TrailerInfo = TrailerOnlyPak->GetInfo();
		if (!UPI_CanDecryptPakIndexWithKey(PakPath, TrailerInfo, ParsedKey))
		{
			OutAnalysis.Issues.Add(TEXT("pak.aes_key_invalid"));
			return false;
		}

		UPI_RegisterPakAesKey(TrailerInfo.EncryptionKeyGuid, ParsedKey);
	}

	TRefCountPtr<FPakFile> PakFile = MakeRefCount<FPakFile>(&PlatformFile, *PakPath, false, true);
	if (!PakFile.IsValid() || !PakFile->IsValid())
	{
		OutAnalysis.Issues.Add(OutAnalysis.bIndexEncrypted ? TEXT("pak.index_corrupted") : TEXT("pak.invalid"));
		return false;
	}

	UPI_FillOverviewFromPak(*PakFile, OutAnalysis);

	const FPakInfo& PakInfo = PakFile->GetInfo();
	const bool bRelativeBlockOffsets = PakInfo.HasRelativeCompressedChunkOffsets() != 0;
	bool bHasFullDirectoryIndex = PakFile->HasFilenames();
	TArray<FUpiPakPackageWithBlocks> PackagesWithBlocks;

	for (FPakFile::FPakEntryIterator It(*PakFile, true); It; ++It)
	{
		const FPakEntry& Entry = It.Info();
		const FString* Filename = It.TryGetFilename();
		if (Filename == nullptr)
		{
			bHasFullDirectoryIndex = false;
		}

		if (Entry.IsDeleteRecord())
		{
			continue;
		}

		FUpiPakPackageWithBlocks PackageWithBlocks;
		FUpiPakPackageRecord& Record = PackageWithBlocks.Record;
		Record.MountPoint = OutAnalysis.MountPoint;
		Record.PackagePath = Filename != nullptr ? UPI_CombineMountAndFilename(OutAnalysis.MountPoint, *Filename) : FString();
		Record.Offset = UPI_ToUInt64(Entry.Offset);
		const uint64 SerializedSize = UPI_ToUInt64(Entry.GetSerializedSize(PakInfo.Version));
		Record.PayloadOffset = Record.Offset + SerializedSize;
		Record.Size = UPI_ToUInt64(Entry.UncompressedSize);
		Record.CompressedSize = UPI_ToUInt64(Entry.Size);
		Record.RecordSize = SerializedSize + Record.CompressedSize;
		Record.CompressionMethodIndex = Entry.CompressionMethodIndex;
		Record.Compression = UPI_CompressionName(PakInfo, Entry.CompressionMethodIndex);
		Record.CompressionBlockSize = Entry.CompressionBlockSize;
		Record.CompressionBlockCount = static_cast<uint32>(Entry.CompressionBlocks.Num());
		Record.bRelativeBlockOffsets = bRelativeBlockOffsets;
		Record.Flags = Entry.Flags;
		Record.Hash = UPI_HashToLowerHex(Entry.Hash);
		Record.bHasPath = Filename != nullptr;

		PackageWithBlocks.Blocks = Entry.CompressionBlocks;
		PackageWithBlocks.bEncrypted = Entry.IsEncrypted();
		PackagesWithBlocks.Add(MoveTemp(PackageWithBlocks));
	}

	Algo::Sort(PackagesWithBlocks, [](const FUpiPakPackageWithBlocks& Left, const FUpiPakPackageWithBlocks& Right)
	{
		if (Left.Record.Offset == Right.Record.Offset)
		{
			return Left.Record.PackagePath < Right.Record.PackagePath;
		}

		return Left.Record.Offset < Right.Record.Offset;
	});

	OutAnalysis.Packages.Reserve(PackagesWithBlocks.Num());
	for (int32 PackageIndex = 0; PackageIndex < PackagesWithBlocks.Num(); ++PackageIndex)
	{
		FUpiPakPackageWithBlocks& PackageWithBlocks = PackagesWithBlocks[PackageIndex];
		PackageWithBlocks.Record.Order = static_cast<uint32>(PackageIndex);
		PackageWithBlocks.Record.FirstCompressedBlockIndex = static_cast<uint32>(OutAnalysis.CompressedBlocks.Num());

		for (int32 BlockIndex = 0; BlockIndex < PackageWithBlocks.Blocks.Num(); ++BlockIndex)
		{
			const FPakCompressedBlock& Block = PackageWithBlocks.Blocks[BlockIndex];
			const uint64 CompressedStart = UPI_ToUInt64(Block.CompressedStart);
			const uint64 CompressedEnd = UPI_ToUInt64(Block.CompressedEnd);
			const uint64 CompressedSize = CompressedEnd >= CompressedStart ? CompressedEnd - CompressedStart : 0;
			const uint64 PhysicalOffsetBase = bRelativeBlockOffsets ? PackageWithBlocks.Record.Offset : 0;

			FUpiPakCompressedBlockRecord BlockRecord;
			BlockRecord.PackageIndex = static_cast<uint32>(PackageIndex);
			BlockRecord.BlockIndex = static_cast<uint32>(BlockIndex);
			BlockRecord.CompressedStart = CompressedStart;
			BlockRecord.CompressedEnd = CompressedEnd;
			BlockRecord.CompressedSize = CompressedSize;
			BlockRecord.DiskSize = PackageWithBlocks.bEncrypted ? Align(CompressedSize, static_cast<uint64>(FAES::AESBlockSize)) : CompressedSize;
			BlockRecord.PhysicalStart = PhysicalOffsetBase + CompressedStart;
			BlockRecord.PhysicalEnd = BlockRecord.PhysicalStart + BlockRecord.DiskSize;
			OutAnalysis.CompressedBlocks.Add(BlockRecord);
		}

		OutAnalysis.Packages.Add(MoveTemp(PackageWithBlocks.Record));
	}

	OutAnalysis.bHasFullDirectoryIndex = bHasFullDirectoryIndex;
	OutAnalysis.bPartialListing = !bHasFullDirectoryIndex;
	if (OutAnalysis.bPartialListing)
	{
		OutAnalysis.Issues.Add(TEXT("pak.partial_listing"));
	}

	return true;
}
