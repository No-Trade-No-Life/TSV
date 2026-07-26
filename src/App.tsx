import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Chart } from './Chart';
import { createMapping, defaultView, readConfig, readDataset, readDatasetMetadata, toJson, type DatasetMetadata } from './data';
import type { DataFileConfig, Dataset, Mapping, MappingKind, PaneConfig, ViewerConfig } from './types';
import { fuzzyPathMatch, indexWorkspace, initializeWorkspace, listWorkspaceViewFiles, writeWorkspaceConfig, writeWorkspaceViewFile, type WorkspaceConfig, type WorkspaceDirectoryHandle, type WorkspaceFile } from './workspace';
import { deleteWorkspaceHandle, listWorkspaceHandles, saveWorkspaceHandle } from './workspace-store';
import { shouldRestoreStoredView, viewHash, viewIdFromHash } from './view-route';

const kinds: { value: MappingKind; label: string }[] = [
  { value: 'candlestick', label: 'OHLC 蜡烛图' },
  { value: 'line', label: '折线图' },
  { value: 'histogram', label: '柱状图' },
  { value: 'markers', label: 'Marker 标记' },
  { value: 'segment', label: '线段' },
];

const empty: ViewerConfig = { version: 4, data: [], view: defaultView(), mappings: [] };
type WorkspaceRuntime = { handleKey: number; handle: WorkspaceDirectoryHandle; config?: WorkspaceConfig; files: WorkspaceFile[]; permission: PermissionState };
type StoredView = { workspaceId: string; config: ViewerConfig };
type SearchFile = { workspace: WorkspaceRuntime & { config: WorkspaceConfig }; file: WorkspaceFile };
type ViewSession = { config: ViewerConfig; workspaceId?: string };

const cloneConfig = (config: ViewerConfig) => JSON.parse(toJson(config)) as ViewerConfig;
const workspaceName = (workspace: WorkspaceRuntime) => workspace.config?.display_name ?? workspace.handle.name;
const tableFileCounts = (files: WorkspaceFile[]) => files.reduce((counts, file) => {
  if (file.name.toLowerCase().endsWith('.csv')) counts.csv += 1;
  else counts.parquet += 1;
  return counts;
}, { csv: 0, parquet: 0 });

type SelectOption = { value: string; label: string };
type AppSelectProps = { value?: string; options: SelectOption[]; placeholder: string; ariaLabel: string; disabled?: boolean; className?: string; onValueChange: (value: string) => void };
const AppSelect = ({ value, options, placeholder, ariaLabel, disabled, className, onValueChange }: AppSelectProps) => <Select value={value || undefined} disabled={disabled} onValueChange={onValueChange}><SelectTrigger aria-label={ariaLabel} className={className}><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent position="popper"><SelectGroup>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>;

type FieldProps = { label: string; value?: string; columns: string[]; onChange: (value: string) => void };
const ColumnField = ({ label, value, columns, onChange }: FieldProps) => <div className="field"><span>{label}</span><AppSelect ariaLabel={label} value={value} options={columns.map((column) => ({ value: column, label: column }))} placeholder="选择列" onValueChange={onChange} /></div>;
const TimeColumnField = ({ source, metadata, onChange }: { source: DataFileConfig; metadata?: DatasetMetadata; onChange: (timeColumn: string) => void }) => metadata ? <ColumnField label="时间列" value={source.timeColumn} columns={metadata.columns} onChange={onChange} /> : <label className="field"><span>时间列</span><input disabled value={source.timeColumn} placeholder="正在读取列信息…" /></label>;

const DataFileEditor = ({ source, metadata, workspace, onSearch, onChange, onDelete }: { source: DataFileConfig; metadata?: DatasetMetadata; workspace?: WorkspaceRuntime; onSearch: () => void; onChange: (patch: Partial<DataFileConfig>) => void; onDelete: () => void }) => {
  const status = metadata ? `${metadata.format} · 已读取 ${metadata.columns.length} 列` : !source.workspaceId ? '从搜索文件中选择数据' : workspace?.permission !== 'granted' ? '工作区需要重新授权' : '正在读取列信息…';
  const fileLabel = source.filename ? `${workspace ? workspaceName(workspace) : '未选择工作区'} / ${source.filename}` : '搜索文件…';
  return <div className="source-summary"><div className="source-head"><button className="file-selector" title={fileLabel} onClick={onSearch}>{fileLabel}</button><button className="icon-button danger" onClick={onDelete} aria-label={`移除 ${source.filename || source.id}`}>×</button></div><div className="metadata"><span className={metadata ? '' : 'pending'}>{status}</span></div><div className="source-fields"><label className="field"><span>引用 ID</span><input value={source.id} onChange={(event) => onChange({ id: event.target.value })} /></label><TimeColumnField source={source} metadata={metadata} onChange={(timeColumn) => onChange({ timeColumn })} /></div></div>;
};

