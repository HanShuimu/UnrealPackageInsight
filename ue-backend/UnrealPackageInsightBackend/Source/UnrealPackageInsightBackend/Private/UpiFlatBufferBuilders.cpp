#include "UpiFlatBufferBuilders.h"

#include "UnrealPackageInsightBackend.h"

#include "Containers/StringConv.h"
#include "HAL/UnrealMemory.h"
#include "Math/NumericLimits.h"
#include "upi_backend_info_generated.h"
#include "upi_extract_response_generated.h"
#include "upi_iostore_analysis_generated.h"
#include "upi_pak_analysis_generated.h"

#include <vector>

namespace
{
	constexpr uint32 UPI_SchemaVersion = 1;
	constexpr uint32 UPI_ProtocolVersion = 1;

	TArray<uint8> UPI_CopyBuilderBytes(const flatbuffers::FlatBufferBuilder& Builder)
	{
		checkf(Builder.GetSize() <= static_cast<size_t>(TNumericLimits<int32>::Max()), TEXT("UPI FlatBuffer response exceeds int32 size"));

		TArray<uint8> ResponseBytes;
		ResponseBytes.Append(Builder.GetBufferPointer(), static_cast<int32>(Builder.GetSize()));
		return ResponseBytes;
	}

	flatbuffers::Offset<flatbuffers::String> UPI_CreateString(flatbuffers::FlatBufferBuilder& Builder, const FString& Value)
	{
		FTCHARToUTF8 Converted(*Value);
		return Builder.CreateString(Converted.Get(), Converted.Length());
	}

	upi::v1::IssueSeverity UPI_IssueSeverityForCode(const FString& IssueCode, bool bSuccess)
	{
		if (!bSuccess ||
			IssueCode == TEXT("pak.path_required") ||
			IssueCode == TEXT("pak.file_not_found") ||
			IssueCode == TEXT("pak.invalid") ||
			IssueCode == TEXT("pak.aes_key_required") ||
			IssueCode == TEXT("pak.aes_key_invalid") ||
			IssueCode == TEXT("pak.index_corrupted") ||
			IssueCode == TEXT("iostore.path_required") ||
			IssueCode == TEXT("iostore.file_not_found") ||
			IssueCode == TEXT("iostore.invalid") ||
			IssueCode == TEXT("iostore.aes_key_required") ||
			IssueCode == TEXT("iostore.aes_key_invalid") ||
			IssueCode == TEXT("extract.path_required") ||
			IssueCode == TEXT("extract.output_directory_required") ||
			IssueCode == TEXT("extract.file_not_found") ||
			IssueCode == TEXT("extract.invalid_output_directory") ||
			IssueCode == TEXT("extract.aes_key_invalid") ||
			IssueCode == TEXT("pak.extract_failed") ||
			IssueCode == TEXT("iostore.extract_failed"))
		{
			return upi::v1::IssueSeverity_Error;
		}

		return upi::v1::IssueSeverity_Warning;
	}

	const TCHAR* UPI_IssueMessageForCode(const FString& IssueCode)
	{
		if (IssueCode == TEXT("pak.path_required"))
		{
			return TEXT("Pak path is required.");
		}
		if (IssueCode == TEXT("pak.file_not_found"))
		{
			return TEXT("Pak file was not found.");
		}
		if (IssueCode == TEXT("pak.invalid"))
		{
			return TEXT("Pak file could not be opened as a valid UE pak.");
		}
		if (IssueCode == TEXT("pak.aes_key_required"))
		{
			return TEXT("Pak index is encrypted and requires an AES key before it can be analyzed.");
		}
		if (IssueCode == TEXT("pak.aes_key_invalid"))
		{
			return TEXT("Encrypted pak index analysis with the provided AES key is not available or failed.");
		}
		if (IssueCode == TEXT("pak.partial_listing"))
		{
			return TEXT("Pak index did not expose filenames for every entry.");
		}
		if (IssueCode == TEXT("pak.index_corrupted"))
		{
			return TEXT("Pak index could not be loaded.");
		}
		if (IssueCode == TEXT("iostore.path_required"))
		{
			return TEXT("IoStore .utoc or .ucas path is required.");
		}
		if (IssueCode == TEXT("iostore.file_not_found"))
		{
			return TEXT("IoStore .utoc or .ucas file was not found.");
		}
		if (IssueCode == TEXT("iostore.invalid"))
		{
			return TEXT("IoStore container could not be opened as a valid UE IoStore container.");
		}
		if (IssueCode == TEXT("iostore.aes_key_required"))
		{
			return TEXT("IoStore container is encrypted and requires an AES key before it can be analyzed.");
		}
		if (IssueCode == TEXT("iostore.aes_key_invalid"))
		{
			return TEXT("IoStore analysis failed with the provided AES key.");
		}
		if (IssueCode == TEXT("iostore.partial_listing"))
		{
			return TEXT("IoStore directory index did not expose filenames for every chunk.");
		}
		if (IssueCode == TEXT("extract.path_required"))
		{
			return TEXT("Container path is required.");
		}
		if (IssueCode == TEXT("extract.output_directory_required"))
		{
			return TEXT("Output directory is required.");
		}
		if (IssueCode == TEXT("extract.file_not_found"))
		{
			return TEXT("Container file was not found.");
		}
		if (IssueCode == TEXT("extract.invalid_output_directory"))
		{
			return TEXT("Output directory could not be created or accessed.");
		}
		if (IssueCode == TEXT("extract.aes_key_invalid"))
		{
			return TEXT("AES key must be a 16-byte or 32-byte hex value.");
		}
		if (IssueCode == TEXT("pak.extract_failed"))
		{
			return TEXT("Pak extraction failed.");
		}
		if (IssueCode == TEXT("iostore.extract_failed"))
		{
			return TEXT("IoStore extraction failed.");
		}

		return *IssueCode;
	}
}

