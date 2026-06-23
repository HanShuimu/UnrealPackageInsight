#pragma once

#include "Containers/Array.h"
#include "Containers/UnrealString.h"
#include "CoreTypes.h"

struct FUpiExtractResult
{
	FString ContainerPath;
	FString OutputDirectory;
	uint32 ExtractedFileCount = 0;
	uint32 ErrorCount = 0;
	TArray<FString> Issues;
};

bool UPI_ExtractPakFile(const FString& PakPath, const FString& OutputDirectory, const FString& AesKey, FUpiExtractResult& OutResult);
bool UPI_ExtractIoStoreFile(const FString& UtocPath, const FString& UcasPath, const FString& OutputDirectory, const FString& AesKey, FUpiExtractResult& OutResult);
