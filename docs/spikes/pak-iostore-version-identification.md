# Pak / IoStore 引擎版本识别调研

日期：2026-06-17

## 问题

UnrealPackageInsight 是否能从 Unreal Engine 的 `.pak`、`.utoc`、`.ucas` 文件中简单判断它们是由哪个 Unreal Engine 版本生成的？

进一步说：

- Pak 文件头或尾部是否包含 `UE 5.3`、`UE 5.7.4` 这类引擎版本？
- IoStore 的 `.utoc` / `.ucas` 头部是否包含引擎版本？
- 如果没有直接字段，工具层还能可靠展示哪些版本信息？

本次调研基于本地 Unreal Engine 源码：

```text
C:\WORKSPACE_UE\UnrealEngine
```

当前本地引擎源码版本信息来自：

```text
C:\WORKSPACE_UE\UnrealEngine\Engine\Build\Build.version
```

该源码为 `5.7.4`，但这不代表它生成的 Pak / IoStore 容器会把 `5.7.4` 写入容器头部。

## 结论摘要

不能仅凭 Pak / IoStore 容器头部或尾部精确判断 Unreal Engine 发行版本。

容器层保存的是“容器格式版本”，不是“引擎发行版本”：

- Pak 的 `FPakInfo::Version` 是 Pak 格式版本，例如 `PakFile_Version_Utf8PakDirectory = 12`。
- IoStore 的 `FIoStoreTocHeader::Version` 是 TOC 格式版本，例如 `EIoStoreTocVersion::ReplaceIoChunkHashWithIoHash`。
- IoStore 的 `FIoContainerHeader` 也只有自己的 header format version 和 package store 数据，没有 `FEngineVersion`。
- `.ucas` 主要保存数据块，本身不提供独立资源目录或引擎版本；必须配合 `.utoc` 解读。

如果要推断引擎版本，应读取容器内 package 的版本信息：

- 普通 package summary 可能有 `FPackageFileSummary::SavedByEngineVersion` 和 `CompatibleWithEngineVersion`。
- cooked package 经常会把这些 engine version 字段写为空版本。
- IoStore Zen package header 可能带 `FZenPackageVersioningInfo`，其中有 package file version 和 custom versions，但仍不是 `UE 5.x.y` 发行版号。
- unversioned cooked content 甚至会省略原始 package/custom version 信息，加载时由当前引擎补成当前版本，这不能反推原始保存版本。

因此，产品上应展示“容器格式版本 + package file version + custom versions + 是否 unversioned + 可选的 engine version 字段”，而不是承诺“精确 UE 版本”。如果需要显示 `疑似 UE 5.x`，应通过外部维护的映射表做启发式推断，并标注置信度。

## Pak 容器层版本

Pak 的核心容器元信息是 `FPakInfo`。它不是常规文件头，而是写在 Pak 文件末尾的 trailer / footer。

