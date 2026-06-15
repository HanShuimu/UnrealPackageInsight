#include "UnrealPackageInsightBackend.h"

#include "Modules/ModuleManager.h"

TCHAR GInternalProjectName[64] = TEXT("");
IMPLEMENT_FOREIGN_ENGINE_DIR()

const char* UPI_GetBackendInfo()
{
	return "UnrealPackageInsightBackend/0.1 UE-DLL-Spike";
}

int UPI_Add(int A, int B)
{
	return A + B;
}
