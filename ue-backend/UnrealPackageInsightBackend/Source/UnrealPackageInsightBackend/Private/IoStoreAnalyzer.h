#pragma once

#include "Containers/Array.h"
#include "Containers/UnrealString.h"
#include "CoreTypes.h"

struct FUpiIoStoreOverview
{
	FString UtocPath;
	FString ContainerBasePath;
	uint64 ContainerId = 0;
	uint32 TocVersion = 0;
	uint32 TocEntryCount = 0;
	uint32 CompressionBlockCount = 0;
	uint32 CompressionBlockSize = 0;
	uint32 PartitionCount = 0;
	uint64 PartitionSize = 0;
	uint32 ContainerFlags = 0;
	FString EncryptionKeyGuid;
	uint32 DirectoryIndexSize = 0;
	bool bIndexed = false;
	bool bPartialListing = false;
};

struct FUpiIoStorePartitionRecord
{
	uint32 PartitionIndex = 0;
	FString UcasPath;
	uint64 Size = 0;
};

struct FUpiIoStorePackageRecord
{
	FString PackagePath;
	uint64 PackageId = 0;
	uint32 FirstChunkIndex = 0;
	uint32 ChunkCount = 0;
	uint32 FirstPartitionIndex = 0;
	uint64 FirstOffset = 0;
	uint64 Size = 0;
	uint64 CompressedSize = 0;
	uint64 DiskSize = 0;
	uint32 Order = 0;
	bool bHasPath = false;
};

struct FUpiIoStoreChunkRecord
{
	uint32 PackageIndex = UINT32_MAX;
	FString PackagePath;
	uint32 TocEntryIndex = 0;
	FString ChunkId;
	FString ChunkType;
	uint64 PackageId = 0;
	uint32 ChunkIndex = 0;
	uint32 BulkDataCookedIndex = 0;
	uint64 LogicalOffset = 0;
	uint64 Offset = 0;
	uint64 UcasOffset = 0;
	uint64 Size = 0;
	uint64 CompressedSize = 0;
	uint64 DiskSize = 0;
	FString Compression;
	uint32 FirstBlockIndex = 0;
	uint32 BlockCount = 0;
	uint32 PartitionIndex = 0;
	uint32 Order = 0;
	uint32 MetaFlags = 0;
	uint32 ContainerFlags = 0;
	FString Hash;
	bool bHasPath = false;
};

struct FUpiIoStoreCompressedBlockRecord
{
	uint32 BlockIndex = 0;
	uint32 OwnerTocEntryIndex = 0;
	uint32 PartitionIndex = 0;
	uint64 Offset = 0;
	uint64 UcasOffset = 0;
	uint32 CompressedSize = 0;
	uint32 DiskSize = 0;
	uint32 UncompressedSize = 0;
	FString Compression;
};

struct FUpiIoStoreAnalysis
{
	FUpiIoStoreOverview Overview;
	TArray<FString> Issues;
	TArray<FUpiIoStorePartitionRecord> Partitions;
	TArray<FUpiIoStorePackageRecord> Packages;
	TArray<FUpiIoStoreChunkRecord> Chunks;
	TArray<FUpiIoStoreCompressedBlockRecord> CompressedBlocks;
};

bool UPI_AnalyzeIoStoreFile(const FString& UtocPath, const FString& UcasPath, const FString& AesKey, FUpiIoStoreAnalysis& OutAnalysis);
