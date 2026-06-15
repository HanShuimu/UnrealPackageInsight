# Pak 与 IoStore 容器结构及物理排序方案调研

日期：2026-06-15

## 问题

UnrealPackageInsight 需要分析 Unreal Engine 的容器文件，拿到容器内的文件/Chunk 列表，并支持按照物理存储顺序排序。

本次调研覆盖：

- Pak：`.pak`
- IoStore：`.utoc` 元数据文件与 `.ucas` 数据分区文件

源码依据来自本机 Unreal Engine 源码目录：`C:\WORKSPACE_UE\UnrealEngine`。

## 结论摘要

第一版生产实现建议优先复用 Unreal Engine 自带读取器，而不是手写二进制解析器。

Pak 的核心枚举对象是 `FPakEntry`。物理排序应使用 `FPakEntry::Offset`，它指向 pak 内单个文件记录的起点，包含该文件记录自己的序列化 `FPakEntry` 头。实际 payload 起点是：

```text
PayloadOffset = FPakEntry.Offset + FPakEntry.GetSerializedSize(PakVersion)
```

IoStore 的核心枚举对象是 `FIoStoreTocChunkInfo`。物理排序不能使用 TOC 下标，也不能使用 `FIoStoreTocChunkInfo::Offset`。真正的磁盘位置是 `FIoStoreTocChunkInfo::OffsetOnDisk`，它来自该 Chunk 第一个 `FIoStoreTocCompressedBlockEntry` 的 `GetOffset()`。

两类容器都有“用于查找”的索引顺序，但这些顺序不等价于物理布局：

- Pak 的目录索引和路径哈希索引用来把文件名或路径哈希映射到 `FPakEntryLocation`。
- IoStore 的 TOC 数组会为了 perfect hash 重新排列。

因此，工具层应该输出统一的 normalized record，并提供多个排序模式；默认布局视图使用 `Physical` 排序。

## 源码参考

Pak：

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Public\IPlatformFilePak.h:137` 定义 `FPakInfo`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Public\IPlatformFilePak.h:395` 定义 `FPakEntry`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Public\IPlatformFilePak.h:599` 定义 `FPakEntryLocation`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Private\PakFile.cpp:347` 加载 pak index。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\PakFile\Private\PakFile.cpp:1734` 解码 compact `FPakEntry`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\PakFileUtilities\Private\PakFileUtilities.cpp:3149` 写入 UE5 primary/secondary pak index。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\PakFileUtilities\Private\PakFileUtilities.cpp:2772` 写入单个 pak 记录，并把最终 offset 写回 index。

IoStore：

- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoStore.h:43` 定义 `FIoStoreTocHeader`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoOffsetLength.h:11` 定义 `FIoOffsetAndLength`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Internal\IO\IoStore.h:105` 定义 `FIoStoreTocCompressedBlockEntry`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoStore.cpp:1247` 读取 `.utoc` 布局。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoStore.cpp:269` 构造 `FIoStoreTocChunkInfo`。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Runtime\Core\Private\IO\IoDirectoryIndex.cpp:407` 将目录索引文件名映射到 TOC entry index。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\IoStoreWriter.cpp:1297` 生成 perfect hash 后写入 TOC 与目录索引。
- `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Developer\IoStoreUtilities\Private\IoStoreUtilities.cpp:6808` 按压缩块物理 offset 列出 IoStore 条目。

## Pak 文件结构

现代 pak 的整体布局可以理解为：

```text
[file record 0][file record 1]...[primary index][secondary indexes][FPakInfo trailer]
```

尾部 `FPakInfo` 保存：

- magic number
- pak version
- primary index offset
- primary index size
- index hash
- index 是否加密
- encryption key guid
- compression method table

读取时，`FPakFile` 会从文件末尾向前尝试不同版本的 `FPakInfo` 序列化尺寸，直到找到 `PakFile_Magic`。

每个文件的核心元数据是 `FPakEntry`：

- `Offset`：pak 内该文件记录的物理起点。
- `Size`：序列化 payload 大小；压缩文件这里是压缩后大小。
- `UncompressedSize`：原始大小。
- `Hash`：payload header 中的 SHA1。
- `CompressionBlocks`：压缩块范围。
- `CompressionBlockSize`：压缩块粒度。
- `CompressionMethodIndex`：指向 `FPakInfo::CompressionMethods`。
- `Flags`：包含 encrypted 与 deleted record 标志。

