#pragma once

#include "Containers/Array.h"
#include "Containers/UnrealString.h"
#include "CoreTypes.h"

struct FUpiPakPackageRecord
{
	FString PackagePath;
	FString MountPoint;
	uint64 Offset = 0;
	uint64 PayloadOffset = 0;
	uint64 Size = 0;
	uint64 CompressedSize = 0;
	uint64 RecordSize = 0;
	FString Compression;
	uint32 CompressionMethodIndex = 0;
	uint32 CompressionBlockSize = 0;
	uint32 CompressionBlockCount = 0;
	uint32 FirstCompressedBlockIndex = 0;
	bool bRelativeBlockOffsets = false;
	uint32 Order = 0;
	uint32 Flags = 0;
	FString Hash;
	bool bHasPath = false;
};

struct FUpiPakCompressedBlockRecord
{
	uint32 PackageIndex = 0;
	uint32 BlockIndex = 0;
	uint64 CompressedStart = 0;
	uint64 CompressedEnd = 0;
	uint64 CompressedSize = 0;
	uint64 DiskSize = 0;
	uint64 PhysicalStart = 0;
	uint64 PhysicalEnd = 0;
};

struct FUpiPakAnalysis
{
	FString PakPath;
	FString MountPoint;
	uint32 PakVersion = 0;
	uint64 PakSize = 0;
	bool bIndexEncrypted = false;
	FString EncryptionKeyGuid;
	bool bHasFullDirectoryIndex = true;
	bool bPartialListing = false;
	TArray<FString> Issues;
	TArray<FUpiPakPackageRecord> Packages;
	TArray<FUpiPakCompressedBlockRecord> CompressedBlocks;
};

bool UPI_AnalyzePakFile(const FString& PakPath, const FString& AesKey, FUpiPakAnalysis& OutAnalysis);
