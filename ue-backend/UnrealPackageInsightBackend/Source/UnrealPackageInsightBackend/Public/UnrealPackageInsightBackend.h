#pragma once

#include <stdint.h>

#if defined(_WIN32)
#define UPI_BACKEND_API extern "C" __declspec(dllexport)
#else
#define UPI_BACKEND_API extern "C" __attribute__((visibility("default")))
#endif

enum UPI_CallStatus : int32_t
{
	UPI_CALL_OK = 0,
	UPI_CALL_BUFFER_TOO_SMALL = 1,
	UPI_CALL_BAD_ARGUMENT = 2,
	UPI_CALL_INTERNAL_ERROR = 3
};

UPI_BACKEND_API int32_t UPI_GetBackendInfoV1(uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
UPI_BACKEND_API int32_t UPI_AnalyzePakV1(const char* PakPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
UPI_BACKEND_API int32_t UPI_AnalyzeIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
