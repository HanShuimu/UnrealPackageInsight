# IoStore legacy uasset header 还原调研

日期：2026-06-23

## 背景

在为 UnrealPackageInsight 实现 Pak、UCAS/UTOC 的 Extract 功能时，当前实现刻意复用 Unreal Engine/UnrealPak 的原生提取能力：

- Pak 使用 UnrealPak 同款 extract 流程。
- IoStore 使用 `ExtractFilesFromIoStoreContainer` 同款逻辑。

用户在提取下面这个 IoStore 容器时发现，提取结果和原始 cooked loose 文件树不一致：

```text
C:\WORKSPACE_RA\RATrunk\LocalBuilds\Game\Windows\Zero\Saved\PersistentDownloadDir\Debug\Zero\Content\Paks\Additional.ucas
```

期望还原到的 cooked loose 文件树中存在：

```text
C:\WORKSPACE_RA\RATrunk\Trunk\Saved\AssetUpdate\Cooked\Windows\Zero\Content\SlashZero\UI\Interface\W_Login_Main.uasset
C:\WORKSPACE_RA\RATrunk\Trunk\Saved\AssetUpdate\Cooked\Windows\Zero\Content\SlashZero\UI\Interface\W_Login_Main.uexp
```

但 UE 原生 IoStore 提取结果是：

```text
C:\WORKSPACE_UE\Test\Zero\Content\SlashZero\UI\Interface\W_Login_Main.uheader
C:\WORKSPACE_UE\Test\Zero\Content\SlashZero\UI\Interface\W_Login_Main.uexp
```

## 结论

这是 Unreal Engine 原生 IoStore 提取能力的行为限制，不是 UnrealPackageInsight 自己的 mount point 计算错误。

对同一份 `Additional.ucas`，使用 UE 自带 `UnrealPak.exe` 提取后得到的文件布局、文件名、大小和 hash 与 UnrealPackageInsight 当前实现一致：`.uexp` 可以字节一致提取，`.uasset` 会以 Zen package header 的形式输出为 `.uheader`，无法直接得到原始 cooked loose `.uasset`。

标准 `.ucas/.utoc`、标准 `packagestore.manifest`、标准 Cook Metadata、标准 ZenServer/ZenStore oplog 中都没有足够信息把 `.uheader` 反推出字节一致的 legacy `.uasset` header。要精确还原，必须找到外部保存的原始 cooked loose 文件，或者在未来 cook/ZenStore 写入阶段额外保存 legacy header bytes。

## 样例对比

源 cooked loose 目录：

```text
C:\WORKSPACE_RA\RATrunk\Trunk\Saved\AssetUpdate\Cooked\Windows\Zero\Content\SlashZero\UI\Interface
```

UE/UPI 提取目录：

```text
C:\WORKSPACE_UE\Test\Zero\Content\SlashZero\UI\Interface
```

文件对比：

| 文件 | 大小 | SHA256 |
| --- | ---: | --- |
| 源 `W_Login_Main.uasset` | 84052 | `F23EC297339942FB13CC523945F6F8A5E1176A2AE97E14FAB72C39967DF5ADF8` |
| 提取 `W_Login_Main.uheader` | 69334 | `33D0D4B3938E0EA4625C763C48D45217959F431FA738FC1A4BCCFA4E6393D0D9` |
| 源 `W_Login_Main.uexp` | 253388 | `DC055B9E44206C6369FEAF417589E954388A83CD86250E8A55E80B8484B8AD1B` |
| 提取 `W_Login_Main.uexp` | 253388 | `DC055B9E44206C6369FEAF417589E954388A83CD86250E8A55E80B8484B8AD1B` |

关键现象：

- `.uexp` 字节一致。
- `.uasset` 与 `.uheader` 不一致。
- 源 `.uasset` 以 legacy `PACKAGE_FILE_TAG` 开头。
- 提取 `.uheader` 以 `FZenPackageSummary` 开头。
- `.utoc` 列表中 logical entry 仍显示 `W_Login_Main.uasset`，但 UE 提取时会把 `ExportBundleData` 拆成 `.uheader + .uexp`。

## UE 原生提取逻辑

源码位置：

```text
C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\IoStoreUtilities.cpp
```

`ProcessFilesFromIoStoreContainer` 会根据 `ChunkInfo.FileName` 计算输出路径，并做安全路径归一化。对于 `EIoChunkType::ExportBundleData`，UE 不会写回 legacy `.uasset`，而是：

1. 把 chunk data 解释为 `FZenPackageSummary`。
2. 使用 `FZenPackageSummary::HeaderSize` 切出 Zen header。
3. 把 header 写成 `.uheader`。
4. 把剩余 export data 写成 `.uexp`。

