export type WorkspaceFileHandle = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
};

export type WorkspaceDirectoryHandle = {
  kind: 'directory';
  name: string;
  entries: () => AsyncIterableIterator<[string, WorkspaceHandle]>;
  queryPermission: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
};

export type WorkspaceHandle = WorkspaceFileHandle | WorkspaceDirectoryHandle;

export type WorkspaceFile = {
  path: string;
  name: string;
  handle: WorkspaceFileHandle;
};

export const isTableFile = (name: string) => /\.(csv|parquet|pq)$/i.test(name);

export const fuzzyPathMatch = (path: string, query: string) => {
  let offset = 0;
  for (const character of query.toLowerCase().replace(/\s/g, '')) {
    offset = path.toLowerCase().indexOf(character, offset);
    if (offset === -1) return false;
    offset += 1;
  }
  return true;
};

export const workspaceHash = (workspaceId: string) => `#workspace=${encodeURIComponent(workspaceId)}`;

export const workspaceIdFromHash = (hash: string) => new URLSearchParams(hash.replace(/^#/, '')).get('workspace') ?? undefined;

export const indexWorkspace = async (directory: WorkspaceDirectoryHandle, prefix = ''): Promise<WorkspaceFile[]> => {
  const files: WorkspaceFile[] = [];
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') files.push(...await indexWorkspace(handle, path));
    if (handle.kind === 'file' && isTableFile(name)) files.push({ path, name, handle });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
};