源码依据：

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Public\IPlatformFilePak.h:137` 定义 `FPakInfo`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Public\IPlatformFilePak.h:151` 定义 Pak 格式版本枚举。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Public\IPlatformFilePak.h:173` 定义 `Magic`、`Version`、`IndexOffset`、`IndexSize`、`IndexHash`、`bEncryptedIndex`、`EncryptionKeyGuid`、`CompressionMethods` 等字段。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Private\PakFile.cpp:272` 从文件末尾尝试读取 `FPakInfo`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\PakFileUtilities\Private\PakFileUtilities.cpp:3245` 写入 `FPakInfo` 到 Pak 文件末尾。

`FPakInfo` 中可读到：

```text
Magic
Pak format version
Primary index offset
Primary index size
Primary index hash
Encrypted index flag
Encryption key guid
Compression method table
```

它不包含：

```text
UE major/minor/patch
Build.version
FEngineVersion
SavedByEngineVersion
CompatibleWithEngineVersion
BranchName
Changelist
```

Pak 格式版本只能表达容器功能点。例如当前源码中的版本包括：

```text
PakFile_Version_Initial = 1
PakFile_Version_NoTimestamps = 2
PakFile_Version_CompressionEncryption = 3
PakFile_Version_IndexEncryption = 4
PakFile_Version_RelativeChunkOffsets = 5
PakFile_Version_DeleteRecords = 6
PakFile_Version_EncryptionKeyGuid = 7
PakFile_Version_FNameBasedCompressionMethod = 8
PakFile_Version_FrozenIndex = 9
PakFile_Version_PathHashIndex = 10
PakFile_Version_Fnv64BugFix = 11
PakFile_Version_Utf8PakDirectory = 12
```

这些数值可以作为兼容性和解析策略依据，但不能唯一映射到 `UE 5.2`、`UE 5.3`、`UE 5.7.4`。

## IoStore TOC 版本

IoStore 的主要容器元数据在 `.utoc` 文件中。`.ucas` 是数据块文件，资源边界和目录信息需要从 `.utoc` 派生。

源码依据：

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoStore.h:25` 定义 `EIoStoreTocVersion`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoStore.h:43` 定义 `FIoStoreTocHeader`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoStore.cpp:1247` 读取 `.utoc`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoStore.cpp:1507` 写入 `.utoc` header。

`FIoStoreTocHeader` 中可读到：

```text
TocMagic
TOC format version
TOC header size
TOC entry count
Compression block entry count
Compression method name count/length
Compression block size
Directory index size
Partition count
Partition size
Container id
Encryption key guid
Container flags
Perfect hash metadata
```

它不包含：

```text
UE major/minor/patch
Build.version
FEngineVersion
SavedByEngineVersion
CompatibleWithEngineVersion
BranchName
Changelist
```

当前源码里的 `EIoStoreTocVersion` 是 TOC 格式演进：

```text
Invalid = 0
Initial
DirectoryIndex
PartitionSize
PerfectHash
PerfectHashWithOverflow
OnDemandMetaData
RemovedOnDemandMetaData
ReplaceIoChunkHashWithIoHash
Latest = ReplaceIoChunkHashWithIoHash
```

这同样只能说明 `.utoc` 使用了哪个 TOC 格式，不能唯一说明引擎发行版本。

## IoStore Container Header

IoStore 还有一个 container header chunk，结构是 `FIoContainerHeader`。它不是 `.utoc` 文件最开头的物理 header，而是容器内的一个 `EIoChunkType::ContainerHeader` chunk。

源码依据：

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Public\IO\IoContainerHeader.h:96` 定义 `EIoContainerHeaderVersion`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Public\IO\IoContainerHeader.h:109` 定义 `FIoContainerHeader`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoContainerHeader.cpp:49` 序列化 `FIoContainerHeader`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Private\IoDispatcherFileBackend.cpp:850` 读取 container header chunk。

`FIoContainerHeader` 保存：

```text
Signature
Container header format version
Container id
Package ids
Package store entries
Optional segment package ids
Redirects name map
Localized packages
Package redirects
Soft package references
```

它同样不保存 `FEngineVersion`。

## Package 层版本信息

如果目标是推断资产来自哪个引擎版本，应该进入 package 层，而不是只看容器层。

普通 package 的 `FPackageFileSummary` 包含：

- `FileVersionUE`
- `FileVersionLicenseeUE`
- `CustomVersionContainer`
- `SavedByEngineVersion`
- `CompatibleWithEngineVersion`
- `bUnversioned`

源码依据：

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Public\UObject\PackageFileSummary.h:56` 定义 `FPackageFileSummary`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Public\UObject\PackageFileSummary.h:224` 定义 `SavedByEngineVersion` 和 `CompatibleWithEngineVersion`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Private\UObject\LinkerSave.cpp:111` 非 cooked 保存时写入 `FEngineVersion::Current()` 和 `FEngineVersion::CompatibleWith()`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Private\UObject\PackageFileSummary.cpp:397` package summary 序列化 engine version 字段。

关键限制：

```text
if (BaseArchive.IsCooking() || (BaseArchive.IsSaving() && !FEngineVersion::Current().HasChangelist()))
{
    FEngineVersion EmptyEngineVersion;
    Record << SavedByEngineVersion / CompatibleWithEngineVersion;
}
```

也就是说，cooked 包常见情况下会写空 engine version。即使 package summary 格式支持 `SavedByEngineVersion`，发布产物里也不一定保留。

unversioned package 的行为也会影响判断：

- 保存时 `FileVersionUE4`、`FileVersionUE5`、`FileVersionLicenseeUE4` 写 0。
- 加载时如果允许 unversioned content，UE 会把内存里的 `FileVersionUE` 替换成当前引擎支持的最新版本。
- 这个替换结果不能反推出文件原始保存版本。

源码依据：

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Private\UObject\PackageFileSummary.cpp:137` 读取 package file version。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Private\UObject\PackageFileSummary.cpp:147` 判断 `bUnversioned`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Private\UObject\PackageFileSummary.cpp:160` unversioned 加载时使用当前最新版本。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Private\UObject\PackageFileSummary.cpp:204` unversioned 保存时写 0。

## IoStore Zen Package Versioning

IoStore 构建 Zen package header 时，会从 cooked package header 中提取 package 版本信息，但只有非 unversioned 包才会写入。

源码依据：

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\PackageStoreOptimizer.cpp:108` 判断 cooked package 是否 unversioned。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\PackageStoreOptimizer.cpp:110` 写入 `FZenPackageVersioningInfo`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Public\Serialization\AsyncLoading2.h:283` 定义 `FZenPackageVersioningInfo`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Private\Serialization\AsyncLoading2.cpp:122` 序列化 `FZenPackageVersioningInfo`。

`FZenPackageVersioningInfo` 包含：

```text
ZenVersion
PackageVersion
LicenseeVersion
CustomVersions
```

它不包含：

```text
SavedByEngineVersion
CompatibleWithEngineVersion
UE major/minor/patch
Build.version
```

这意味着 IoStore package 层可以提供比 `.utoc` header 更强的版本线索，但仍然不是引擎发行版字段。

## 可实现的工具展示字段

建议 UnrealPackageInsight 将版本相关信息分为三层展示。

### 容器格式版本

Pak：

```text
containerType = Pak
pakFormatVersionNumber = FPakInfo::Version
pakFormatVersionName = PakFile_Version_*
hasEncryptedIndex = FPakInfo::bEncryptedIndex
encryptionKeyGuid = FPakInfo::EncryptionKeyGuid
compressionMethods = FPakInfo::CompressionMethods
```

IoStore：

```text
containerType = IoStore
tocFormatVersionNumber = FIoStoreTocHeader::Version
tocFormatVersionName = EIoStoreTocVersion::*
containerHeaderVersionNumber = EIoContainerHeaderVersion::* if container header is readable
containerFlags = FIoStoreTocHeader::ContainerFlags
encryptionKeyGuid = FIoStoreTocHeader::EncryptionKeyGuid
partitionCount = FIoStoreTocHeader::PartitionCount
partitionSize = FIoStoreTocHeader::PartitionSize
```

### Package 序列化版本

普通 package：

```text
fileVersionUE4
fileVersionUE5
fileVersionLicenseeUE
customVersions
bUnversioned
savedByEngineVersion if non-empty
compatibleWithEngineVersion if non-empty
```

IoStore Zen package：

```text
zenVersion
packageVersionUE4
packageVersionUE5
licenseeVersion
customVersions
hasVersioningInfo
```

### 推断结果

```text
engineVersionInference:
  kind: Exact | Range | Unknown
  value: string
  confidence: High | Medium | Low
  evidence:
    - container format version
    - package file version
    - custom version guids
    - saved engine version if present
    - compatible engine version if present