物理记录起点和 payload 起点要区分：

```text
RecordStart = FPakEntry.Offset
PayloadStart = FPakEntry.Offset + FPakEntry.GetSerializedSize(FPakInfo.Version)
PayloadSize = FPakEntry.Size
```

计算 gap 时，优先按 `Offset` 排序后使用下一条记录的 `Offset`。压缩、加密对齐和写入 padding 会让“自己推导出的 end offset”不如相邻真实 offset 可靠。

## Pak 索引结构

UE5 pak 会写一个 primary index 和最多两个 secondary index。

Primary index 包含：

- mount point
- entry 数量
- path hash seed
- secondary index 的存在标志、offset、size、hash
- compact encoded pak entries
- non-encodable pak entries

Secondary index 包含：

- PathHashIndex：路径哈希到 `FPakEntryLocation`。运行时内存占用低，但无法恢复文件名。
- FullDirectoryIndex：目录路径到文件名再到 `FPakEntryLocation`。这是完整文件名列表的主要来源。

`FPakEntryLocation` 不是文件 offset，而是“如何找到 `FPakEntry`”的位置标识：

- 非负值：指向 compact encoded entry byte array 的 byte offset。
- 负值：指向 non-encodable `Files` 数组下标。

重要限制：如果 pak 构建时没有写 FullDirectoryIndex，工具可以枚举 entry，但不能从 PathHashIndex 的哈希值反推出完整文件名。UI/CLI 应明确返回“partial listing”，不要伪造文件名。

## Pak 物理排序方案

建议输出字段：

```text
ContainerType: Pak
ContainerPath: .pak 路径
Name: mount-relative path，若不可用则为空
MountPoint: FPakFile::GetMountPoint()
PhysicalOffset: FPakEntry.Offset
PayloadOffset: FPakEntry.Offset + FPakEntry.GetSerializedSize(Version)
StoredSize: FPakEntry.Size
UncompressedSize: FPakEntry.UncompressedSize
CompressionMethod: FPakInfo.CompressionMethods[CompressionMethodIndex]
CompressionBlockCount: FPakEntry.CompressionBlocks.Num()
Encrypted: FPakEntry.IsEncrypted()
Deleted: FPakEntry.IsDeleteRecord()
Hash: FPakEntry.Hash
```

排序键：

```text
Physical sort = (ContainerOrder, 0, PhysicalOffset, Name)
```

`ContainerOrder` 是多 pak 加载时用户指定或扫描得到的容器顺序。Pak 没有 IoStore 分区概念，分区字段固定为 `0`。

示意代码：

```cpp
TRefCountPtr<FPakFile> PakFile = MakeRefCount<FPakFile>(
    &FPlatformFileManager::Get().GetPlatformFile(),
    *PakFilename,
    /*bIsSigned=*/false,
    /*bLoadIndex=*/true);

for (FPakFile::FPakEntryIterator It(*PakFile, /*bIncludeDeleted=*/true); It; ++It)
{
    const FPakEntry& Entry = It.Info();
    const FString* Filename = It.TryGetFilename();

    Record.Name = Filename ? *Filename : TEXT("");
    Record.PhysicalOffset = Entry.Offset;
    Record.PayloadOffset = Entry.Offset + Entry.GetSerializedSize(PakFile->GetInfo().Version);
    Record.StoredSize = Entry.Size;
    Record.UncompressedSize = Entry.UncompressedSize;
}

Records.Sort([](const FRecord& A, const FRecord& B)
{
    return A.PhysicalOffset < B.PhysicalOffset;
});
```

## IoStore 文件结构

IoStore 把元数据和数据拆开：

- `.utoc`：table of contents。
- `.ucas`：数据块文件。
- `*_sN.ucas`：容器超过 partition size 后产生的后续分区。

`FIoStoreTocHeader` 保存：

- TOC version
- entry 数量
- compressed block entry 数量和结构尺寸
- compression method name 信息
- compression block size
- directory index size
- partition count
- partition size
- container id
- encryption key guid
- container flags

`.utoc` 读取顺序是：

1. header
2. `ChunkIds`
3. `ChunkOffsetLengths`
4. perfect-hash seed table 与 overflow entries
5. compression block entries
6. compression method names
7. signed container 的 signature data
8. indexed container 的 directory index buffer
9. chunk metadata

