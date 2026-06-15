#include "UnrealPackageInsightBackend.h"

#include "UpiFlatBufferBuilders.h"

#include "Modules/ModuleManager.h"

TCHAR GInternalProjectName[64] = TEXT("");
IMPLEMENT_FOREIGN_ENGINE_DIR()

int32_t UPI_GetBackendInfoV1(uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	return UPI_CopyResponseBytes(UPI_BuildBackendInfoResponse(), OutBytes, OutCapacity, RequiredSize);
}

int32_t UPI_AnalyzePakV1(const char* PakPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	return UPI_CopyResponseBytes(UPI_BuildPakStubResponse(PakPathUtf8, AesKeyUtf8OrNull), OutBytes, OutCapacity, RequiredSize);
}

int32_t UPI_AnalyzeIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	return UPI_CopyResponseBytes(UPI_BuildIoStoreStubResponse(UtocPathUtf8, UcasPathUtf8, AesKeyUtf8OrNull), OutBytes, OutCapacity, RequiredSize);
}
