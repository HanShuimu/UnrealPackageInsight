#include "UnrealPackageInsightBackend.h"

#include "PakAnalyzer.h"
#include "UpiFlatBufferBuilders.h"

#include "Containers/StringConv.h"
#include "Modules/ModuleManager.h"

TCHAR GInternalProjectName[64] = TEXT("");
IMPLEMENT_FOREIGN_ENGINE_DIR()

int32_t UPI_GetBackendInfoV1(uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	if (RequiredSize == nullptr)
	{
		return UPI_CALL_BAD_ARGUMENT;
	}

	return UPI_CopyResponseBytes(UPI_BuildBackendInfoResponse(), OutBytes, OutCapacity, RequiredSize);
}

int32_t UPI_AnalyzePakV1(const char* PakPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	if (RequiredSize == nullptr)
	{
		return UPI_CALL_BAD_ARGUMENT;
	}

	const FString PakPath = PakPathUtf8 != nullptr ? FString(UTF8_TO_TCHAR(PakPathUtf8)) : FString();
	const FString AesKey = AesKeyUtf8OrNull != nullptr ? FString(UTF8_TO_TCHAR(AesKeyUtf8OrNull)) : FString();

	FUpiPakAnalysis Analysis;
	const bool bSuccess = UPI_AnalyzePakFile(PakPath, AesKey, Analysis);
	return UPI_CopyResponseBytes(UPI_BuildPakResponseFromAnalysis(Analysis, bSuccess), OutBytes, OutCapacity, RequiredSize);
}

int32_t UPI_AnalyzeIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	if (RequiredSize == nullptr)
	{
		return UPI_CALL_BAD_ARGUMENT;
	}

	return UPI_CopyResponseBytes(UPI_BuildIoStoreStubResponse(UtocPathUtf8, UcasPathUtf8, AesKeyUtf8OrNull), OutBytes, OutCapacity, RequiredSize);
}