const MappingEditor = ({ mapping, panes, sources, datasets, metadata, onChange, onDelete }: { mapping: Mapping; panes: PaneConfig[]; sources: DataFileConfig[]; datasets: Dataset[]; metadata?: DatasetMetadata; onChange: (patch: Partial<Mapping>) => void; onDelete: () => void }) => {
  const dataset = datasets.find((item) => item.id === mapping.sourceId);
  const columns = metadata?.columns ?? dataset?.columns ?? [];
  return <article className="mapping"><div className="mapping-head"><AppSelect ariaLabel="图形类型" value={mapping.kind} options={kinds} placeholder="选择图形类型" className="mapping-select" onValueChange={(kind) => onChange({ kind: kind as MappingKind })} /><button className="icon-button danger" onClick={onDelete} aria-label={`移除 ${mapping.name}`}>×</button></div><div className="mapping-meta"><label className="field grow"><span>名称</span><input value={mapping.name} onChange={(event) => onChange({ name: event.target.value })} /></label><label className="field color-field"><span>颜色</span><input aria-label="颜色" type="color" value={mapping.color} onChange={(event) => onChange({ color: event.target.value })} /></label></div><div className="mapping-fields"><div className="field"><span>Pane</span><AppSelect ariaLabel="Pane" value={mapping.paneId} options={panes.map((pane) => ({ value: pane.id, label: pane.name }))} placeholder="选择 Pane" onValueChange={(paneId) => onChange({ paneId })} /></div><div className="field"><span>数据源</span><AppSelect ariaLabel="数据源" value={mapping.sourceId} options={sources.map((source) => ({ value: source.id, label: source.filename || source.id }))} placeholder="选择数据源" onValueChange={(sourceId) => onChange({ sourceId })} /></div></div>{!dataset && <p className="hint mapping-pending">预览后会读取数据并提供列选择。</p>}{dataset && mapping.kind === 'candlestick' && <div className="mapping-fields"><ColumnField label="Open" value={mapping.openColumn} columns={columns} onChange={(openColumn) => onChange({ openColumn })} /><ColumnField label="High" value={mapping.highColumn} columns={columns} onChange={(highColumn) => onChange({ highColumn })} /><ColumnField label="Low" value={mapping.lowColumn} columns={columns} onChange={(lowColumn) => onChange({ lowColumn })} /><ColumnField label="Close" value={mapping.closeColumn} columns={columns} onChange={(closeColumn) => onChange({ closeColumn })} /></div>}{dataset && ['line', 'histogram', 'markers'].includes(mapping.kind) && <div className="mapping-fields one-column"><ColumnField label="数值列" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} />{mapping.kind === 'markers' && <ColumnField label="标记文字（可选）" value={mapping.textColumn} columns={columns} onChange={(textColumn) => onChange({ textColumn })} />}</div>}{dataset && mapping.kind === 'segment' && <div className="mapping-fields"><ColumnField label="起点数值" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} /><ColumnField label="终点时间" value={mapping.endTimeColumn} columns={columns} onChange={(endTimeColumn) => onChange({ endTimeColumn })} /><ColumnField label="终点数值" value={mapping.endValueColumn} columns={columns} onChange={(endValueColumn) => onChange({ endValueColumn })} /></div>}</article>;
};

