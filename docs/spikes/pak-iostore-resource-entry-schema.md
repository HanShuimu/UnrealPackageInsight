# Pak 与 IoStore 资源条目数据结构调研

日期：2026-06-15

## 问题

如果用结构化数据表示 Unreal Engine 容器中的每个资源，例如：

```text
table PakPackageEntry {
  packagePath: string;
  offset: ulong;
  size: ulong;
  compressedSize: ulong;
  compression: string;
  order: uint;
  flags: uint;
}
```

这些字段应该分别填什么？`.pak`、`.utoc`、`.ucas` 是否能使用同一套字段？

本次调研基于本机 Unreal Engine 源码目录：`C:\WORKSPACE_UE\UnrealEngine`。

## 结论摘要

建议不要把 Pak 和 IoStore 强行塞进完全相同的单表结构。它们都能归一成“资源列表”，但底层含义不同：

- `.pak` 的资源是 pak index 中的文件条目，核心结构是 `FPakEntry`。
- `.utoc` 的资源是 IoStore TOC 中的 Chunk 条目，核心结构是 `FIoStoreTocChunkInfo` / `FIoOffsetAndLength` / `FIoStoreTocCompressedBlockEntry`。
- `.ucas` 本身只有实际数据块，没有独立文件名、ChunkId 或资源列表；`.ucas` 资源边界必须从配套 `.utoc` 推导。

如果 UI 或导出格式只需要一组公共列，可以保留这些字段，但需要明确语义：

```text
packagePath    逻辑路径；Pak 来自 pak index，IoStore 优先来自 utoc directory index；ucas 从所属 utoc chunk 复制
offset         用于物理排序的容器内偏移；Pak 是 FPakEntry.Offset，utoc/ucas 应使用物理 OffsetOnDisk/ucas 文件偏移
size           解压后的逻辑大小
compressedSize 压缩后有效字节数，不包含 IoStore AES 对齐填充
compression    压缩方法；IoStore 资源可能跨多个块，可能是 Mixed
order          工具计算出的排序序号，不是 UE 文件内持久化字段
flags          原始格式的 flags；IoStore 建议拆成 metaFlags 和 containerFlags
```