```

推荐规则：

- 如果 `SavedByEngineVersion` 非空，可展示为最强证据，但仍需注明来自 package summary，不是容器 header。
- 如果只有 package file version/custom versions，可展示为“版本范围/最低版本线索”。
- 如果 package 是 unversioned，直接展示 `Unknown` 或 `Unversioned cooked content`。
- 不要把 `FPakInfo::Version` 或 `FIoStoreTocHeader::Version` 直接显示为 UE 版本。

## 对产品文案的建议

推荐文案：

```text
Container format: Pak v12
Engine version: Not stored in Pak footer
Package version evidence: unavailable / unversioned / UE5 object version ...
Inference: Unknown
```

或：

```text
Container format: IoStore TOC ReplaceIoChunkHashWithIoHash
Engine version: Not stored in .utoc header
Package version evidence: Zen package versioning info present
Inference: Range, based on package file version and custom versions
```

避免文案：

```text
Pak version 12 means UE 5.7
IoStore TOC version 8 means UE 5.7
This container was created by UE 5.x
```

除非我们额外维护并验证发行版映射表，否则这些说法都不可靠。

## 后续实现建议

1. 在 backend 输出容器格式版本，但字段名必须明确为 `pakFormatVersion` / `tocFormatVersion`。
2. 如果解析 package summary 或 Zen package header，单独输出 `packageVersion`。
3. 增加 `isUnversioned` 和 `engineVersionPresent` 字段，避免 UI 误判。
4. 若要做 UE 版本推断，新增独立的 inference 模块，不要写死在容器 parser 内。
5. inference 模块的映射表需要带来源和置信度，例如：

```text
packageVersionUE5 >= DATA_RESOURCES => at least a UE5-era package format
packageVersionUE5 >= IMPORT_TYPE_HIERARCHIES => at least the engine branch that introduced that object version
```

但对象版本枚举本身是序列化功能点列表，不是发行版列表。映射到 `UE 5.4`、`UE 5.5`、`UE 5.7` 需要额外查证发行分支源码或发布 tag。