const WorkspaceManagerModal = ({ workspaces, onAdd, onRefresh, onRename, onRemove, onClose }: { workspaces: WorkspaceRuntime[]; onAdd: () => void; onRefresh: (workspace: WorkspaceRuntime) => void; onRename: (workspace: WorkspaceRuntime, name: string) => void; onRemove: (workspace: WorkspaceRuntime) => void; onClose: () => void }) => {
  const [names, setNames] = useState<Record<number, string>>({});
  useEffect(() => setNames(Object.fromEntries(workspaces.map((workspace) => [workspace.handleKey, workspaceName(workspace)]))), [workspaces]);
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onClose]);
  return <div className="modal-backdrop" role="presentation"><section className="workspace-manager-modal" aria-modal="true" aria-label="工作区管理" role="dialog"><header><div><p className="section-label">本地目录句柄</p><h2>工作区管理</h2><p className="muted">工作区名称和 ID 存在目录根部的 <code>tsv.config.json</code>。</p></div><div className="dialog-actions"><button className="primary-button" onClick={onAdd}>添加工作区</button><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div></header><div className="table-wrap workspace-table"><table><thead><tr><th>名称</th><th>Workspace ID</th><th>Parquet</th><th>CSV</th><th>权限</th><th aria-label="操作" /></tr></thead><tbody>{workspaces.map((workspace) => { const counts = tableFileCounts(workspace.files); const name = names[workspace.handleKey] ?? workspaceName(workspace); return <tr key={workspace.handleKey}><td><input aria-label={`${workspaceName(workspace)} 的名称`} value={name} disabled={!workspace.config} onChange={(event) => setNames((current) => ({ ...current, [workspace.handleKey]: event.target.value }))} /></td><td><code title={workspace.config?.workspace_id}>{workspace.config?.workspace_id ?? '等待授权'}</code></td><td>{workspace.permission === 'granted' ? counts.parquet : '—'}</td><td>{workspace.permission === 'granted' ? counts.csv : '—'}</td><td><span className={workspace.permission === 'granted' ? 'status-good' : 'status-pending'}>{workspace.permission === 'granted' ? '可读写' : '需要授权'}</span></td><td><div className="table-actions"><button className="add-button" disabled={!workspace.config || name.trim() === workspaceName(workspace)} onClick={() => onRename(workspace, name)}>更新</button><button className="add-button" onClick={() => onRefresh(workspace)}>{workspace.permission === 'granted' ? '刷新' : '授权'}</button><button className="add-button danger-button" onClick={() => onRemove(workspace)}>移除</button></div></td></tr>; })}{workspaces.length === 0 && <tr><td colSpan={6}><p className="muted">还没有工作区。添加一个本地目录后，TSV 会建立数据文件和 View 索引。</p></td></tr>}</tbody></table></div></section></div>;
};