因此路径和 mount point 是正确的，差异来自 IoStore package data 的格式转换。

## legacy header 在哪里丢失

源码位置：

```text
C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\PackageStoreOptimizer.cpp
C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\CoreUObject\Public\Serialization\AsyncLoading2.h
```

IoStore 写入阶段会把 cooked loose `.uasset` 的 legacy package header 转换成 Zen package header：

- `CreatePackageFromCookedHeader` 读取 legacy cooked header。
- `LoadCookedHeader` 读取 `FPackageFileSummary`、name map、import map、export map、preload dependencies、data resources、soft package refs 等。
- `FinalizePackageHeader` 生成新的 `FZenPackageSummary` header。
- `CreatePackageBuffer` 输出 `HeaderBuffer + CookedExportsDataBuffer`。

`FZenPackageSummary` 是为 AsyncLoading2/IoStore 加载优化后的紧凑结构，它不是 `FPackageFileSummary` 的可逆序列化。许多 legacy header 原始字段、表布局、offset、padding、序列化细节不会被原样保存。

`FZenPackageSummary::_Unused` 注释为 `Was CookedHeaderSize`，但它不是原始 header bytes，也不足以反向恢复 legacy `.uasset`。

## ZenStore 中是否有可利用信息

源码位置：

```text
C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\ZenStoreWriter.cpp
C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\CookedPackageStore.cpp
C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\ZenStoreHttpClient.cpp
```

标准 ZenStore 有用，但默认不能提供原始 legacy header。

`FZenStoreWriter::WritePackageData` 中，UE 先把 `ExportsArchive` 按 `Info.HeaderSize` 切成：

- `CookedHeaderBuffer`
- `CookedExportsBuffer`

随后调用：

```text
PackageStoreOptimizer->CreatePackageFromCookedHeader(...)
PackageStoreOptimizer->CreatePackageBuffer(...)
```

写入 ZenStore oplog 的 `packagedata.data` attachment 是转换后的 Zen package payload，不是转换前的 cooked loose `.uasset` header。

`FZenStoreWriter::GetPreviousCookedBytes` 从 Zen 读取 previous cooked bytes 时，也把 buffer 开头解释成 `FZenPackageSummary`，说明 Zen 中保存的是 Zen package buffer。

`FCookedPackageStore::ParseOplog` 解析 oplog 时只收集：

- package store entry
- packagedata/bulkdata/files chunk id
- filename/clientpath
- file regions

这些信息可以帮助定位、校验、构造功能性输出，但不能重建字节一致的 legacy `.uasset` header。

### ZenStore 的可改造点

Zen oplog 支持非保留 key 的自定义 attachment。`FZenStoreWriter::CommitPackageInternal` 会把 `CommitInfo.Attachments` 中 `EFieldStorage::Attachment` 的非保留 key 写入 oplog。

所以未来可以在 cook/ZenStoreWriter 阶段额外保存一份 legacy header bytes，例如：

```text
LegacyCookedHeader
LegacyCookedHeaderSize
LegacyPackageExtension
```

UPI 提取时如果能访问对应 ZenStore/oplog attachment，就可以优先用这份 sidecar/attachment 还原 `.uasset`。没有这个额外保存的数据时，标准 ZenStore 无法补回原始 header。

## Cook Metadata 和构建产物

样例 cooked metadata 目录：

```text
C:\WORKSPACE_RA\RATrunk\Trunk\Saved\AssetUpdate\Cooked\Windows\Zero\Metadata
```

观察到的文件包括：

- `AllChunksInfo.csv`
- `CookedIniVersion.txt`
- `CookedSettings.txt`
- `CookMetadata.ucookmeta`
- `DevelopmentAssetRegistry.bin`
- `packagestore.manifest`
- `ReferencedSet.txt`
- `scriptobjects.bin`

这些文件的作用大致如下：

| 文件 | 可利用信息 | 是否能恢复原始 legacy header |
| --- | --- | --- |
| `packagestore.manifest` | oplog、package store entry、chunk id、filename | 否 |
| `DevelopmentAssetRegistry.bin` | asset data、package data、class、hash、disk size 等 | 否 |
| `CookMetadata.ucookmeta` | 插件层级、shader pseudo assets、关联 DevelopmentAssetRegistry hash | 否 |
| `AllChunksInfo.csv` | package/chunk/class/disk size 一类索引信息 | 否 |
| `scriptobjects.bin` | script import 解析辅助信息 | 否，只能辅助重建 |
| `CookedSettings.txt` / `CookedIniVersion.txt` | cook 配置和版本相关信息 | 否 |
| `ReferencedSet.txt` | 引用集信息 | 否 |

它们可以用于校验、定位、辅助 best-effort reconstruction，但不是原始 header 的备份。

## ResponseFiles 的特殊价值

