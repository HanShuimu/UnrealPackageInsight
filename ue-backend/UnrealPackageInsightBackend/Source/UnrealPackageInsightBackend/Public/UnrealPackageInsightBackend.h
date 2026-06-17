#pragma once

#include <stdint.h>

#ifdef __cplusplus
#define UPI_EXTERN_C extern "C"
#else
#define UPI_EXTERN_C
#endif

#if defined(_WIN32)
#define UPI_BACKEND_API UPI_EXTERN_C __declspec(dllexport)
#else
#define UPI_BACKEND_API UPI_EXTERN_C __attribute__((visibility("default")))
#endif

typedef enum UPI_CallStatus
{
	UPI_CALL_OK = 0,
	UPI_CALL_BUFFER_TOO_SMALL = 1,
	UPI_CALL_BAD_ARGUMENT = 2,
	UPI_CALL_INTERNAL_ERROR = 3
} UPI_CallStatus;

UPI_BACKEND_API int32_t UPI_GetBackendInfoV1(uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
UPI_BACKEND_API int32_t UPI_AnalyzePakV1(const char* PakPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
UPI_BACKEND_API int32_t UPI_AnalyzeIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
