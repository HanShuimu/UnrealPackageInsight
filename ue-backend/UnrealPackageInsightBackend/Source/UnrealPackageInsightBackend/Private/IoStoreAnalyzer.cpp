#include "IoStoreAnalyzer.h"

#include "Algo/Sort.h"
#include "Containers/Map.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"
#include "IO/IoDispatcher.h"
// Narrow internal include for FIoStoreTocHeader: public FIoStoreReader exposes the encryption key GUID only after Initialize.
#include "IO/IoStore.h"
#include "IO/IoStatus.h"
#include "Math/UnrealMathUtility.h"
#include "Misc/AES.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"
#include "Serialization/Archive.h"
#include "Templates/UniquePtr.h"

namespace
{
	FString UPI_NormalizeFilename(FString Path)
	{
		Path.ReplaceInline(TEXT("\\"), TEXT("/"));
		FPaths::NormalizeFilename(Path);
		return Path;
	}

	uint64 UPI_ToUInt64(int64 Value)
	{
		return Value > 0 ? static_cast<uint64>(Value) : 0;
	}

	uint32 UPI_ToUInt32(int32 Value)
	{
		return Value > 0 ? static_cast<uint32>(Value) : 0;
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

	void UPI_ResolveIoStorePaths(const FString& UtocPath, const FString& UcasPath, FUpiIoStoreOverview& Overview)
	{
		const FString PreferredPath = !UtocPath.IsEmpty() ? UtocPath : UcasPath;
		const FString BasePath = UPI_BasePathFromIoStorePath(PreferredPath);
		Overview.ContainerBasePath = BasePath;
		Overview.UtocPath = BasePath.IsEmpty() ? FString() : BasePath + TEXT(".utoc");
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

	void UPI_FillOverviewFromTocHeader(const FIoStoreTocHeader& Header, FUpiIoStoreAnalysis& OutAnalysis)
	{
		OutAnalysis.Overview.ContainerId = Header.ContainerId.Value();
		OutAnalysis.Overview.TocVersion = Header.Version;
		OutAnalysis.Overview.TocEntryCount = Header.TocEntryCount;
		OutAnalysis.Overview.CompressionBlockCount = Header.TocCompressedBlockEntryCount;
		OutAnalysis.Overview.CompressionBlockSize = Header.CompressionBlockSize;
		OutAnalysis.Overview.PartitionCount = Header.PartitionCount;
		OutAnalysis.Overview.PartitionSize = Header.PartitionSize != MAX_uint64 ? Header.PartitionSize : 0;
		OutAnalysis.Overview.ContainerFlags = static_cast<uint32>(static_cast<uint8>(Header.ContainerFlags));
		OutAnalysis.Overview.EncryptionKeyGuid = Header.EncryptionKeyGuid.IsValid() ? LexToString(Header.EncryptionKeyGuid) : FString();
		OutAnalysis.Overview.DirectoryIndexSize = Header.DirectoryIndexSize;
		OutAnalysis.Overview.bIndexed = EnumHasAnyFlags(Header.ContainerFlags, EIoContainerFlags::Indexed);
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
		FString Hex = AesKey.TrimStartAndEnd();
		if (Hex.StartsWith(TEXT("0x"), ESearchCase::IgnoreCase))
		{
			Hex.RightChopInline(2, EAllowShrinking::No);
		}

		if (Hex.IsEmpty())
		{
			return false;
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

		return OutKey.IsValid();
	}

	uint64 UPI_ChunkPackageId(const FIoChunkId& ChunkId)
	{
		uint64 PackageId = 0;
		FMemory::Memcpy(&PackageId, ChunkId.GetData(), sizeof(PackageId));
		return PackageId;
	}

	uint32 UPI_ChunkIndex(const FIoChunkId& ChunkId)
	{
		const uint8* Data = ChunkId.GetData();
		return (static_cast<uint32>(Data[8]) << 8) | static_cast<uint32>(Data[9]);
	}

	uint32 UPI_BulkDataCookedIndex(const FIoChunkId& ChunkId)
	{
		return static_cast<uint32>(ChunkId.GetData()[10]);
	}

	bool UPI_IsPackageBackedChunkType(EIoChunkType ChunkType)
	{
		switch (ChunkType)
		{
		case EIoChunkType::ExportBundleData:
		case EIoChunkType::BulkData:
		case EIoChunkType::OptionalBulkData:
		case EIoChunkType::MemoryMappedBulkData:
		case EIoChunkType::PackageStoreEntry:
		case EIoChunkType::PackageResource:
			return true;
		default:
			return false;
		}
	}

	uint32 UPI_MetaFlags(const FIoStoreTocChunkInfo& ChunkInfo)
	{
		uint32 Flags = 0;
		if (ChunkInfo.bIsCompressed)
		{
			Flags |= 0x01;
		}
		if (ChunkInfo.bIsMemoryMapped)
		{
			Flags |= 0x02;
		}
		return Flags;
	}

	FString UPI_CompressionName(const TArray<FName>& CompressionMethods, uint8 MethodIndex)
	{
		if (MethodIndex == 0)
		{
			return TEXT("None");
		}

		if (!CompressionMethods.IsValidIndex(MethodIndex))
		{
			return TEXT("Unknown");
		}

		const FName Method = CompressionMethods[MethodIndex];
		return Method.IsNone() ? FString(TEXT("None")) : Method.ToString();
	}

	uint32 UPI_FirstBlockIndex(const FIoStoreTocChunkInfo& ChunkInfo, uint32 CompressionBlockSize)
	{
		return CompressionBlockSize > 0 ? static_cast<uint32>(ChunkInfo.Offset / CompressionBlockSize) : 0;
	}

	uint64 UPI_UcasOffset(uint64 GlobalOffset, uint32 PartitionIndex, uint64 PartitionSize, uint32 PartitionCount)
	{
		if (PartitionCount <= 1 || PartitionSize == 0)
		{
			return GlobalOffset;
		}

		const uint64 PartitionStart = static_cast<uint64>(PartitionIndex) * PartitionSize;
		return GlobalOffset >= PartitionStart ? GlobalOffset - PartitionStart : GlobalOffset % PartitionSize;
	}

	uint32 UPI_PartitionIndexForOffset(uint64 GlobalOffset, uint64 PartitionSize, uint32 PartitionCount)
	{
		if (PartitionCount <= 1 || PartitionSize == 0)
		{
			return 0;
		}

		return static_cast<uint32>(GlobalOffset / PartitionSize);
	}

	void UPI_FillPartitions(FIoStoreReader& Reader, FUpiIoStoreAnalysis& OutAnalysis)
	{
		TArray<FString> ContainerFilePaths;
		Reader.GetContainerFilePaths(ContainerFilePaths);

		OutAnalysis.Partitions.Reserve(ContainerFilePaths.Num());
		for (int32 PartitionIndex = 0; PartitionIndex < ContainerFilePaths.Num(); ++PartitionIndex)
		{
			FUpiIoStorePartitionRecord Partition;
			Partition.PartitionIndex = static_cast<uint32>(PartitionIndex);
			Partition.UcasPath = UPI_NormalizeFilename(ContainerFilePaths[PartitionIndex]);
			Partition.Size = UPI_ToUInt64(IFileManager::Get().FileSize(*ContainerFilePaths[PartitionIndex]));
			OutAnalysis.Partitions.Add(MoveTemp(Partition));
		}

		if (OutAnalysis.Overview.PartitionCount == 0)
		{
			OutAnalysis.Overview.PartitionCount = static_cast<uint32>(OutAnalysis.Partitions.Num());
		}
		if (OutAnalysis.Overview.PartitionSize == 0 && OutAnalysis.Partitions.Num() > 0)
		{
			OutAnalysis.Overview.PartitionSize = OutAnalysis.Partitions[0].Size;
		}
	}

	void UPI_FillOverview(FIoStoreReader& Reader, FUpiIoStoreAnalysis& OutAnalysis)
	{
		const EIoContainerFlags ContainerFlags = Reader.GetContainerFlags();
		OutAnalysis.Overview.ContainerId = Reader.GetContainerId().Value();
		OutAnalysis.Overview.TocVersion = Reader.GetVersion();
		OutAnalysis.Overview.TocEntryCount = UPI_ToUInt32(Reader.GetChunkCount());
		OutAnalysis.Overview.CompressionBlockSize = Reader.GetCompressionBlockSize();
		OutAnalysis.Overview.ContainerFlags = static_cast<uint32>(static_cast<uint8>(ContainerFlags));
		const FGuid EncryptionKeyGuid = Reader.GetEncryptionKeyGuid();
		OutAnalysis.Overview.EncryptionKeyGuid = EncryptionKeyGuid.IsValid() ? LexToString(EncryptionKeyGuid) : FString();
		OutAnalysis.Overview.bIndexed = EnumHasAnyFlags(ContainerFlags, EIoContainerFlags::Indexed);

		uint32 CompressionBlockCount = 0;
		Reader.EnumerateCompressedBlocks([&CompressionBlockCount](const FIoStoreTocCompressedBlockInfo&)
		{
			++CompressionBlockCount;
			return true;
		});
		OutAnalysis.Overview.CompressionBlockCount = CompressionBlockCount;
	}

	void UPI_EnumerateChunksAndBlocks(FIoStoreReader& Reader, FUpiIoStoreAnalysis& OutAnalysis)
	{
		const TArray<FName>& CompressionMethods = Reader.GetCompressionMethods();
		const uint32 CompressionBlockSize = OutAnalysis.Overview.CompressionBlockSize;
		const uint32 PartitionCount = OutAnalysis.Overview.PartitionCount;
		const uint64 PartitionSize = OutAnalysis.Overview.PartitionSize;
		const uint32 ContainerFlags = OutAnalysis.Overview.ContainerFlags;
		bool bPartialListing = !OutAnalysis.Overview.bIndexed;

		uint32 TocEntryIndex = 0;
		Reader.EnumerateChunks([&](FIoStoreTocChunkInfo&& ChunkInfo)
		{
			FUpiIoStoreChunkRecord Chunk;
			Chunk.TocEntryIndex = TocEntryIndex++;
			Chunk.ChunkId = LexToString(ChunkInfo.Id);
			Chunk.ChunkType = LexToString(ChunkInfo.ChunkType);
			Chunk.bPackageBacked = UPI_IsPackageBackedChunkType(ChunkInfo.ChunkType);
			Chunk.PackageId = UPI_ChunkPackageId(ChunkInfo.Id);
			Chunk.ChunkIndex = UPI_ChunkIndex(ChunkInfo.Id);
			Chunk.BulkDataCookedIndex = UPI_BulkDataCookedIndex(ChunkInfo.Id);
			Chunk.PackagePath = ChunkInfo.bHasValidFileName ? UPI_NormalizeFilename(ChunkInfo.FileName) : FString();
			Chunk.bHasPath = ChunkInfo.bHasValidFileName;
			Chunk.LogicalOffset = ChunkInfo.Offset;
			Chunk.Offset = ChunkInfo.OffsetOnDisk;
			Chunk.PartitionIndex = ChunkInfo.PartitionIndex >= 0 ? static_cast<uint32>(ChunkInfo.PartitionIndex) : 0;
			Chunk.UcasOffset = UPI_UcasOffset(Chunk.Offset, Chunk.PartitionIndex, PartitionSize, PartitionCount);
			Chunk.Size = ChunkInfo.Size;
			Chunk.CompressedSize = ChunkInfo.CompressedSize;
			Chunk.FirstBlockIndex = UPI_FirstBlockIndex(ChunkInfo, CompressionBlockSize);
			Chunk.BlockCount = ChunkInfo.NumCompressedBlocks;
			Chunk.MetaFlags = UPI_MetaFlags(ChunkInfo);
			Chunk.ContainerFlags = ContainerFlags;
			Chunk.Hash = LexToString(ChunkInfo.ChunkHash);
			Chunk.Compression = TEXT("None");

			if (!Chunk.bHasPath)
			{
				bPartialListing = true;
			}

			TOptional<uint8> FirstCompressionMethodIndex;
			bool bMixedCompression = false;
			uint32 LocalBlockIndex = 0;
			Reader.EnumerateCompressedBlocksForChunk(ChunkInfo.Id, [&](const FIoStoreTocCompressedBlockInfo& BlockInfo)
			{
				if (!FirstCompressionMethodIndex.IsSet())
				{
					FirstCompressionMethodIndex = BlockInfo.CompressionMethodIndex;
				}
				else if (FirstCompressionMethodIndex.GetValue() != BlockInfo.CompressionMethodIndex)
				{
					bMixedCompression = true;
				}

				FUpiIoStoreCompressedBlockRecord Block;
				Block.BlockIndex = Chunk.FirstBlockIndex + LocalBlockIndex++;
				Block.OwnerTocEntryIndex = Chunk.TocEntryIndex;
				Block.PartitionIndex = UPI_PartitionIndexForOffset(BlockInfo.Offset, PartitionSize, PartitionCount);
				Block.Offset = BlockInfo.Offset;
				Block.UcasOffset = UPI_UcasOffset(Block.Offset, Block.PartitionIndex, PartitionSize, PartitionCount);
				Block.CompressedSize = BlockInfo.CompressedSize;
				Block.DiskSize = Align(BlockInfo.CompressedSize, FAES::AESBlockSize);
				Block.UncompressedSize = BlockInfo.UncompressedSize;
				Block.Compression = UPI_CompressionName(CompressionMethods, BlockInfo.CompressionMethodIndex);
				Chunk.DiskSize += Block.DiskSize;
				OutAnalysis.CompressedBlocks.Add(MoveTemp(Block));
				return true;
			});

			if (bMixedCompression)
			{
				Chunk.Compression = TEXT("Mixed");
			}
			else if (FirstCompressionMethodIndex.IsSet())
			{
				Chunk.Compression = UPI_CompressionName(CompressionMethods, FirstCompressionMethodIndex.GetValue());
			}

			OutAnalysis.Chunks.Add(MoveTemp(Chunk));
			return true;
		});

		Algo::Sort(OutAnalysis.Chunks, [](const FUpiIoStoreChunkRecord& Left, const FUpiIoStoreChunkRecord& Right)
		{
			if (Left.PartitionIndex != Right.PartitionIndex)
			{
				return Left.PartitionIndex < Right.PartitionIndex;
			}
			if (Left.Offset != Right.Offset)
			{
				return Left.Offset < Right.Offset;
			}
			return Left.TocEntryIndex < Right.TocEntryIndex;
		});

		for (int32 ChunkIndex = 0; ChunkIndex < OutAnalysis.Chunks.Num(); ++ChunkIndex)
		{
			OutAnalysis.Chunks[ChunkIndex].Order = static_cast<uint32>(ChunkIndex);
		}

		OutAnalysis.Overview.bPartialListing = bPartialListing;
		if (bPartialListing)
		{
			OutAnalysis.Issues.Add(TEXT("iostore.partial_listing"));
		}
	}

	int32 UPI_FindPackageIndex(const TArray<FUpiIoStorePackageRecord>& Packages, uint64 PackageId, const FString& PackagePath)
	{
		for (int32 PackageIndex = 0; PackageIndex < Packages.Num(); ++PackageIndex)
		{
			if (Packages[PackageIndex].PackageId == PackageId && Packages[PackageIndex].PackagePath == PackagePath)
			{
				return PackageIndex;
			}
		}

		return INDEX_NONE;
	}

	void UPI_AggregatePackages(FUpiIoStoreAnalysis& OutAnalysis)
	{
		for (int32 ChunkIndex = 0; ChunkIndex < OutAnalysis.Chunks.Num(); ++ChunkIndex)
		{
			FUpiIoStoreChunkRecord& Chunk = OutAnalysis.Chunks[ChunkIndex];
			if (!Chunk.bPackageBacked || Chunk.PackageId == 0)
			{
				Chunk.PackageIndex = UINT32_MAX;
				continue;
			}

			int32 PackageIndex = UPI_FindPackageIndex(OutAnalysis.Packages, Chunk.PackageId, Chunk.PackagePath);
			if (PackageIndex == INDEX_NONE)
			{
				FUpiIoStorePackageRecord Package;
				Package.PackagePath = Chunk.PackagePath;
				Package.PackageId = Chunk.PackageId;
				Package.FirstChunkIndex = static_cast<uint32>(ChunkIndex);
				Package.FirstPartitionIndex = Chunk.PartitionIndex;
				Package.FirstOffset = Chunk.Offset;
				Package.bHasPath = Chunk.bHasPath;
				PackageIndex = OutAnalysis.Packages.Add(MoveTemp(Package));
			}

			FUpiIoStorePackageRecord& Package = OutAnalysis.Packages[PackageIndex];
			Package.ChunkCount += 1;
			Package.FirstPartitionIndex = FMath::Min(Package.FirstPartitionIndex, Chunk.PartitionIndex);
			Package.FirstOffset = FMath::Min(Package.FirstOffset, Chunk.Offset);
			Package.Size += Chunk.Size;
			Package.CompressedSize += Chunk.CompressedSize;
			Package.DiskSize += Chunk.DiskSize;
			Package.bHasPath = Package.bHasPath || Chunk.bHasPath;
			Chunk.PackageIndex = static_cast<uint32>(PackageIndex);
		}

		for (int32 PackageIndex = 0; PackageIndex < OutAnalysis.Packages.Num(); ++PackageIndex)
		{
			OutAnalysis.Packages[PackageIndex].Order = static_cast<uint32>(PackageIndex);
		}
	}

	bool UPI_IsMissingKeyStatus(const FIoStatus& Status)
	{
		return Status.GetErrorCode() == EIoErrorCode::FileOpenFailed &&
			Status.ToString().Contains(TEXT("Missing decryption key"), ESearchCase::IgnoreCase);
	}
}

bool UPI_AnalyzeIoStoreFile(const FString& UtocPath, const FString& UcasPath, const FString& AesKey, FUpiIoStoreAnalysis& OutAnalysis)
{
	OutAnalysis = FUpiIoStoreAnalysis();
	UPI_ResolveIoStorePaths(UtocPath, UcasPath, OutAnalysis.Overview);

	if (OutAnalysis.Overview.ContainerBasePath.IsEmpty())
	{
		OutAnalysis.Issues.Add(TEXT("iostore.path_required"));
		return false;
	}

	if (!IFileManager::Get().FileExists(*OutAnalysis.Overview.UtocPath))
	{
		OutAnalysis.Issues.Add(TEXT("iostore.file_not_found"));
		return false;
	}

	FIoStoreTocHeader TocHeader;
	if (!UPI_ReadTocHeader(OutAnalysis.Overview.UtocPath, TocHeader))
	{
		OutAnalysis.Issues.Add(TEXT("iostore.invalid"));
		return false;
	}
	UPI_FillOverviewFromTocHeader(TocHeader, OutAnalysis);

	TMap<FGuid, FAES::FAESKey> DecryptionKeys;
	if (!AesKey.TrimStartAndEnd().IsEmpty())
	{
		FAES::FAESKey ParsedKey;
		if (!UPI_ParseAesKey(AesKey, ParsedKey))
		{
			OutAnalysis.Issues.Add(TEXT("iostore.aes_key_invalid"));
			return false;
		}
		DecryptionKeys.Add(FGuid(), ParsedKey);
		if (TocHeader.EncryptionKeyGuid.IsValid())
		{
			DecryptionKeys.Add(TocHeader.EncryptionKeyGuid, ParsedKey);
		}
	}
	else if (EnumHasAnyFlags(TocHeader.ContainerFlags, EIoContainerFlags::Encrypted))
	{
		OutAnalysis.Issues.Add(TEXT("iostore.aes_key_required"));
		return false;
	}

	FIoStoreReader Reader;
	const FIoStatus InitializeStatus = Reader.Initialize(*OutAnalysis.Overview.ContainerBasePath, DecryptionKeys);
	if (!InitializeStatus.IsOk())
	{
		if (UPI_IsMissingKeyStatus(InitializeStatus))
		{
			OutAnalysis.Issues.Add(AesKey.TrimStartAndEnd().IsEmpty() ? TEXT("iostore.aes_key_required") : TEXT("iostore.aes_key_invalid"));
		}
		else if (EnumHasAnyFlags(TocHeader.ContainerFlags, EIoContainerFlags::Encrypted) && !AesKey.TrimStartAndEnd().IsEmpty())
		{
			OutAnalysis.Issues.Add(TEXT("iostore.aes_key_invalid"));
		}
		else if (InitializeStatus.GetErrorCode() == EIoErrorCode::FileOpenFailed || InitializeStatus.GetErrorCode() == EIoErrorCode::NotFound)
		{
			OutAnalysis.Issues.Add(TEXT("iostore.file_not_found"));
		}
		else
		{
			OutAnalysis.Issues.Add(TEXT("iostore.invalid"));
		}
		return false;
	}

	UPI_FillPartitions(Reader, OutAnalysis);
	UPI_FillOverview(Reader, OutAnalysis);
	UPI_EnumerateChunksAndBlocks(Reader, OutAnalysis);
	UPI_AggregatePackages(OutAnalysis);

	return true;
}