样例中存在：

```text
C:\WORKSPACE_RA\RATrunk\Trunk\Saved\AssetUpdate\ResponseFiles\PakListIoStore_Additional.txt
```

其中记录了打包输入和容器内路径的映射，例如：

```text
"C:/WORKSPACE_RA/RATrunk/Trunk/Saved/AssetUpdate/Cooked/Windows/Zero/Content/SlashZero/UI/Interface/W_Login_Main.uasset" "../../../Zero/Content/SlashZero/UI/Interface/W_Login_Main.uasset" -compress
"C:/WORKSPACE_RA/RATrunk/Trunk/Saved/AssetUpdate/Cooked/Windows/Zero/Content/SlashZero/UI/Interface/W_Login_Main.uexp" "../../../Zero/Content/SlashZero/UI/Interface/W_Login_Main.uexp" -compress
```

如果这些源 cooked loose 文件仍然存在，那么这是当前样例中最可靠的精确还原方式：直接复制 response file 指向的原始 cooked 文件，而不是从 `.ucas` 反推。

如果源 cooked loose 文件已经被删除，response file 只能提供路径映射，不能提供 bytes。

## 源资产能否补回

Content 下未 cooked 的源 `.uasset` 不能直接补回 cooked legacy header。

理论上可以用完全相同的环境重新 cook：

- 相同 UE 源码和构建。
- 相同项目源码和插件。
- 相同平台、配置、cook 参数。
- 相同 DDC、版本、序列化逻辑和 cook 顺序影响。

但这属于重新生成，不是从 IoStore 容器恢复；结果也未必字节一致。

## 可行方案分级

### 方案 1：已有构建的精确还原

优先查找并复用原始 cooked loose 文件：

- 从 `ResponseFiles/PakListIoStore_*.txt` 找输入 cooked 文件路径。
- 校验文件存在。
- 按容器 mount point 或 response file 目标路径复制到用户选择目录。

对当前样例，这是唯一已经验证可字节一致恢复 `.uasset/.uexp` 的方案。

### 方案 2：未来构建的精确还原

修改 cook/ZenStore 写入链路，在 `CreatePackageFromCookedHeader` 之前保存 legacy header bytes：

- 保存到 Zen oplog 自定义 attachment。
- 或保存到 sidecar metadata 文件。
- 以 package name、chunk id 或 container logical path 建索引。

提取时：

1. 读取 IoStore 中的 `.uexp` export data。
2. 读取额外保存的 legacy header bytes。
3. 输出 legacy `.uasset + .uexp`。

这是最稳的长期方案，但需要改变未来产物生成方式。

### 方案 3：已有容器的 best-effort 重建

可以尝试用 Zen header、package store entry、scriptobjects、asset registry 等信息合成一个功能上可加载的 legacy package header。

限制：

- 不能保证与原始 cooked `.uasset` 字节一致。
- 很多 legacy 序列化细节已经不可逆。
- 成本和兼容风险明显高于复用 UE 原生提取。

该方案适合作为研究方向，不适合作为“还原原始 cooked 文件树”的默认承诺。

### 方案 4：重新 cook

如果有完整源工程和 cook 环境，可以重新 cook 并用输出替代提取结果。

限制：

- 不是从容器中恢复。
- 难以保证字节一致。
- 对历史包、第三方包或缺少源工程的场景不适用。

## 对 UnrealPackageInsight 的建议

短期：

- 当前 UCAS 提取继续保持与 UnrealPak 对齐，输出 `.uheader + .uexp`。
- 在 UI 或文档中说明 IoStore `ExportBundleData` 的 UE 原生提取限制。
- 可增加可选能力：如果用户提供 cooked loose root 或 response file，则执行“还原 cooked 文件树”模式，优先复制原始 cooked `.uasset/.uexp`。

中期：

- 支持扫描 `ResponseFiles/PakListIoStore_*.txt`，把容器 logical path 映射回原始 cooked loose 文件。
- 对存在的原始 cooked 文件做 hash/size 校验，确认它们与容器 export data 对应。

长期：

- 如果项目允许改 cook 流程，新增 legacy header sidecar/Zen attachment。
- UPI 提取时优先使用该 sidecar/attachment 生成 legacy `.uasset`，否则回退到 UE 原生 `.uheader`。

## 最终判断

现有标准 IoStore 容器和标准 ZenStore 产物中，legacy `.uasset` header 的原始字节通常已经丢失。ZenStore 可以作为未来保存 sidecar 的承载机制，也能提供大量辅助索引，但默认不能恢复原始 header。

对当前样例，真正可字节一致还原的来源是 `PakListIoStore_Additional.txt` 指向的 cooked loose 文件树，而不是 `Additional.ucas` 本身。