TArray<uint8> UPI_BuildBackendInfoResponse()
{
	flatbuffers::FlatBufferBuilder Builder;
	const auto Response = upi::v1::CreateBackendInfoResponseDirect(
		Builder,
		UPI_SchemaVersion,
		upi::v1::ResponseStatus_Ok,
		nullptr,
		"UnrealPackageInsightBackend",
		"0.2.0",
		"5.x",
		UPI_ProtocolVersion);

	upi::v1::FinishBackendInfoResponseBuffer(Builder, Response);
	return UPI_CopyBuilderBytes(Builder);
}

TArray<uint8> UPI_BuildPakResponseFromAnalysis(const FUpiPakAnalysis& Analysis, bool bSuccess)
{
	flatbuffers::FlatBufferBuilder Builder;

	const auto PakPath = UPI_CreateString(Builder, Analysis.PakPath);
	const auto MountPoint = UPI_CreateString(Builder, Analysis.MountPoint);
	const auto EncryptionKeyGuid = UPI_CreateString(Builder, Analysis.EncryptionKeyGuid);
	const auto Overview = upi::v1::CreatePakOverview(
		Builder,
		PakPath,
		MountPoint,
		Analysis.PakVersion,
		Analysis.PakSize,
		Analysis.bIndexEncrypted,
		EncryptionKeyGuid,
		Analysis.bHasFullDirectoryIndex,
		Analysis.bPartialListing,
		static_cast<uint32>(Analysis.Packages.Num()),
		static_cast<uint32>(Analysis.CompressedBlocks.Num()));

	std::vector<flatbuffers::Offset<upi::v1::Issue>> Issues;
	Issues.reserve(Analysis.Issues.Num());
	for (const FString& IssueCode : Analysis.Issues)
	{
		const auto Code = UPI_CreateString(Builder, IssueCode);
		const auto Message = UPI_CreateString(Builder, UPI_IssueMessageForCode(IssueCode));
		Issues.push_back(upi::v1::CreateIssue(
			Builder,
			UPI_IssueSeverityForCode(IssueCode, bSuccess),
			Code,
			Message));
	}

	std::vector<flatbuffers::Offset<upi::v1::PakPackageEntry>> Packages;
	Packages.reserve(Analysis.Packages.Num());
	for (const FUpiPakPackageRecord& Package : Analysis.Packages)
	{
		const auto PackagePath = UPI_CreateString(Builder, Package.PackagePath);
		const auto PackageMountPoint = UPI_CreateString(Builder, Package.MountPoint);
		const auto Compression = UPI_CreateString(Builder, Package.Compression);
		const auto Hash = UPI_CreateString(Builder, Package.Hash);
		Packages.push_back(upi::v1::CreatePakPackageEntry(
			Builder,
			PackagePath,
			PackageMountPoint,
			Package.Offset,
			Package.PayloadOffset,
			Package.Size,
			Package.CompressedSize,
			Package.RecordSize,
			Compression,
			Package.CompressionMethodIndex,
			Package.CompressionBlockSize,
			Package.CompressionBlockCount,
			Package.FirstCompressedBlockIndex,
			Package.bRelativeBlockOffsets,
			Package.Order,
			Package.Flags,
			Hash,
			Package.bHasPath));
	}

	std::vector<flatbuffers::Offset<upi::v1::PakCompressedBlockEntry>> CompressedBlocks;
	CompressedBlocks.reserve(Analysis.CompressedBlocks.Num());
	for (const FUpiPakCompressedBlockRecord& Block : Analysis.CompressedBlocks)
	{
		CompressedBlocks.push_back(upi::v1::CreatePakCompressedBlockEntry(
			Builder,
			Block.PackageIndex,
			Block.BlockIndex,
			Block.CompressedStart,
			Block.CompressedEnd,
			Block.CompressedSize,
			Block.DiskSize,
			Block.PhysicalStart,
			Block.PhysicalEnd));
	}

	const auto Response = upi::v1::CreatePakAnalysisResponseDirect(
		Builder,
		UPI_SchemaVersion,
		bSuccess ? upi::v1::ResponseStatus_Ok : upi::v1::ResponseStatus_Error,
		&Issues,
		Overview,
		&Packages,
		&CompressedBlocks);

	upi::v1::FinishPakAnalysisResponseBuffer(Builder, Response);
	return UPI_CopyBuilderBytes(Builder);
}

