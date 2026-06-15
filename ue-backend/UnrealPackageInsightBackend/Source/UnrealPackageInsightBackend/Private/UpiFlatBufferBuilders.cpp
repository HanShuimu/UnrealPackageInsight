#include "UpiFlatBufferBuilders.h"

#include "UnrealPackageInsightBackend.h"

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

TArray<uint8> UPI_BuildPakStubResponse(const char* PakPathUtf8, const char* AesKeyUtf8OrNull)
{
	(void)AesKeyUtf8OrNull;

	flatbuffers::FlatBufferBuilder Builder;

	const auto Overview = upi::v1::CreatePakOverviewDirect(
		Builder,
		UPI_NonNullUtf8(PakPathUtf8),
		"/Game/",
		0,
		0,
		false,
		"",
		true,
		false,
		1,
		1);

	std::vector<flatbuffers::Offset<upi::v1::PakPackageEntry>> Packages;
	Packages.push_back(upi::v1::CreatePakPackageEntryDirect(
		Builder,
		UPI_StubPackagePath,
		"/Game/",
		0,
		0,
		1024,
		512,
		128,
		"Zlib",
		1,
		65536,
		1,
		0,
		false,
		0,
		0,
		"",
		true));

	std::vector<flatbuffers::Offset<upi::v1::PakCompressedBlockEntry>> CompressedBlocks;
	CompressedBlocks.push_back(upi::v1::CreatePakCompressedBlockEntry(
		Builder,
		0,
		0,
		0,
		512,
		512,
		512,
		0,
		512));

	const auto Response = upi::v1::CreatePakAnalysisResponseDirect(
		Builder,
		UPI_SchemaVersion,
		upi::v1::ResponseStatus_Ok,
		nullptr,
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
