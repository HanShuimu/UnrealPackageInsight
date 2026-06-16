#include "UpiFlatBufferBuilders.h"

#include "UnrealPackageInsightBackend.h"

#include "Containers/StringConv.h"
#include "HAL/UnrealMemory.h"
#include "Math/NumericLimits.h"
#include "upi_backend_info_generated.h"
#include "upi_iostore_analysis_generated.h"
#include "upi_pak_analysis_generated.h"

#include <vector>

namespace
{
	constexpr uint32 UPI_SchemaVersion = 1;
	constexpr uint32 UPI_ProtocolVersion = 1;
	constexpr const char* UPI_StubPackagePath = "/Game/Stub/Asset.uasset";

	TArray<uint8> UPI_CopyBuilderBytes(const flatbuffers::FlatBufferBuilder& Builder)
	{
		checkf(Builder.GetSize() <= static_cast<size_t>(TNumericLimits<int32>::Max()), TEXT("UPI FlatBuffer response exceeds int32 size"));

		TArray<uint8> ResponseBytes;
		ResponseBytes.Append(Builder.GetBufferPointer(), static_cast<int32>(Builder.GetSize()));
		return ResponseBytes;
	}

	const char* UPI_NonNullUtf8(const char* Value)
	{
		return Value != nullptr ? Value : "";
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
			IssueCode == TEXT("pak.index_corrupted"))
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

TArray<uint8> UPI_BuildIoStoreStubResponse(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull)
{
	(void)AesKeyUtf8OrNull;

	flatbuffers::FlatBufferBuilder Builder;

	const auto Overview = upi::v1::CreateIoStoreOverviewDirect(
		Builder,
		UPI_NonNullUtf8(UtocPathUtf8),
		"",
		0,
		0,
		1,
		1,
		65536,
		1,
		1024,
		0,
		"",
		0,
		true,
		false);

	std::vector<flatbuffers::Offset<upi::v1::IoStorePartition>> Partitions;
	Partitions.push_back(upi::v1::CreateIoStorePartitionDirect(
		Builder,
		0,
		UPI_NonNullUtf8(UcasPathUtf8),
		1024));

	std::vector<flatbuffers::Offset<upi::v1::IoStorePackageEntry>> Packages;
	Packages.push_back(upi::v1::CreateIoStorePackageEntryDirect(
		Builder,
		UPI_StubPackagePath,
		1,
		0,
		1,
		0,
		0,
		1024,
		512,
		512,
		0,
		true));

	std::vector<flatbuffers::Offset<upi::v1::IoStoreChunkEntry>> Chunks;
	Chunks.push_back(upi::v1::CreateIoStoreChunkEntryDirect(
		Builder,
		0,
		UPI_StubPackagePath,
		0,
		"00000000000000000000000000000000",
		"ExportBundleData",
		1,
		0,
		0,
		0,
		0,
		0,
		1024,
		512,
		512,
		"Zlib",
		0,
		1,
		0,
		0,
		0,
		0,
		"",
		true));

	std::vector<flatbuffers::Offset<upi::v1::IoStoreCompressedBlockEntry>> CompressedBlocks;
	CompressedBlocks.push_back(upi::v1::CreateIoStoreCompressedBlockEntryDirect(
		Builder,
		0,
		0,
		0,
		0,
		0,
		512,
		512,
		1024,
		"Zlib"));

	const auto Response = upi::v1::CreateIoStoreAnalysisResponseDirect(
		Builder,
		UPI_SchemaVersion,
		upi::v1::ResponseStatus_Ok,
		nullptr,
		Overview,
		&Partitions,
		&Packages,
		&Chunks,
		&CompressedBlocks);

	upi::v1::FinishIoStoreAnalysisResponseBuffer(Builder, Response);
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
