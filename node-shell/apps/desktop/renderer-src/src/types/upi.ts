export type IpcSeverity = string | number;
export type IpcStatus = string | number;

export type Issue = {
  severity?: IpcSeverity;
  code?: string;
  message?: string;
};

export type BackendInfo = {
  status?: IpcStatus;
  backendName?: string;
  backendVersion?: string;
  unrealVersion?: string;
  protocolVersion?: string | number;
  backendCount?: number;
  backends?: Array<{ id: string; label: string }>;
  issues?: Issue[];
};

export type PackageTreeNode = {
  name?: string;
  path?: string;
  kind?: 'directory' | 'pak' | 'utoc' | 'ucas' | string;
  relativePath?: string;
  children?: PackageTreeNode[];
};

export type PackageFile = {
  path: string;
  name?: string;
  extension?: string;
  kind?: string;
  relativePath?: string;
};

export type PackageScan = {
  root: string;
  files: PackageFile[];
  tree: PackageTreeNode;
};

export type BackendSelectionCandidate = {
  id: string;
  label: string;
};

export type BackendSelectionRequest = {
  filePath?: string;
  analysisFilePath?: string;
  containerLabel?: string;
  probe?: Record<string, unknown>;
  candidates?: BackendSelectionCandidate[];
  selectedId?: string;
};

export type AnalysisResult = {
  status?: IpcStatus;
  issues?: Issue[];
  overview?: Record<string, unknown>;
  packages?: unknown[];
  chunks?: unknown[];
  compressedBlocks?: unknown[];
  partitions?: unknown[];
  backendSelection?: BackendSelectionRequest;
  [key: string]: unknown;
};

export type UpiClient = {
  getBackendInfo(): Promise<BackendInfo>;
  openPackageDirectory(): Promise<PackageScan | null>;
  analyze(filePath: string): Promise<AnalysisResult>;
  submitAesKeyAndRetry(filePath: string, aesKey: string): Promise<AnalysisResult>;
  clearAesKey(): Promise<boolean>;
  chooseBackend(request: BackendSelectionRequest): Promise<string>;
};
