export type WorkspaceFileHandle = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

export type WorkspaceDirectoryHandle = {
  kind: 'directory';
  name: string;
  entries: () => AsyncIterableIterator<[string, WorkspaceHandle]>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<WorkspaceFileHandle>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<WorkspaceDirectoryHandle>;
  queryPermission: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export type WorkspaceHandle = WorkspaceFileHandle | WorkspaceDirectoryHandle;

export type WorkspaceFile = {
  path: string;
  name: string;
  handle: WorkspaceFileHandle;
};

export type WorkspaceConfig = { workspace_id: string; display_name?: string };

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

export const workspaceConfigFile = 'tsv.config.json';
export const viewFileName = (viewId: string) => `${viewId}.json`;

const isWorkspaceConfig = (value: unknown): value is WorkspaceConfig => {
  if (!value || typeof value !== 'object') return false;
  const config = value as WorkspaceConfig;
  return typeof config.workspace_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.workspace_id) && (config.display_name === undefined || typeof config.display_name === 'string');
};

const writeFile = async (handle: WorkspaceFileHandle, content: string) => {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
};

export const initializeWorkspace = async (handle: WorkspaceDirectoryHandle): Promise<WorkspaceConfig> => {
  try {
    const file = await (await handle.getFileHandle(workspaceConfigFile)).getFile();
    const config = JSON.parse(await file.text()) as unknown;
    if (!isWorkspaceConfig(config)) throw new Error(`${workspaceConfigFile} 缺少有效的 workspace_id。`);
    await handle.getDirectoryHandle('.tsv', { create: true }).then((directory) => directory.getDirectoryHandle('views', { create: true }));
    return config;
  } catch (cause) {
    if (!(cause instanceof DOMException) || cause.name !== 'NotFoundError') throw cause;
    const config: WorkspaceConfig = { workspace_id: crypto.randomUUID(), display_name: handle.name };
    await writeFile(await handle.getFileHandle(workspaceConfigFile, { create: true }), JSON.stringify(config, null, 2));
    await handle.getDirectoryHandle('.tsv', { create: true }).then((directory) => directory.getDirectoryHandle('views', { create: true }));
    return config;
  }
};

export const writeWorkspaceConfig = async (handle: WorkspaceDirectoryHandle, config: WorkspaceConfig) =>
  writeFile(await handle.getFileHandle(workspaceConfigFile, { create: true }), JSON.stringify(config, null, 2));

export const listWorkspaceViewFiles = async (handle: WorkspaceDirectoryHandle) => {
  const root = await handle.getDirectoryHandle('.tsv', { create: true });
  const views = await root.getDirectoryHandle('views', { create: true });
  const files: Array<{ id: string; file: File }> = [];
  for await (const [name, entry] of views.entries()) {
    if (entry.kind === 'file' && name.endsWith('.json')) files.push({ id: name.slice(0, -'.json'.length), file: await entry.getFile() });
  }
  return files.sort((left, right) => left.id.localeCompare(right.id));
};

export const writeWorkspaceViewFile = async (handle: WorkspaceDirectoryHandle, viewId: string, content: string) => {
  const root = await handle.getDirectoryHandle('.tsv', { create: true });
  const views = await root.getDirectoryHandle('views', { create: true });
  await writeFile(await views.getFileHandle(viewFileName(viewId), { create: true }), content);
};

export const indexWorkspace = async (directory: WorkspaceDirectoryHandle, prefix = ''): Promise<WorkspaceFile[]> => {
  const files: WorkspaceFile[] = [];
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') files.push(...await indexWorkspace(handle, path));
    if (handle.kind === 'file' && isTableFile(name)) files.push({ path, name, handle });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
};