## 源码参考

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Public\IPlatformFilePak.h:358` 定义 `FPakCompressedBlock`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Public\IPlatformFilePak.h:395` 定义 `FPakEntry`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Private\PakFile.cpp:1617` 校验 Pak 压缩块 offset 的绝对/相对模式。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Private\PakFile.cpp:1840` 解码 compact pak entry 时生成压缩块 offset。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\PakFileUtilities\Private\PakFileUtilities.cpp:1736` 读取 Pak 压缩块时按版本把相对 offset 加上 `Entry.Offset`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Public\IO\IoChunkId.h:22` 定义 `EIoChunkType`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Public\IO\IoChunkId.h:132` 定义 `CreateIoChunkId`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Public\IO\IoChunkId.h:162` 定义 `CreateBulkDataIoChunkId`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Public\IO\IoDispatcher.h:479` 定义 `EIoContainerFlags`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Public\IO\IoDispatcher.h:525` 定义 `FIoStoreTocChunkInfo`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoStore.h:43` 定义 `FIoStoreTocHeader`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoStore.h:82` 定义 `FIoStoreTocEntryMetaFlags`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoStore.h:105` 定义 `FIoStoreTocCompressedBlockEntry`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoOffsetLength.h:11` 定义 `FIoOffsetAndLength`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoStore.cpp:269` 构造 `FIoStoreTocChunkInfo`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoStore.cpp:1247` 读取 `.utoc`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoDirectoryIndex.cpp:407` 从 directory index 枚举文件路径与 TOC entry index。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\IoStoreWriter.cpp:1875` 计算 IoStore 压缩块磁盘大小与 AES 对齐。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\IoStoreWriter.cpp:2011` 写入 TOC offset/length 与压缩块 offset。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\IoStoreUtilities.cpp:922` 从 cooked 文件扩展名推断 IoStore chunk 类型。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\IoStoreUtilities.cpp:2866` 把 cooked 文件映射为 `FIoChunkId`。

## 通用建模原则

推荐把“资源条目”和“物理块条目”分开：

- 资源条目用于 UI 列表、搜索、聚合和资源级排序。
- 物理块条目用于分析实际 `.pak` / `.ucas` 内的读取范围、碎片、压缩块分布。

IoStore 尤其需要这样拆分，因为一个 `.utoc` 资源 Chunk 可能由多个 `.ucas` 压缩块组成，而 `.ucas` 文件本身没有资源名。

## `.pak` 资源格式

Pak 中每个资源对应一个 `FPakEntry`，通常也对应一个文件路径。

推荐资源表：

```text
table PakResourceEntry {
  packagePath: string;
  mountPoint: string;
  containerPath: string;

  offset: ulong;
  payloadOffset: ulong;
  size: ulong;
  compressedSize: ulong;
  recordSize: ulong;

  compression: string;
  compressionMethodIndex: uint;
  compressionBlockSize: uint;
  compressionBlockCount: uint;
  relativeBlockOffsets: bool;

  order: uint;
  flags: uint;
  hash: string;
  hasPath: bool;
}
```

字段含义：

| 字段 | 内容 |
| --- | --- |
| `packagePath` | pak index 中的逻辑文件路径。建议保存为 `MountPoint + Filename` 的规范化路径；如果只拿到相对路径，则同时保留 `mountPoint`。 |
| `mountPoint` | pak primary index 中的挂载点。 |
| `containerPath` | 当前 `.pak` 文件路径。 |
| `offset` | `FPakEntry::Offset`。这是该文件记录在 pak 内的起始位置，包含该记录自己的序列化 `FPakEntry` 头。物理排序用这个字段。 |
| `payloadOffset` | 实际文件数据起点，计算为 `FPakEntry.Offset + FPakEntry.GetSerializedSize(PakVersion)`。读取 payload 时用它。 |
| `size` | `FPakEntry::UncompressedSize`，解压后的文件大小。 |
| `compressedSize` | `FPakEntry::Size`，序列化文件数据大小。未压缩时通常等于 `size`。 |
| `recordSize` | `payloadOffset - offset + compressedSize`。表示该 pak 文件记录占用的总范围，便于做空洞/重叠检查。 |
| `compression` | `FPakInfo::CompressionMethods[CompressionMethodIndex]`；`CompressionMethodIndex == 0` 时为 `None`。 |
| `compressionMethodIndex` | `FPakEntry::CompressionMethodIndex`。 |
| `compressionBlockSize` | `FPakEntry::CompressionBlockSize`。 |
| `compressionBlockCount` | `FPakEntry::CompressionBlocks.Num()`。 |
| `relativeBlockOffsets` | `FPakInfo::HasRelativeCompressedChunkOffsets()`。用于解释 `FPakCompressedBlock` 的 `CompressedStart/CompressedEnd`。 |
| `order` | 工具按 `offset` 升序排序后生成的序号，UE 不持久化该字段。 |
| `flags` | `FPakEntry::Flags`。`0x01` 为 encrypted，`0x02` 为 deleted。 |
| `hash` | `FPakEntry::Hash` 的 SHA1 十六进制字符串。 |
| `hasPath` | 是否成功从 index 解析出路径。 |

Pak 压缩块表：

```text
table PakCompressedBlockEntry {
  pakEntryIndex: uint;
  blockIndex: uint;
  compressedStart: ulong;
  compressedEnd: ulong;
  compressedSize: ulong;
  diskSize: ulong;
  relativeBlockOffsets: bool;
  physicalStart: ulong;
  physicalEnd: ulong;
}
```

字段含义：

| 字段 | 内容 |
| --- | --- |
| `compressedStart` | `FPakCompressedBlock::CompressedStart` 原始值。现代 compact entry 中可能是相对 entry 起点的偏移，旧格式中可能已经是 pak 内绝对偏移。 |
| `compressedEnd` | `FPakCompressedBlock::CompressedEnd`。 |
| `compressedSize` | `compressedEnd - compressedStart`。 |
| `diskSize` | 实际读取大小。未加密时为 `compressedSize`；加密时为 `Align(compressedSize, FAES::AESBlockSize)`。 |
| `relativeBlockOffsets` | 同资源表的 `relativeBlockOffsets`。 |
| `physicalStart` | 实际 pak 文件内偏移，计算为 `compressedStart + (relativeBlockOffsets ? FPakEntry.Offset : 0)`。 |
| `physicalEnd` | `physicalStart + diskSize`。 |

如果只采用用户示例的简化表，`.pak` 字段应这样填：

```text
table PakPackageEntry {
  packagePath: string;   // pak index 逻辑路径
  offset: ulong;         // FPakEntry.Offset，文件记录头起点
  size: ulong;           // FPakEntry.UncompressedSize
  compressedSize: ulong; // FPakEntry.Size
  compression: string;   // CompressionMethods[CompressionMethodIndex] 或 None
  order: uint;           // 按 offset 排序后生成
  flags: uint;           // FPakEntry.Flags
}
```

注意：如果后续要真正读取文件数据，简化表缺少 `payloadOffset` 和压缩块信息。

## `.utoc` 资源格式

`.utoc` 是 IoStore 的目录和块索引文件，资源单位是 `FIoChunkId` 对应的 Chunk，而不是传统文件记录。

推荐容器摘要表：

```text
table UtocContainerSummary {
  containerPath: string;
  containerId: ulong;
  version: uint;
  tocEntryCount: uint;
  compressionBlockCount: uint;
  compressionBlockSize: uint;
  partitionCount: uint;
  partitionSize: ulong;
  containerFlags: uint;
  encryptionKeyGuid: string;
  directoryIndexSize: uint;
}
```

推荐资源表：

```text
table UtocResourceEntry {
  packagePath: string;
  containerPath: string;
  tocEntryIndex: uint;

  chunkId: string;
  chunkType: string;
  packageId: ulong;
  chunkIndex: uint;
  bulkDataCookedIndex: uint;

  logicalOffset: ulong;
  offset: ulong;
  size: ulong;
  compressedSize: ulong;
  diskSize: ulong;

  compression: string;
  firstBlockIndex: uint;
  blockCount: uint;
  partitionIndex: uint;

  order: uint;
  metaFlags: uint;
  containerFlags: uint;
  flags: uint;
  hash: string;
  hasPath: bool;
}
```

字段含义：

| 字段 | 内容 |
| --- | --- |
| `packagePath` | `FIoDirectoryIndexReader` 枚举出的文件路径。若 `.utoc` 未设置 `Indexed` 或 directory index 为空，则为空或使用 `<chunkType>/<chunkId>` 作为展示名。 |
| `containerPath` | 当前 `.utoc` 文件路径。 |
| `tocEntryIndex` | TOC entry 下标。用于回查 `ChunkIds`、`ChunkOffsetLengths`、`ChunkMetas`。 |
| `chunkId` | 12 字节 `FIoChunkId` 的十六进制字符串。 |
| `chunkType` | `FIoChunkId::GetChunkType()`，来自 `EIoChunkType`。常见值包括 `ExportBundleData`、`BulkData`、`OptionalBulkData`、`MemoryMappedBulkData`、`ContainerHeader`、`ShaderCodeLibrary` 等。 |
| `packageId` | 对 package 相关 chunk，取 `FIoChunkId` 前 8 字节。它通常来自 `FPackageId`。非 package chunk 可为 0 或空值。 |
| `chunkIndex` | `FIoChunkId` 的 chunk index。普通 package 数据通常为 0，可选段 package 数据通常为 1。 |
| `bulkDataCookedIndex` | bulkdata 类型使用的 cooked index，位于 `FIoChunkId` 第 10 字节；非 bulkdata 可为 0。 |
| `logicalOffset` | `FIoOffsetAndLength::GetOffset()`，也就是 `FIoStoreTocChunkInfo::Offset`。这是 IoStore 逻辑未压缩地址空间中的偏移，不是 `.ucas` 物理偏移。 |
| `offset` | 资源第一个压缩块的物理全局偏移，即 `FIoStoreTocChunkInfo::OffsetOnDisk`。物理排序用这个字段。 |
| `size` | `FIoOffsetAndLength::GetLength()`，也就是 `FIoStoreTocChunkInfo::Size`，解压后的 Chunk 大小。 |
| `compressedSize` | 该 Chunk 覆盖的压缩块 `GetCompressedSize()` 之和，也就是 `FIoStoreTocChunkInfo::CompressedSize`。不包含 AES block 对齐填充。 |
| `diskSize` | 该 Chunk 在 `.ucas` 中实际占用的块大小之和。按块把 `compressedSize` 对齐到 `FAES::AESBlockSize` 后求和；加密或签名容器尤其需要这个字段。 |
| `compression` | 若所有块压缩方法一致，填该方法；若多个块方法不同，填 `Mixed`；未压缩为 `None`。 |
| `firstBlockIndex` | `logicalOffset / compressionBlockSize`。UE 源码用这个值定位首个 `FIoStoreTocCompressedBlockEntry`。 |
| `blockCount` | `LastBlockIndex - FirstBlockIndex + 1`。 |
| `partitionIndex` | `offset / partitionSize`。 |
| `order` | 工具按 `(partitionIndex, offset)` 升序排序后生成的序号，UE 不持久化该字段。 |
| `metaFlags` | `FIoStoreTocEntryMetaFlags`。`0x01` 为 compressed，`0x02` 为 memory mapped。 |
| `containerFlags` | `EIoContainerFlags`。`0x01` compressed，`0x02` encrypted，`0x04` signed，`0x08` indexed，`0x10` on demand。 |
| `flags` | 兼容单字段导出时可设为 `metaFlags | (containerFlags << 16)`；内部模型建议保留 `metaFlags` 和 `containerFlags` 两列。 |
| `hash` | `FIoStoreTocEntryMeta::ChunkHash` 的十六进制字符串。 |
| `hasPath` | 是否从 directory index 找到有效文件名。 |

`.utoc` 压缩块表：

```text
table UtocCompressionBlockEntry {
  blockIndex: uint;
  partitionIndex: uint;
  offset: ulong;
  ucasOffset: ulong;
  compressedSize: uint;
  diskSize: uint;
  uncompressedSize: uint;
  compression: string;
  ownerTocEntryIndex: uint;
}
```

字段含义：

| 字段 | 内容 |
| --- | --- |
| `blockIndex` | `FIoStoreTocCompressedBlockEntry` 在 `.utoc` compression block 数组中的下标。 |
| `partitionIndex` | `GetOffset() / partitionSize`。 |
| `offset` | `FIoStoreTocCompressedBlockEntry::GetOffset()`，IoStore 全局物理偏移。 |
| `ucasOffset` | 实际 `.ucas` 分区文件内偏移，通常为 `offset - partitionIndex * partitionSize`。 |
| `compressedSize` | `GetCompressedSize()`，不含 AES 对齐填充。 |
| `diskSize` | `Align(compressedSize, FAES::AESBlockSize)`。 |
| `uncompressedSize` | `GetUncompressedSize()`。 |
| `compression` | `CompressionMethods[GetCompressionMethodIndex()]`。 |
| `ownerTocEntryIndex` | 覆盖该逻辑块的 TOC entry。可通过每个资源的 `firstBlockIndex/blockCount` 反向填充。 |

如果只采用用户示例的简化表，`.utoc` 字段应这样填：

```text
table UtocPackageEntry {
  packagePath: string;   // directory index 文件路径；没有索引时为空或展示名
  offset: ulong;         // OffsetOnDisk，首个压缩块物理全局偏移
  size: ulong;           // ChunkInfo.Size，解压后的 Chunk 大小
  compressedSize: ulong; // ChunkInfo.CompressedSize，不含 AES 对齐
  compression: string;   // None / 方法名 / Mixed
  order: uint;           // 按 (partitionIndex, offset) 排序后生成
  flags: uint;           // 建议 metaFlags | (containerFlags << 16)
}
```

注意：`FIoStoreTocChunkInfo::Offset` 不应填入简化表的 `offset`，因为它是逻辑未压缩偏移；做物理排序应使用 `OffsetOnDisk`。

## `.ucas` 资源格式

`.ucas` 只保存 IoStore 数据块。它没有独立 header 来列出资源，也没有 `packagePath`、`chunkId`、`size` 这类资源级元数据。任何 `.ucas` 资源列表都必须由配套 `.utoc` 派生。

推荐把 `.ucas` 暴露为两层：

- `UcasResourceSpan`：从 `.utoc` 的一个 Chunk 派生出的 `.ucas` 物理范围，适合资源列表视图。
- `UcasBlockEntry`：实际写入 `.ucas` 的压缩块，适合物理块/碎片分析。

推荐资源范围表：

```text
table UcasResourceSpan {
  packagePath: string;
  ucasPath: string;
  utocPath: string;
  tocEntryIndex: uint;

  chunkId: string;
  chunkType: string;
  partitionIndex: uint;

  offset: ulong;
  globalOffset: ulong;
  size: ulong;
  compressedSize: ulong;
  diskSize: ulong;

  compression: string;
  firstBlockIndex: uint;
  blockCount: uint;
  order: uint;
  flags: uint;
}
```

字段含义：

| 字段 | 内容 |
| --- | --- |
| `packagePath` | 从所属 `UtocResourceEntry.packagePath` 复制。`.ucas` 自己无法解析该字段。 |
| `ucasPath` | 实际数据文件路径。分区容器可能是主 `.ucas` 或带分区后缀的 `.ucas`。 |
| `utocPath` | 配套 `.utoc` 文件路径。 |
| `tocEntryIndex` | 所属 TOC entry。 |
| `chunkId` | 从 `.utoc` 复制。 |
| `chunkType` | 从 `.utoc` 复制。 |
| `partitionIndex` | 所在 `.ucas` 分区。 |
| `offset` | 当前分区 `.ucas` 文件内偏移，即 `globalOffset - partitionIndex * partitionSize`。物理排序文件内视图用这个字段。 |
| `globalOffset` | `FIoStoreTocChunkInfo::OffsetOnDisk`，IoStore 全局物理偏移。跨分区排序用这个字段。 |
| `size` | 所属 Chunk 解压后的大小。 |
| `compressedSize` | 所属 Chunk 有效压缩字节数，不含 AES 对齐。 |
| `diskSize` | 所属 Chunk 实际占用磁盘字节数，包含每个块的 AES 对齐填充。 |
| `compression` | 所属 Chunk 的资源级压缩方法，可能为 `Mixed`。 |
| `firstBlockIndex` | 所属 Chunk 首个压缩块下标。 |
| `blockCount` | 所属 Chunk 覆盖的压缩块数量。 |
| `order` | 工具按 `(ucasPath, offset)` 或 `(partitionIndex, globalOffset)` 排序后生成。 |
| `flags` | 从 `.utoc` 推导。建议使用 `metaFlags | (containerFlags << 16)`，或在内部模型中拆列。 |

推荐物理块表：

```text
table UcasBlockEntry {
  packagePath: string;
  ucasPath: string;
  utocPath: string;

  blockIndex: uint;
  ownerTocEntryIndex: uint;
  partitionIndex: uint;

  offset: ulong;
  globalOffset: ulong;
  compressedSize: uint;
  diskSize: uint;
  uncompressedSize: uint;

  compression: string;
  order: uint;
  flags: uint;
}
```

字段含义：

| 字段 | 内容 |
| --- | --- |
| `packagePath` | 从 owner TOC entry 复制；若一个块无法唯一归属则为空。按 UE 写入逻辑，通常可以由 `firstBlockIndex/blockCount` 唯一归属。 |
| `ucasPath` | 当前分区 `.ucas` 路径。 |
| `utocPath` | 配套 `.utoc` 路径。 |
| `blockIndex` | `.utoc` compression block 下标。 |
| `ownerTocEntryIndex` | 拥有该块的 TOC entry。 |
| `partitionIndex` | `globalOffset / partitionSize`。 |
| `offset` | 当前 `.ucas` 文件内偏移。 |
| `globalOffset` | `FIoStoreTocCompressedBlockEntry::GetOffset()`。 |
| `compressedSize` | `GetCompressedSize()`。 |
| `diskSize` | `Align(compressedSize, FAES::AESBlockSize)`。 |
| `uncompressedSize` | `GetUncompressedSize()`。 |
| `compression` | `CompressionMethods[GetCompressionMethodIndex()]`。 |
| `order` | 工具按 `(ucasPath, offset)` 排序后生成。 |
| `flags` | 从 container flags 继承 encrypted/signed；如果 `compression != None`，可设置本工具自定义 compressed bit。 |

如果只采用用户示例的简化表，`.ucas` 字段应这样填：

```text
table UcasPackageEntry {
  packagePath: string;   // 从配套 utoc 的 directory index/资源条目复制
  offset: ulong;         // 当前 .ucas 分区文件内偏移
  size: ulong;           // 所属 Chunk 解压后大小
  compressedSize: ulong; // 所属 Chunk 有效压缩字节数，不含 AES 对齐
  compression: string;   // None / 方法名 / Mixed
  order: uint;           // 按 (ucasPath, offset) 排序后生成
  flags: uint;           // 从 utoc meta/container flags 推导
}
```

注意：这个表不能从 `.ucas` 单独读取出来，必须先解析 `.utoc`。

## ChunkId 解析建议

`FIoChunkId` 是 12 字节：

```text
bytes 0..7   chunk id，package chunk 通常是 FPackageId
bytes 8..9   chunk index，网络字节序
byte 10      bulkdata cooked index；非 bulkdata 通常为 0
byte 11      EIoChunkType
```

常见 `EIoChunkType`：

| 值 | 名称 | 典型含义 |
| --- | --- | --- |
| `1` | `ExportBundleData` | `.uasset/.umap` header 与 `.uexp` 合并后的 package export bundle 数据。 |
| `2` | `BulkData` | `.ubulk`。 |
| `3` | `OptionalBulkData` | `.uptnl`。 |
| `4` | `MemoryMappedBulkData` | `.m.ubulk`。 |
| `6` | `ContainerHeader` | 容器头 chunk。 |
| `8` | `ShaderCodeLibrary` | `.ushaderbytecode` 等 shader library。 |
| `10` | `PackageStoreEntry` | package store entry。 |

IoStore 构建流程中，`IoStoreUtilities.cpp` 会根据 cooked 文件扩展名决定 chunk 类型：

- `.uasset` / `.umap` 与 `.uexp` 归入 `ExportBundleData`。
- `.ubulk` 归入 `BulkData`。
- `.uptnl` 归入 `OptionalBulkData`。
- `.m.ubulk` 归入 `MemoryMappedBulkData`。
- `.o.uasset` / `.o.umap` / `.o.uexp` 使用 chunk index 1 表示 optional segment。
- `.o.ubulk` 使用 chunk index 1 的 bulkdata chunk。

## 排序规则

推荐支持三种排序：

| 排序 | Pak | IoStore |
| --- | --- | --- |
| `Path` | `packagePath` | `packagePath`，无路径时退化为 `chunkType/chunkId` |
| `TocOrIndex` | pak index 枚举顺序 | `tocEntryIndex` |
| `Physical` | `offset` | `(partitionIndex, offset)` 或 `(ucasPath, ucasOffset)` |

默认布局分析应使用 `Physical`。

Pak 的 `Physical` 排序键：

```text
(containerPath, offset, packagePath)
```

`.utoc` 资源视图的 `Physical` 排序键：

```text
(containerPath, partitionIndex, offset, tocEntryIndex)
```

`.ucas` 文件内视图的 `Physical` 排序键：

```text
(ucasPath, offset, blockIndex)
```

跨分区全局视图的 `Physical` 排序键：

```text
(utocPath, partitionIndex, globalOffset, blockIndex)
```

## 实现注意事项

1. `order` 始终是工具生成字段，不要尝试从 UE 文件中读取。
2. Pak 的 `offset` 和 IoStore 的 `offset` 语义不同：Pak 是文件记录头起点；IoStore 资源表建议用首个压缩块的物理偏移。
3. IoStore 的 `logicalOffset` 必须保留，否则无法正确定位 chunk 覆盖的 compression block 范围。
4. IoStore 的 `compressedSize` 不等于实际磁盘占用；实际占用应使用 `diskSize`，因为写入 `.ucas` 时每个压缩块会对齐到 AES block size。
5. IoStore 的 `packagePath` 是可选信息。没有 directory index 或未设置 `Indexed` flag 时，只能可靠得到 `chunkId`、`chunkType`、大小和物理位置。
6. 一个 package 在 IoStore 中可能拆成多个资源条目，例如 `ExportBundleData`、`BulkData`、`OptionalBulkData`、`MemoryMappedBulkData`。UI 若需要“按包聚合”，应基于 `packageId/packagePath` 做二次聚合。
7. 对加密容器，元数据是否可读、payload 是否可读取决于容器类型和 key；资源列表分析应允许只输出可从 index/TOC 得到的元数据。
