#pragma once

#include "Containers/Array.h"
#include "IoStoreAnalyzer.h"
#include "PakAnalyzer.h"
#include <stdint.h>

TArray<uint8> UPI_BuildBackendInfoResponse();
TArray<uint8> UPI_BuildPakResponseFromAnalysis(const FUpiPakAnalysis& Analysis, bool bSuccess);
TArray<uint8> UPI_BuildIoStoreResponseFromAnalysis(const FUpiIoStoreAnalysis& Analysis, bool bSuccess);
int32_t UPI_CopyResponseBytes(const TArray<uint8>& ResponseBytes, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
