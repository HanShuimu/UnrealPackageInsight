#pragma once

#if defined(_WIN32)
#define UPI_BACKEND_API extern "C" __declspec(dllexport)
#else
#define UPI_BACKEND_API extern "C" __attribute__((visibility("default")))
#endif

UPI_BACKEND_API const char* UPI_GetBackendInfo();
UPI_BACKEND_API int UPI_Add(int A, int B);
