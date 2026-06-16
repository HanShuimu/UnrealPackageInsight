#pragma once

#include "Containers/Array.h"
#include "PakAnalyzer.h"
#include <stdint.h>

TArray<uint8> UPI_BuildBackendInfoResponse();
TArray<uint8> UPI_BuildPakResponseFromAnalysis(const FUpiPakAnalysis& Analysis, bool bSuccess);
TArray<uint8> UPI_BuildIoStoreStubResponse(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull);
int32_t UPI_CopyResponseBytes(const TArray<uint8>& ResponseBytes, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
