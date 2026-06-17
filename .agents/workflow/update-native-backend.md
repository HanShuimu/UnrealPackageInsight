# Update Native Backend

Run this workflow after any change under:

- `ue-backend/**/*.cpp`
- `ue-backend/**/*.h`
- `ue-backend/**/*.cs`

## Build

Use the root npm command:

```powershell
npm.cmd run build -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

This builds and stages `Debug`, `Development`, and `Shipping` native backends for the engine
version in `Engine/Build/Build.version`.

Staged outputs use this shape, where `<configurationKey>` is lowercase (`debug`, `development`,
or `shipping`):

- `node-shell/native/<platform>-<arch>/ue-<major.minor.patch>/<configurationKey>/backend.json`
- `node-shell/native/<platform>-<arch>/ue-<major.minor.patch>/<configurationKey>/UnrealPackageInsightBackend.dll`

For a single configuration during local iteration:

```powershell
npm.cmd run build:native:development -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

## Verify

Before finishing:

- confirm each expected `backend.json` exists,
- confirm each staged `UnrealPackageInsightBackend.dll` exists,
- confirm the build script smoke check completed and printed backend/protocol info such as
  `Backend`, `Unreal`, and `Protocol`,
- run `npm.cmd --prefix node-shell test`.

## Reporting

In the final response, state whether the native backend was rebuilt. If the build could not run
because the EngineRoot is unavailable or Unreal Build Tool failed, report the exact skipped
command and reason.