TArray<uint8> UPI_BuildIoStoreResponseFromAnalysis(const FUpiIoStoreAnalysis& Analysis, bool bSuccess)
{
	flatbuffers::FlatBufferBuilder Builder;

	const auto UtocPath = UPI_CreateString(Builder, Analysis.Overview.UtocPath);
	const auto ContainerBasePath = UPI_CreateString(Builder, Analysis.Overview.ContainerBasePath);
	const auto EncryptionKeyGuid = UPI_CreateString(Builder, Analysis.Overview.EncryptionKeyGuid);
	const auto Overview = upi::v1::CreateIoStoreOverview(
		Builder,
		UtocPath,
		ContainerBasePath,
		Analysis.Overview.ContainerId,
		Analysis.Overview.TocVersion,
		Analysis.Overview.TocEntryCount,
		Analysis.Overview.CompressionBlockCount,
		Analysis.Overview.CompressionBlockSize,
		Analysis.Overview.PartitionCount,
		Analysis.Overview.PartitionSize,
		Analysis.Overview.ContainerFlags,
		EncryptionKeyGuid,
		Analysis.Overview.DirectoryIndexSize,
		Analysis.Overview.bIndexed,
		Analysis.Overview.bPartialListing);

	std::vector<flatbuffers::Offset<upi::v1::Issue>> Issues;
	Issues.reserve(Analysis.Issues.Num());
	for (const FString& IssueCode : Analysis.Issues)
	{
		const auto Code = UPI_CreateString(Builder, IssueCode);
		const auto Message = UPI_CreateString(Builder, UPI_IssueMessageForCode(IssueCode));
		Issues.push_back(upi::v1::CreateIssue(
			Builder,
			UPI_IssueSeverityForCode(IssueCode, bSuccess),
			Code,
			Message));
	}

	std::vector<flatbuffers::Offset<upi::v1::IoStorePartition>> Partitions;
	Partitions.reserve(Analysis.Partitions.Num());
	for (const FUpiIoStorePartitionRecord& Partition : Analysis.Partitions)
	{
		const auto UcasPath = UPI_CreateString(Builder, Partition.UcasPath);
		Partitions.push_back(upi::v1::CreateIoStorePartition(
			Builder,
			Partition.PartitionIndex,
			UcasPath,
			Partition.Size));
	}

	std::vector<flatbuffers::Offset<upi::v1::IoStorePackageEntry>> Packages;
	Packages.reserve(Analysis.Packages.Num());
	for (const FUpiIoStorePackageRecord& Package : Analysis.Packages)
	{
		const auto PackagePath = UPI_CreateString(Builder, Package.PackagePath);
		Packages.push_back(upi::v1::CreateIoStorePackageEntry(
			Builder,
			PackagePath,
			Package.PackageId,
			Package.FirstChunkIndex,
			Package.ChunkCount,
			Package.FirstPartitionIndex,
			Package.FirstOffset,
			Package.Size,
			Package.CompressedSize,
			Package.DiskSize,
			Package.Order,
			Package.bHasPath));
	}

	std::vector<flatbuffers::Offset<upi::v1::IoStoreChunkEntry>> Chunks;
	Chunks.reserve(Analysis.Chunks.Num());
	for (const FUpiIoStoreChunkRecord& Chunk : Analysis.Chunks)
	{
		const auto PackagePath = UPI_CreateString(Builder, Chunk.PackagePath);
		const auto ChunkId = UPI_CreateString(Builder, Chunk.ChunkId);
		const auto ChunkType = UPI_CreateString(Builder, Chunk.ChunkType);
		const auto Compression = UPI_CreateString(Builder, Chunk.Compression);
		const auto Hash = UPI_CreateString(Builder, Chunk.Hash);
		Chunks.push_back(upi::v1::CreateIoStoreChunkEntry(
			Builder,
			Chunk.PackageIndex,
			PackagePath,
			Chunk.TocEntryIndex,
			ChunkId,
			ChunkType,
			Chunk.PackageId,
			Chunk.ChunkIndex,
			Chunk.BulkDataCookedIndex,
			Chunk.LogicalOffset,
			Chunk.Offset,
			Chunk.UcasOffset,
			Chunk.Size,
			Chunk.CompressedSize,
			Chunk.DiskSize,
			Compression,
			Chunk.FirstBlockIndex,
			Chunk.BlockCount,
			Chunk.PartitionIndex,
			Chunk.Order,
			Chunk.MetaFlags,
			Chunk.ContainerFlags,
			Hash,
			Chunk.bHasPath));
	}

	std::vector<flatbuffers::Offset<upi::v1::IoStoreCompressedBlockEntry>> CompressedBlocks;
	CompressedBlocks.reserve(Analysis.CompressedBlocks.Num());
	for (const FUpiIoStoreCompressedBlockRecord& Block : Analysis.CompressedBlocks)
	{
		const auto Compression = UPI_CreateString(Builder, Block.Compression);
		CompressedBlocks.push_back(upi::v1::CreateIoStoreCompressedBlockEntry(
			Builder,
			Block.BlockIndex,
			Block.OwnerTocEntryIndex,
			Block.PartitionIndex,
			Block.Offset,
			Block.UcasOffset,
			Block.CompressedSize,
			Block.DiskSize,
			Block.UncompressedSize,
			Compression));
	}

	const auto Response = upi::v1::CreateIoStoreAnalysisResponseDirect(
		Builder,
		UPI_SchemaVersion,
		bSuccess ? upi::v1::ResponseStatus_Ok : upi::v1::ResponseStatus_Error,
		&Issues,
		Overview,
		&Partitions,
		&Packages,
		&Chunks,
		&CompressedBlocks);

	upi::v1::FinishIoStoreAnalysisResponseBuffer(Builder, Response);
	return UPI_CopyBuilderBytes(Builder);
}