`FIoOffsetAndLength` 用 5 字节保存 offset、5 字节保存 length。写入器里这个 offset 来自 `UncompressedFileOffset`，它是逻辑未压缩容器地址，不是磁盘地址。

真正的磁盘地址在 `FIoStoreTocCompressedBlockEntry`：

- `GetOffset()`：跨所有 `.ucas` 分区的全局物理 offset。
- `GetCompressedSize()`：压缩大小，不包含 AES padding。
- `GetUncompressedSize()`：该压缩块解压后的大小。
- `GetCompressionMethodIndex()`：压缩方法下标。

UE 写入时总会把压缩块对齐到 AES block size。精确计算磁盘跨度时，要使用 aligned compressed block size，而不能只用 `CompressedSize`。

## IoStore 目录索引

如果容器带有 `EIoContainerFlags::Indexed` 且 `DirectoryIndexSize > 0`，`FIoDirectoryIndexReader` 可以把逻辑文件名映射到 TOC entry index。

目录索引资源包含：

- mount point
- directory entries
- file entries
- string table

每个 `FIoFileIndexEntry::UserData` 保存 `TocEntryIndex`。`FIoDirectoryIndexReader::IterateDirectoryIndex` 会产生 `(Filename, TocEntryIndex)`，`FIoStoreTocReader` 再把文件名填回 `FIoStoreTocChunkInfo.FileName`，并设置 `bHasValidFileName`。

重要限制：非 indexed IoStore 仍然能按 `FIoChunkId` 枚举 chunk，但无法仅靠 TOC 得到完整逻辑文件名。

## IoStore 物理排序方案

建议输出字段：

```text
ContainerType: IoStore
ContainerPath: .utoc/.ucas 容器基路径
Name: FIoStoreTocChunkInfo.FileName，若无有效文件名则使用 <ChunkType>
ChunkId: FIoStoreTocChunkInfo.Id
ChunkType: FIoStoreTocChunkInfo.ChunkType
TocEntryIndex: TOC entry index
LogicalOffset: FIoStoreTocChunkInfo.Offset
UncompressedSize: FIoStoreTocChunkInfo.Size
PhysicalOffsetGlobal: FIoStoreTocChunkInfo.OffsetOnDisk
PartitionIndex: FIoStoreTocChunkInfo.PartitionIndex
StoredSize: sum(aligned compressed block disk sizes)
CompressedSize: FIoStoreTocChunkInfo.CompressedSize
CompressionBlockCount: FIoStoreTocChunkInfo.NumCompressedBlocks
Compressed: FIoStoreTocChunkInfo.bIsCompressed
MemoryMapped: FIoStoreTocChunkInfo.bIsMemoryMapped
Hash: FIoStoreTocChunkInfo.ChunkHash
```

排序键：

```text
Physical sort = (ContainerOrder, PartitionIndex, PhysicalOffsetGlobal, TocEntryIndex, Name)
```

展示时建议同时展示：

- global physical offset：`OffsetOnDisk`
- partition-relative offset：`OffsetOnDisk % PartitionSize`，如果实现层能拿到 `PartitionSize`

如果只使用 public `FIoStoreReader` API，`PartitionIndex` 和 `OffsetOnDisk` 已足够做稳定物理排序。若 UI 需要展示分区内 offset，可以在 UE backend 内用 internal `FIoStoreTocResourceView` 暴露 `PartitionSize`。

示意代码：

```cpp
FIoStoreReader Reader;
Reader.Initialize(ContainerPathWithoutExtension, DecryptionKeys);

uint32 TocEntryIndex = 0;
Reader.EnumerateChunks([&](FIoStoreTocChunkInfo&& ChunkInfo)
{
    Record.Name = ChunkInfo.bHasValidFileName
        ? ChunkInfo.FileName
        : FString::Printf(TEXT("<%s>"), *LexToString(ChunkInfo.ChunkType));
    Record.ChunkId = ChunkInfo.Id;
    Record.TocEntryIndex = TocEntryIndex++;
    Record.LogicalOffset = ChunkInfo.Offset;
    Record.PhysicalOffsetGlobal = ChunkInfo.OffsetOnDisk;
    Record.PartitionIndex = ChunkInfo.PartitionIndex;
    Record.UncompressedSize = ChunkInfo.Size;
    Record.CompressedSize = ChunkInfo.CompressedSize;
    Record.CompressionBlockCount = ChunkInfo.NumCompressedBlocks;
    return true;
});

Records.Sort([](const FRecord& A, const FRecord& B)
{
    if (A.PartitionIndex != B.PartitionIndex)
    {
        return A.PartitionIndex < B.PartitionIndex;
    }
    return A.PhysicalOffsetGlobal < B.PhysicalOffsetGlobal;
});
```