const FileSearchModal = ({ files, target, onClose, onChoose }: { files: SearchFile[]; target?: string; onClose: () => void; onChoose: (file: SearchFile) => void }) => {
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{ file: SearchFile; dataset?: Dataset }>();
  const results = files.filter(({ workspace, file }) => fuzzyPathMatch(`${workspaceName(workspace)}/${file.path}`, query)).slice(0, 80);
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onClose]);
  const previewFile = async (file: SearchFile) => { setPreview({ file }); try { const dataset = await readDataset(await file.file.handle.getFile(), 'preview'); setPreview((current) => current?.file.workspace.config.workspace_id === file.workspace.config.workspace_id && current.file.file.path === file.file.path ? { file, dataset } : current); } catch { setPreview(undefined); } };
  return <div className="modal-backdrop file-search-backdrop" role="presentation"><section className="file-search-modal" aria-modal="true" aria-label="搜索文件" role="dialog"><header><div><p className="section-label">所有工作区</p><h2>{target ? '选择数据文件' : '搜索文件'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></header><input autoFocus className="search-input" placeholder="按工作区名或路径模糊搜索" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="file-search-body"><div className="file-search-results">{results.map((entry) => <button className={preview?.file.workspace.config.workspace_id === entry.workspace.config.workspace_id && preview.file.file.path === entry.file.path ? 'search-result active' : 'search-result'} key={`${entry.workspace.config.workspace_id}/${entry.file.path}`} onClick={() => void previewFile(entry)}><span>{entry.file.path}</span><small>{workspaceName(entry.workspace)}</small></button>)}{results.length === 0 && <p className="muted">没有匹配的数据文件</p>}</div><div className="modal-preview">{preview ? <>{preview.dataset ? <><div className="modal-preview-head"><div><strong>{preview.file.file.path}</strong><span>{preview.dataset.format} · {preview.dataset.rows.length.toLocaleString()} 行 · {preview.dataset.columns.length} 列</span></div><button className="primary-button" onClick={() => onChoose(preview.file)}>使用此文件</button></div><div className="table-wrap modal-table"><table><thead><tr>{preview.dataset.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.dataset.rows.slice(0, 12).map((row, index) => <tr key={index}>{preview.dataset!.columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div></> : <p className="muted">正在读取文件预览…</p>}</> : <p className="muted">从左侧选择一个文件查看前 12 行。</p>}</div></div></section></div>;
};

const ViewDrawer = ({ config, workspaceId, workspaces, datasets, metadata, dirty, isNew, onChange, onSearch, onPreview, onSave, onCancel }: { config: ViewerConfig; workspaceId?: string; workspaces: WorkspaceRuntime[]; datasets: Dataset[]; metadata: Map<string, DatasetMetadata>; dirty: boolean; isNew: boolean; onChange: (update: (current: ViewerConfig) => ViewerConfig) => void; onSearch: (id: string | 'new') => void; onPreview: () => void; onSave: () => void; onCancel: () => void }) => {
  const storageWorkspace = workspaces.find((workspace) => workspace.config?.workspace_id === workspaceId);
  const updateMapping = (id: string, patch: Partial<Mapping>) => onChange((current) => ({ ...current, mappings: current.mappings.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const updateDataFile = (id: string, patch: Partial<DataFileConfig>) => onChange((current) => ({ ...current, data: current.data.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const addPane = () => onChange((current) => ({ ...current, view: { ...current.view, panes: [...current.view.panes, { id: crypto.randomUUID(), name: `副图 ${current.view.panes.length}` }] } }));
  const updatePane = (id: string, name: string) => onChange((current) => ({ ...current, view: { ...current.view, panes: current.view.panes.map((pane) => pane.id === id ? { ...pane, name } : pane) } }));
  const removePane = (id: string) => onChange((current) => current.view.panes.length === 1 ? current : { ...current, view: { ...current.view, panes: current.view.panes.filter((pane) => pane.id !== id) }, mappings: current.mappings.filter((mapping) => mapping.paneId !== id) });
  return <aside className="view-drawer" aria-label="View 编辑器"><header className="drawer-header"><div><p className="section-label">{isNew ? '新建 View' : '编辑 View'}</p><h2>{config.view.name || '未命名 View'}</h2><code>{config.view.id}</code></div><div className="drawer-actions"><button className="secondary-button" disabled={!dirty} onClick={onPreview}>预览</button><button className="primary-button" onClick={onSave}>保存</button><button className="secondary-button" onClick={onCancel}>取消</button></div></header><div className="drawer-body"><section className="drawer-section"><div className="section-title"><p className="section-label">View</p><span>{dirty ? '草稿已修改' : '未修改'}</span></div><label className="field"><span>显示名称</span><input value={config.view.name} onChange={(event) => onChange((current) => ({ ...current, view: { ...current.view, name: event.target.value } }))} /></label><p className="hint">保存到：{storageWorkspace ? workspaceName(storageWorkspace) : '未选择工作区'}</p></section><section className="drawer-section"><div className="section-title"><p className="section-label">数据文件</p><span>{config.data.length}</span></div><p className="hint source-hint">打开 Drawer 时只读取列信息；预览或保存后才读取完整数据和刷新图表。</p><div className="source-list">{config.data.map((source) => <DataFileEditor key={source.id} source={source} metadata={metadata.get(source.id)} workspace={workspaces.find((workspace) => workspace.config?.workspace_id === source.workspaceId)} onSearch={() => onSearch(source.id)} onChange={(patch) => updateDataFile(source.id, patch)} onDelete={() => onChange((current) => ({ ...current, data: current.data.filter((item) => item.id !== source.id), mappings: current.mappings.filter((mapping) => mapping.sourceId !== source.id) }))} />)}</div><button className="add-button add-data-file" onClick={() => onSearch('new')}>+ 搜索并新增数据文件</button></section><section className="drawer-section"><div className="section-title"><p className="section-label">Pane</p><span>{config.view.panes.length}</span></div>{config.view.panes.map((pane) => <div className="pane-editor" key={pane.id}><input value={pane.name} aria-label="Pane 名称" onChange={(event) => updatePane(pane.id, event.target.value)} /><button className="icon-button danger" disabled={config.view.panes.length === 1} onClick={() => removePane(pane.id)} aria-label={`移除 ${pane.name}`}>×</button></div>)}<button className="add-button add-pane" onClick={addPane}>+ 新增副图 Pane</button></section><section className="drawer-section mapping-list"><div className="section-title"><p className="section-label">图形映射</p><span>{config.mappings.length}</span></div>{config.mappings.map((mapping) => <MappingEditor key={mapping.id} mapping={mapping} panes={config.view.panes} sources={config.data} datasets={datasets} metadata={metadata.get(mapping.sourceId)} onChange={(patch) => updateMapping(mapping.id, patch)} onDelete={() => onChange((current) => ({ ...current, mappings: current.mappings.filter((item) => item.id !== mapping.id) }))} />)}{config.data.length > 0 ? <div className="add-row">{kinds.map((kind) => <button key={kind.value} className="add-button" onClick={() => onChange((current) => ({ ...current, mappings: [...current.mappings, createMapping(kind.value, current.mappings.length, current.data[0].id, current.view.panes[0].id)] }))}>+ {kind.label}</button>)}</div> : <p className="muted">先从搜索中新增数据文件，再添加图层。</p>}</section></div></aside>;
};

const ViewSwitcher = ({ value, views, disabled, onSelect }: { value: string; views: StoredView[]; disabled: boolean; onSelect: (view: StoredView) => void }) => <div className="view-switcher"><span className="sr-only">切换 View</span><AppSelect ariaLabel="切换 View" value={value} disabled={disabled} options={views.map((view) => ({ value: `${view.workspaceId}/${view.config.view.id}`, label: view.config.view.name }))} placeholder="选择 View" onValueChange={(key) => { const view = views.find((item) => `${item.workspaceId}/${item.config.view.id}` === key); if (view) onSelect(view); }} /></div>;

export default function App() {
  const [appliedConfig, setAppliedConfig] = useState<ViewerConfig>(empty);
  const [draftConfig, setDraftConfig] = useState<ViewerConfig>(empty);
  const [viewWorkspaceId, setViewWorkspaceId] = useState<string>();
  const [workspaces, setWorkspaces] = useState<WorkspaceRuntime[]>([]);
  const [views, setViews] = useState<StoredView[]>([]);
  const [searchTarget, setSearchTarget] = useState<string | 'new'>();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetMetadata, setDatasetMetadata] = useState<Map<string, DatasetMetadata>>(new Map());
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [workspacesReady, setWorkspacesReady] = useState(false);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [viewDrawerOpen, setViewDrawerOpen] = useState(false);
  const [viewSession, setViewSession] = useState<ViewSession>();
  const datasetCache = useRef(new Map<string, Dataset>());
  const metadataCache = useRef(new Map<string, DatasetMetadata>());
  const initializedView = useRef(false);

  const setViewRoute = (viewId: string) => window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${viewHash(viewId)}`);
  const applyStoredView = useCallback((view: StoredView, updateRoute = true) => {
    setViewWorkspaceId(view.workspaceId);
    setAppliedConfig(cloneConfig(view.config));
    setDraftConfig(cloneConfig(view.config));
    if (updateRoute) setViewRoute(view.config.view.id);
  }, []);

  const activateWorkspace = useCallback(async (handleKey: number, handle: WorkspaceDirectoryHandle, requestPermission: boolean) => {
    const permission = requestPermission ? await handle.requestPermission({ mode: 'readwrite' }) : await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      setWorkspaces((current) => [...current.filter((workspace) => workspace.handleKey !== handleKey), { handleKey, handle, files: [], permission }]);
      return;
    }
    const config = await initializeWorkspace(handle);
    const files = await indexWorkspace(handle);
    const viewFiles = await listWorkspaceViewFiles(handle);
    const loadedViews = await Promise.all(viewFiles.map(async ({ id, file }) => {
      const view = readConfig(await file.text());
      if (view.view.id !== id) throw new Error(`View 文件 ${id}.json 的 view.id 不匹配。`);
      return { workspaceId: config.workspace_id, config: view };
    }));
    setWorkspaces((current) => [...current.filter((workspace) => workspace.handleKey !== handleKey), { handleKey, handle, config, files, permission }]);
    setViews((current) => [...current.filter((view) => view.workspaceId !== config.workspace_id), ...loadedViews]);
  }, []);

  useEffect(() => { listWorkspaceHandles().then((handles) => Promise.all(handles.map(({ key, handle }) => activateWorkspace(key, handle, false)))).catch((cause) => setError(cause instanceof Error ? cause.message : '无法读取已保存的工作区。')).finally(() => setWorkspacesReady(true)); }, [activateWorkspace]);
  useEffect(() => {
    if (!workspacesReady || initializedView.current || views.length === 0) return;
    const requestedViewId = viewIdFromHash(window.location.hash);
    const selected = views.find((view) => view.config.view.id === requestedViewId) ?? views[0];
    initializedView.current = true;
    applyStoredView(selected, selected.config.view.id !== requestedViewId);
  }, [applyStoredView, views, workspacesReady]);
  useEffect(() => {
    const loadHashView = () => { const selected = views.find((view) => view.config.view.id === viewIdFromHash(window.location.hash)); if (selected && !viewDrawerOpen) applyStoredView(selected, false); };
    window.addEventListener('hashchange', loadHashView);
    return () => window.removeEventListener('hashchange', loadHashView);
  }, [applyStoredView, viewDrawerOpen, views]);
  useEffect(() => {
    const currentViewIsStored = views.some((view) => view.workspaceId === viewWorkspaceId && view.config.view.id === appliedConfig.view.id);
    if (!workspacesReady || !viewWorkspaceId || !shouldRestoreStoredView(Boolean(viewSession), currentViewIsStored)) return;
    const fallback = views[0];
    if (fallback) applyStoredView(fallback);
  }, [appliedConfig.view.id, applyStoredView, viewSession, viewWorkspaceId, views, workspacesReady]);

  const searchFiles = useMemo<SearchFile[]>(() => workspaces.filter((workspace): workspace is WorkspaceRuntime & { config: WorkspaceConfig } => workspace.permission === 'granted' && Boolean(workspace.config)).flatMap((workspace) => workspace.files.map((file) => ({ workspace, file }))), [workspaces]);
  useEffect(() => {
    if (!viewDrawerOpen) return;
    let active = true;
    const selected = draftConfig.data.flatMap((source) => {
      const entry = searchFiles.find(({ workspace, file }) => workspace.config.workspace_id === source.workspaceId && file.path === source.filename);
      return entry ? [{ source, entry }] : [];
    });
    Promise.all(selected.map(async ({ source, entry }) => {
      const key = `${entry.workspace.config.workspace_id}/${entry.file.path}`;
      const cached = metadataCache.current.get(key);
      const metadata = cached ?? await readDatasetMetadata(await entry.file.handle.getFile());
      metadataCache.current.set(key, metadata);
      return [source.id, metadata] as const;
    })).then((entries) => { if (active) setDatasetMetadata(new Map(entries)); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '无法读取数据文件的列信息。'); });
    return () => { active = false; };
  }, [draftConfig.data, searchFiles, viewDrawerOpen]);
  useEffect(() => {
    let active = true;
    const selected = appliedConfig.data.flatMap((source) => {
      const entry = searchFiles.find(({ workspace, file }) => workspace.config.workspace_id === source.workspaceId && file.path === source.filename);
      return entry ? [{ source, entry }] : [];
    });
    if (selected.length === 0) { setDatasets([]); setIsLoading(false); return () => { active = false; }; }
    setIsLoading(true);
    Promise.all(selected.map(async ({ source, entry }) => {
      const key = `${entry.workspace.config.workspace_id}/${entry.file.path}`;
      const cached = datasetCache.current.get(key);
      if (cached) return { ...cached, id: source.id };
      const dataset = await readDataset(await entry.file.handle.getFile(), source.id);
      datasetCache.current.set(key, dataset);
      return dataset;
    })).then((nextDatasets) => { if (active) setDatasets(nextDatasets); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '无法读取工作区中的数据文件。'); }).finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [appliedConfig, searchFiles]);

  const addWorkspace = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<WorkspaceDirectoryHandle> }).showDirectoryPicker;
    if (!picker) return setError('当前浏览器不支持 File System Access API；请使用 Chromium 系浏览器。');
    try {
      const handle = await picker.call(window, { mode: 'readwrite' });
      const key = await saveWorkspaceHandle(handle);
      await activateWorkspace(key, handle, true);
      setError(undefined);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : '无法添加这个工作区。');
    }
  };
  const refreshWorkspace = async (workspace: WorkspaceRuntime) => {
    try { datasetCache.current.clear(); metadataCache.current.clear(); await activateWorkspace(workspace.handleKey, workspace.handle, true); setError(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法刷新工作区。'); }
  };
  const renameWorkspace = async (workspace: WorkspaceRuntime, name: string) => {
    if (!workspace.config) return;
    const config = { ...workspace.config, display_name: name.trim() || workspace.handle.name };
    try { await writeWorkspaceConfig(workspace.handle, config); setWorkspaces((current) => current.map((item) => item.handleKey === workspace.handleKey ? { ...item, config } : item)); setError(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法更新工作区名称。'); }
  };
  const removeWorkspace = async (workspace: WorkspaceRuntime) => {
    await deleteWorkspaceHandle(workspace.handleKey);
    setWorkspaces((current) => current.filter((item) => item.handleKey !== workspace.handleKey));
    if (!workspace.config) return;
    const remainingViews = views.filter((view) => view.workspaceId !== workspace.config!.workspace_id);
    setViews(remainingViews);
    if (workspace.config.workspace_id !== viewWorkspaceId) return;
    const fallback = remainingViews[0];
    if (fallback) return applyStoredView(fallback);
    setViewWorkspaceId(undefined);
    setAppliedConfig(empty);
    setDraftConfig(empty);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };

  const openViewEditor = () => {
    if (!viewWorkspaceId) return setError('请先创建或选择一个 View。');
    setViewSession({ config: cloneConfig(appliedConfig), workspaceId: viewWorkspaceId });
    setDraftConfig(cloneConfig(appliedConfig));
    setViewDrawerOpen(true);
    setError(undefined);
  };
  const newView = () => {
    const workspace = workspaces.find((item): item is WorkspaceRuntime & { config: WorkspaceConfig } => item.permission === 'granted' && Boolean(item.config));
    if (!workspace) return setError('请先在工作区管理中添加并授权至少一个工作区。');
    setViewSession({ config: cloneConfig(appliedConfig), workspaceId: viewWorkspaceId });
    setViewWorkspaceId(workspace.config.workspace_id);
    setDraftConfig({ version: 4, data: [], view: { ...defaultView(), id: crypto.randomUUID(), name: '未命名 View' }, mappings: [] });
    setViewDrawerOpen(true);
    setError(undefined);
  };
  const previewView = () => {
    try { const config = readConfig(toJson(draftConfig)); setAppliedConfig(cloneConfig(config)); setDatasets([]); setError(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法预览 View。'); }
  };
  const saveView = async () => {
    const workspace = workspaces.find((item) => item.config?.workspace_id === viewWorkspaceId);
    if (!workspace?.config || workspace.permission !== 'granted') return setError('请选择一个已授权工作区作为 View 的保存位置。');
    const storageWorkspaceId = workspace.config.workspace_id;
    try {
      const config = readConfig(toJson(draftConfig));
      await writeWorkspaceViewFile(workspace.handle, config.view.id, toJson(config));
      setViews((current) => [...current.filter((view) => !(view.workspaceId === storageWorkspaceId && view.config.view.id === config.view.id)), { workspaceId: storageWorkspaceId, config }]);
      setAppliedConfig(cloneConfig(config));
      setDraftConfig(cloneConfig(config));
      setDatasets([]);
      setViewDrawerOpen(false);
      setViewSession(undefined);
      setViewRoute(config.view.id);
      setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存 View。'); }
  };
  const cancelViewEdit = () => {
    if (viewSession) {
      setViewWorkspaceId(viewSession.workspaceId);
      setAppliedConfig(cloneConfig(viewSession.config));
      setDraftConfig(cloneConfig(viewSession.config));
      if (viewSession.workspaceId) setViewRoute(viewSession.config.view.id);
    }
    setViewDrawerOpen(false);
    setViewSession(undefined);
  };
  const chooseSearchFile = (entry: SearchFile) => {
    if (searchTarget === 'new') setDraftConfig((current) => ({ ...current, data: [...current.data, { id: `data-${current.data.length + 1}`, workspaceId: entry.workspace.config.workspace_id, filename: entry.file.path, timeColumn: '' }] }));
    if (searchTarget && searchTarget !== 'new') setDraftConfig((current) => ({ ...current, data: current.data.map((item) => item.id === searchTarget ? { ...item, workspaceId: entry.workspace.config.workspace_id, filename: entry.file.path } : item) }));
    setSearchTarget(undefined);
  };

  const currentViewKey = viewWorkspaceId ? `${viewWorkspaceId}/${appliedConfig.view.id}` : '';
  const hasChart = appliedConfig.mappings.some((mapping) => datasets.some((dataset) => dataset.id === mapping.sourceId) && appliedConfig.data.some((source) => source.id === mapping.sourceId && source.timeColumn));
  const drawerDirty = toJson(appliedConfig) !== toJson(draftConfig);
  const hasGrantedWorkspace = workspaces.some((workspace) => workspace.permission === 'granted' && workspace.config);
  return <main className={viewDrawerOpen ? 'app-shell view-drawer-open' : 'app-shell'}><header className="topbar"><a className="brand" href="/" aria-label="TSV 首页"><span className="brand-mark">T</span><span>TSV</span></a><ViewSwitcher value={currentViewKey} views={views} disabled={viewDrawerOpen || views.length === 0} onSelect={applyStoredView} /><div className="topbar-actions"><button className="secondary-button" onClick={() => setWorkspaceManagerOpen(true)}>工作区管理</button><button className="secondary-button" disabled={!hasGrantedWorkspace} onClick={newView}>新建 View</button><button className="primary-button" disabled={!viewWorkspaceId} onClick={openViewEditor}>编辑 View</button></div></header><section className="workspace"><section className="canvas-area">{error && <div className="notice error" role="alert">{error}</div>}{isLoading && <div className="notice loading" role="status">正在读取工作区文件…</div>}{hasChart ? <div className="chart-layout"><Chart datasets={datasets} config={appliedConfig} /></div> : <EmptyState hasWorkspaces={workspaces.length > 0} hasView={Boolean(viewWorkspaceId)} onOpenWorkspaceManager={() => setWorkspaceManagerOpen(true)} onNewView={newView} />}</section></section>{workspaceManagerOpen && <WorkspaceManagerModal workspaces={workspaces} onAdd={() => void addWorkspace()} onRefresh={(workspace) => void refreshWorkspace(workspace)} onRename={(workspace, name) => void renameWorkspace(workspace, name)} onRemove={(workspace) => void removeWorkspace(workspace)} onClose={() => setWorkspaceManagerOpen(false)} />}{viewDrawerOpen && <ViewDrawer config={draftConfig} workspaceId={viewWorkspaceId} workspaces={workspaces} datasets={datasets} metadata={datasetMetadata} dirty={drawerDirty} isNew={!views.some((view) => view.workspaceId === viewWorkspaceId && view.config.view.id === draftConfig.view.id)} onChange={(update) => setDraftConfig((current) => update(current))} onSearch={setSearchTarget} onPreview={previewView} onSave={() => void saveView()} onCancel={cancelViewEdit} />}{searchTarget && <FileSearchModal files={searchFiles} target={searchTarget === 'new' ? undefined : searchTarget} onClose={() => setSearchTarget(undefined)} onChoose={chooseSearchFile} />}</main>;
}

const EmptyState = ({ hasWorkspaces, hasView, onOpenWorkspaceManager, onNewView }: { hasWorkspaces: boolean; hasView: boolean; onOpenWorkspaceManager: () => void; onNewView: () => void }) => <div className="empty-state"><div className="empty-symbol">↗</div><p className="section-label">本地时间序列复盘</p><h1>{hasView ? '编辑 View 并预览图表。' : hasWorkspaces ? '新建 View，然后搜索数据文件。' : '从一个可写的本地工作区开始。'}</h1><p>工作区身份和 View 文件都存储在本地目录中，跨机器同步时保持一致。</p>{hasWorkspaces ? <button className="primary-button" onClick={onNewView}>新建 View</button> : <button className="primary-button" onClick={onOpenWorkspaceManager}>工作区管理</button>}</div>;