TArray<uint8> UPI_BuildExtractResponseFromResult(const FUpiExtractResult& Result, bool bSuccess)
{
	flatbuffers::FlatBufferBuilder Builder;

	std::vector<flatbuffers::Offset<upi::v1::Issue>> Issues;
	Issues.reserve(Result.Issues.Num());
	for (const FString& IssueCode : Result.Issues)
	{
		const auto Code = UPI_CreateString(Builder, IssueCode);
		const auto Message = UPI_CreateString(Builder, UPI_IssueMessageForCode(IssueCode));
		Issues.push_back(upi::v1::CreateIssue(
			Builder,
			UPI_IssueSeverityForCode(IssueCode, bSuccess),
			Code,
			Message));
	}

	const auto ContainerPath = UPI_CreateString(Builder, Result.ContainerPath);
	const auto OutputDirectory = UPI_CreateString(Builder, Result.OutputDirectory);
	const auto Response = upi::v1::CreateExtractResponse(
		Builder,
		UPI_SchemaVersion,
		bSuccess ? upi::v1::ResponseStatus_Ok : upi::v1::ResponseStatus_Error,
		Builder.CreateVector(Issues),
		ContainerPath,
		OutputDirectory,
		Result.ExtractedFileCount,
		Result.ErrorCount);

	upi::v1::FinishExtractResponseBuffer(Builder, Response);
	return UPI_CopyBuilderBytes(Builder);
}

int32_t UPI_CopyResponseBytes(const TArray<uint8>& ResponseBytes, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	if (RequiredSize == nullptr)
	{
		return UPI_CALL_BAD_ARGUMENT;
	}

	*RequiredSize = ResponseBytes.Num();

	if (OutBytes == nullptr || OutCapacity < ResponseBytes.Num())
	{
		return UPI_CALL_BUFFER_TOO_SMALL;
	}

	if (ResponseBytes.Num() > 0)
	{
		FMemory::Memcpy(OutBytes, ResponseBytes.GetData(), ResponseBytes.Num());
	}

	return UPI_CALL_OK;
}