精确磁盘大小建议按 backing blocks 计算：

```cpp
uint64 DiskSize = 0;
Reader.EnumerateCompressedBlocksForChunk(ChunkInfo.Id,
    [&DiskSize](const FIoStoreTocCompressedBlockInfo& Block)
    {
        DiskSize += Align(uint64(Block.CompressedSize), uint64(FAES::AESBlockSize));
        return true;
    });
```

## 统一排序模型

建议支持这些排序模式：

- `Physical`：容器内真实物理存储顺序。
- `LogicalPath`：mount point + filename。
- `Size`：按 uncompressed size 或 stored size。
- `ContainerIndex`：原始 index/TOC 枚举顺序，仅用于调试。
- `PackageGroup`：后续可选，把 `.uasset`、`.uexp`、`.ubulk`、optional bulk 和相关 package chunks 聚合查看。

统一 normalized record：

```text
Id
ContainerType
ContainerPath
ContainerOrder
PartitionIndex
PhysicalOffset
PhysicalOffsetInPartition
PhysicalEnd
LogicalOffset
Name
MountPoint
ChunkId
ChunkType
StoredSize
CompressedSize
UncompressedSize
CompressionMethod
CompressionBlockCount
Encrypted
Signed
Deleted
Hash
HasValidName
Warnings
```

`PhysicalEnd` 是 best-effort 字段：

- Pak：文件数据 end 可用 `PayloadOffset + StoredSize`；gap 分析优先使用下一条 entry 的 `PhysicalOffset`。
- IoStore：用最后一个 backing compression block 的 offset 加 aligned compressed size。

## 推荐后端实现路径

1. 第一版 parser 放在 UE-backed C++ DLL 中，不放在 Node 里手写二进制解析。
2. C ABI 可以接收 JSON request，返回 JSON，或把结果写入 JSON 文件，避免 FFI 大 buffer 问题。
3. Pak 依赖 `PakFile` 模块，使用 `FPakFile`。
4. IoStore 使用 Core public IO API 中的 `FIoStoreReader` 枚举 chunk。只有需要 raw TOC header 字段时，再在 backend 内部封装 `IoStore.h`。
5. request 支持 `crypto.json` 或显式 key map。缺 key 要和容器损坏分开报错。
6. 名称不可用时返回 partial result：
   - Pak 无 FullDirectoryIndex：可返回 entry 和 offset，但没有完整文件名。
   - IoStore 无 DirectoryIndex：可返回 chunk id/type 和 offset，但没有完整文件名。
7. 后端负责默认排序，同时返回原始 offset 字段，方便 UI 不重新解析也能切换排序。

## 验证建议

用小型测试产物与 UE 工具输出对比：

- Pak：
  - `UnrealPak.exe <file.pak> -List`
  - `UnrealPak.exe <file.pak> -AuditFiles -SortByOrdering`
- IoStore：
  - 使用走 `FIoStoreReader::EnumerateChunks` 的 IoStoreUtilities list 路径。
  - 对比 `IoStoreUtilities.cpp` 中按 compressed block offset 排序的输出。

测试样例建议覆盖：

- 未压缩 pak
- 多 compression blocks 的压缩 pak
- encrypted index pak
- deleted records pak
- indexed IoStore
- non-indexed IoStore
- encrypted IoStore
- multi-partition IoStore
- memory-mapped chunks IoStore

## 风险与边界

- 一些 shipped pak 可能省略或裁剪 FullDirectoryIndex，导致无法得到完整文件名列表。
- IoStore 文件名依赖 directory index；没有 directory index 时只能列 chunk。
- Pak 和 IoStore 加密都依赖正确 AES key。缺 key 与 corrupt container 应分开呈现。
- IoStore `CompressedSize` 不包含 AES padding，磁盘跨度必须使用 aligned block size。
- perfect hash 会重排 IoStore TOC 数组，TOC 下标不能当物理顺序。
