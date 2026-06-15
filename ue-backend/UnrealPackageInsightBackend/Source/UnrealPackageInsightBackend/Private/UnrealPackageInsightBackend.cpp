#include "UnrealPackageInsightBackend.h"

const char* UPI_GetBackendInfo()
{
	return "UnrealPackageInsightBackend/0.1 UE-DLL-Spike";
}

int UPI_Add(int A, int B)
{
	return A + B;
}
