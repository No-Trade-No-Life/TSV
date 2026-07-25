import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from './Chart';
import { createMapping, defaultView, readConfig, readDataset, toJson } from './data';
import type { DataFileConfig, Dataset, Mapping, MappingKind, PaneConfig, ViewerConfig } from './types';
import { fuzzyPathMatch, indexWorkspace, initializeWorkspace, listWorkspaceViewFiles, writeWorkspaceViewFile, type WorkspaceConfig, type WorkspaceDirectoryHandle, type WorkspaceFile } from './workspace';
import { deleteWorkspaceHandle, listWorkspaceHandles, saveWorkspaceHandle } from './workspace-store';

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

const cloneConfig = (config: ViewerConfig) => JSON.parse(toJson(config)) as ViewerConfig;

type FieldProps = { label: string; value?: string; columns: string[]; onChange: (value: string) => void };
const ColumnField = ({ label, value, columns, onChange }: FieldProps) => <label className="field"><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)}><option value="">选择列</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>;
const TimeColumnField = ({ source, dataset, onChange }: { source: DataFileConfig; dataset?: Dataset; onChange: (timeColumn: string) => void }) => dataset ? <ColumnField label="时间列" value={source.timeColumn} columns={dataset.columns} onChange={onChange} /> : <label className="field"><span>时间列</span><input value={source.timeColumn} placeholder="读取后选择列" onChange={(event) => onChange(event.target.value)} /></label>;

const DataFileEditor = ({ source, dataset, workspace, onSearch, onChange, onDelete }: { source: DataFileConfig; dataset?: Dataset; workspace?: WorkspaceRuntime; onSearch: () => void; onChange: (patch: Partial<DataFileConfig>) => void; onDelete: () => void }) => {
  const status = dataset ? `${dataset.format} · ${dataset.rows.length.toLocaleString()} 行 · ${dataset.columns.length} 列` : !source.workspaceId ? '从搜索文件中选择数据' : workspace?.permission !== 'granted' ? '工作区需要重新授权' : '仅在保存并应用后读取';
  return <div className="source-summary"><div className="source-head"><strong title={source.filename}>{source.filename || '未选择文件'}</strong><button className="icon-button danger" onClick={onDelete} aria-label={`移除 ${source.filename || source.id}`}>×</button></div><div className="metadata"><span className={dataset ? '' : 'pending'}>{status}</span></div><div className="source-fields"><label className="field"><span>引用 ID</span><input value={source.id} onChange={(event) => onChange({ id: event.target.value })} /></label><label className="field"><span>工作区</span><input disabled value={workspace?.config?.display_name ?? '未选择'} /></label><label className="field file-field"><span>文件</span><button className="file-selector" onClick={onSearch}>{source.filename || '搜索文件…'}</button></label><TimeColumnField source={source} dataset={dataset} onChange={(timeColumn) => onChange({ timeColumn })} /></div></div>;
};

const MappingEditor = ({ mapping, panes, sources, datasets, onChange, onDelete }: { mapping: Mapping; panes: PaneConfig[]; sources: DataFileConfig[]; datasets: Dataset[]; onChange: (patch: Partial<Mapping>) => void; onDelete: () => void }) => {
  const dataset = datasets.find((item) => item.id === mapping.sourceId);
  const columns = dataset?.columns ?? [];
  return <article className="mapping"><div className="mapping-head"><select aria-label="图形类型" value={mapping.kind} onChange={(event) => onChange({ kind: event.target.value as MappingKind })}>{kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select><button className="icon-button danger" onClick={onDelete} aria-label={`移除 ${mapping.name}`}>×</button></div><div className="mapping-meta"><label className="field grow"><span>名称</span><input value={mapping.name} onChange={(event) => onChange({ name: event.target.value })} /></label><label className="field color-field"><span>颜色</span><input aria-label="颜色" type="color" value={mapping.color} onChange={(event) => onChange({ color: event.target.value })} /></label></div><div className="mapping-fields"><label className="field"><span>Pane</span><select value={mapping.paneId} onChange={(event) => onChange({ paneId: event.target.value })}>{panes.map((pane) => <option key={pane.id} value={pane.id}>{pane.name}</option>)}</select></label><label className="field"><span>数据源</span><select value={mapping.sourceId} onChange={(event) => onChange({ sourceId: event.target.value })}>{sources.map((source) => <option key={source.id} value={source.id}>{source.filename || source.id}</option>)}</select></label></div>{!dataset && <p className="hint mapping-pending">保存并应用后会读取数据并提供列选择。</p>}{dataset && mapping.kind === 'candlestick' && <div className="mapping-fields"><ColumnField label="Open" value={mapping.openColumn} columns={columns} onChange={(openColumn) => onChange({ openColumn })} /><ColumnField label="High" value={mapping.highColumn} columns={columns} onChange={(highColumn) => onChange({ highColumn })} /><ColumnField label="Low" value={mapping.lowColumn} columns={columns} onChange={(lowColumn) => onChange({ lowColumn })} /><ColumnField label="Close" value={mapping.closeColumn} columns={columns} onChange={(closeColumn) => onChange({ closeColumn })} /></div>}{dataset && ['line', 'histogram', 'markers'].includes(mapping.kind) && <div className="mapping-fields one-column"><ColumnField label="数值列" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} />{mapping.kind === 'markers' && <ColumnField label="标记文字（可选）" value={mapping.textColumn} columns={columns} onChange={(textColumn) => onChange({ textColumn })} />}</div>}{dataset && mapping.kind === 'segment' && <div className="mapping-fields"><ColumnField label="起点数值" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} /><ColumnField label="终点时间" value={mapping.endTimeColumn} columns={columns} onChange={(endTimeColumn) => onChange({ endTimeColumn })} /><ColumnField label="终点数值" value={mapping.endValueColumn} columns={columns} onChange={(endValueColumn) => onChange({ endValueColumn })} /></div>}</article>;
};

const FileSearchModal = ({ files, target, onClose, onChoose }: { files: SearchFile[]; target?: string; onClose: () => void; onChoose: (file: SearchFile) => void }) => {
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{ file: SearchFile; dataset?: Dataset }>();
  const results = files.filter(({ workspace, file }) => fuzzyPathMatch(`${workspace.config.display_name ?? workspace.handle.name}/${file.path}`, query)).slice(0, 80);
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onClose]);
  const previewFile = async (file: SearchFile) => { setPreview({ file }); try { const dataset = await readDataset(await file.file.handle.getFile(), 'preview'); setPreview((current) => current?.file.workspace.config.workspace_id === file.workspace.config.workspace_id && current.file.file.path === file.file.path ? { file, dataset } : current); } catch { setPreview(undefined); } };
  return <div className="modal-backdrop" role="presentation"><section className="file-search-modal" aria-modal="true" aria-label="搜索文件" role="dialog"><header><div><p className="section-label">所有工作区</p><h2>{target ? '选择数据文件' : '搜索文件'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></header><input autoFocus className="search-input" placeholder="按工作区名或路径模糊搜索" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="file-search-body"><div className="file-search-results">{results.map((entry) => <button className={preview?.file.workspace.config.workspace_id === entry.workspace.config.workspace_id && preview.file.file.path === entry.file.path ? 'search-result active' : 'search-result'} key={`${entry.workspace.config.workspace_id}/${entry.file.path}`} onClick={() => void previewFile(entry)}><span>{entry.file.path}</span><small>{entry.workspace.config.display_name ?? entry.workspace.handle.name}</small></button>)}{results.length === 0 && <p className="muted">没有匹配的数据文件</p>}</div><div className="modal-preview">{preview ? <>{preview.dataset ? <><div className="modal-preview-head"><div><strong>{preview.file.file.path}</strong><span>{preview.dataset.format} · {preview.dataset.rows.length.toLocaleString()} 行 · {preview.dataset.columns.length} 列</span></div><button className="primary-button" onClick={() => onChoose(preview.file)}>{target ? '使用此文件' : '添加为数据源'}</button></div><div className="table-wrap modal-table"><table><thead><tr>{preview.dataset.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.dataset.rows.slice(0, 12).map((row, index) => <tr key={index}>{preview.dataset!.columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div></> : <p className="muted">正在读取文件预览…</p>}</> : <p className="muted">从左侧选择一个文件查看前 12 行。</p>}</div></div></section></div>;
};

export default function App() {
  const [appliedConfig, setAppliedConfig] = useState<ViewerConfig>(empty);
  const [draftConfig, setDraftConfig] = useState<ViewerConfig>(empty);
  const [viewWorkspaceId, setViewWorkspaceId] = useState<string>();
  const [workspaces, setWorkspaces] = useState<WorkspaceRuntime[]>([]);
  const [views, setViews] = useState<StoredView[]>([]);
  const [searchTarget, setSearchTarget] = useState<string | 'new'>();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const datasetCache = useRef(new Map<string, Dataset>());

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

  useEffect(() => { listWorkspaceHandles().then((handles) => Promise.all(handles.map(({ key, handle }) => activateWorkspace(key, handle, false)))).catch((cause) => setError(cause instanceof Error ? cause.message : '无法读取已保存的工作区。')); }, [activateWorkspace]);
  useEffect(() => { if (!viewWorkspaceId && views[0]) { setViewWorkspaceId(views[0].workspaceId); setAppliedConfig(cloneConfig(views[0].config)); setDraftConfig(cloneConfig(views[0].config)); } }, [viewWorkspaceId, views]);

  const searchFiles = useMemo<SearchFile[]>(() => workspaces.filter((workspace): workspace is WorkspaceRuntime & { config: WorkspaceConfig } => workspace.permission === 'granted' && Boolean(workspace.config)).flatMap((workspace) => workspace.files.map((file) => ({ workspace, file }))), [workspaces]);

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
    try { datasetCache.current.clear(); await activateWorkspace(workspace.handleKey, workspace.handle, true); setError(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法刷新工作区。'); }
  };
  const removeWorkspace = async (workspace: WorkspaceRuntime) => {
    await deleteWorkspaceHandle(workspace.handleKey);
    setWorkspaces((current) => current.filter((item) => item.handleKey !== workspace.handleKey));
    if (workspace.config) setViews((current) => current.filter((view) => view.workspaceId !== workspace.config!.workspace_id));
  };

  const selectView = (view: StoredView) => {
    if (toJson(appliedConfig) !== toJson(draftConfig)) return setError('存在未保存修改，请先保存并应用后再切换 View。');
    setViewWorkspaceId(view.workspaceId);
    setAppliedConfig(cloneConfig(view.config));
    setDraftConfig(cloneConfig(view.config));
    setError(undefined);
  };
  const newView = () => {
    if (toJson(appliedConfig) !== toJson(draftConfig)) return setError('存在未保存修改，请先保存并应用后再新建 View。');
    const workspace = workspaces.find((item): item is WorkspaceRuntime & { config: WorkspaceConfig } => item.permission === 'granted' && Boolean(item.config));
    if (!workspace) return setError('请先添加并授权至少一个工作区。');
    const config: ViewerConfig = { version: 4, data: [], view: { ...defaultView(), id: crypto.randomUUID(), name: '未命名 View' }, mappings: [] };
    setViewWorkspaceId(workspace.config.workspace_id);
    setDraftConfig(config);
  };
  const saveAndApply = async () => {
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
      setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存 View。'); }
  };

  const updateDraft = (update: (current: ViewerConfig) => ViewerConfig) => setDraftConfig((current) => update(current));
  const updateMapping = (id: string, patch: Partial<Mapping>) => updateDraft((current) => ({ ...current, mappings: current.mappings.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const updateDataFile = (id: string, patch: Partial<DataFileConfig>) => updateDraft((current) => ({ ...current, data: current.data.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const addPane = () => updateDraft((current) => ({ ...current, view: { ...current.view, panes: [...current.view.panes, { id: crypto.randomUUID(), name: `副图 ${current.view.panes.length}` }] } }));
  const updatePane = (id: string, name: string) => updateDraft((current) => ({ ...current, view: { ...current.view, panes: current.view.panes.map((pane) => pane.id === id ? { ...pane, name } : pane) } }));
  const removePane = (id: string) => updateDraft((current) => current.view.panes.length === 1 ? current : { ...current, view: { ...current.view, panes: current.view.panes.filter((pane) => pane.id !== id) }, mappings: current.mappings.filter((mapping) => mapping.paneId !== id) });
  const chooseSearchFile = (entry: SearchFile) => {
    if (searchTarget === 'new') updateDraft((current) => ({ ...current, data: [...current.data, { id: `data-${current.data.length + 1}`, workspaceId: entry.workspace.config.workspace_id, filename: entry.file.path, timeColumn: '' }] }));
    if (searchTarget && searchTarget !== 'new') updateDataFile(searchTarget, { workspaceId: entry.workspace.config.workspace_id, filename: entry.file.path });
    setSearchTarget(undefined);
  };

  const hasChart = appliedConfig.mappings.some((mapping) => datasets.some((dataset) => dataset.id === mapping.sourceId) && appliedConfig.data.some((source) => source.id === mapping.sourceId && source.timeColumn));
  const dirty = toJson(appliedConfig) !== toJson(draftConfig);
  return <main className="app-shell"><header className="topbar"><a className="brand" href="/" aria-label="TSV 首页"><span className="brand-mark">T</span><span>TSV</span></a><div className="topbar-title"><span>时间序列工作台</span><em>本地工作区与 View 文件同步</em></div><button className="secondary-button top-search" onClick={() => setSearchTarget('new')}>搜索文件</button><button className="secondary-button" onClick={newView}>新建 View</button><button className="primary-button" disabled={!dirty} onClick={() => void saveAndApply()}>保存并应用</button><button className="secondary-button" onClick={() => void addWorkspace()}>添加工作区</button></header>
    <section className="workspace"><aside className="sidebar" aria-label="图表配置">
      <div className="sidebar-section handle-list"><div className="section-title"><p className="section-label">工作区</p><span>{workspaces.length}</span></div>{workspaces.length > 0 ? <div className="handle-items">{workspaces.map((workspace) => <div className="handle-item" key={workspace.handleKey}><span>{workspace.config?.display_name ?? workspace.handle.name}</span><code>{workspace.config?.workspace_id ?? '等待授权'}</code><small>{workspace.permission === 'granted' ? `${workspace.files.length} 个表格文件` : '需要重新授权'}</small><div className="handle-actions"><button className="add-button" onClick={() => void refreshWorkspace(workspace)}>{workspace.permission === 'granted' ? '刷新' : '授权'}</button><button className="add-button" onClick={() => void removeWorkspace(workspace)}>移除</button></div></div>)}</div> : <p className="muted">添加多个工作区后，它们的文件会共同参与搜索。</p>}</div>
      <div className="sidebar-section view-list"><div className="section-title"><p className="section-label">View</p><span>{views.length}</span></div><label className="field"><span>已保存 View</span><select value={viewWorkspaceId ? `${viewWorkspaceId}/${draftConfig.view.id}` : ''} onChange={(event) => { const view = views.find((item) => `${item.workspaceId}/${item.config.view.id}` === event.target.value); if (view) selectView(view); }}><option value="">选择 View</option>{views.map((view) => <option key={`${view.workspaceId}/${view.config.view.id}`} value={`${view.workspaceId}/${view.config.view.id}`}>{view.config.view.name} · {view.config.view.id}</option>)}</select></label><label className="field"><span>显示名称</span><input value={draftConfig.view.name} onChange={(event) => updateDraft((current) => ({ ...current, view: { ...current.view, name: event.target.value } }))} /></label><p className="hint">保存位置：{workspaces.find((workspace) => workspace.config?.workspace_id === viewWorkspaceId)?.config?.display_name ?? '未选择'}</p></div>
      <div className="sidebar-section data-summary"><div className="section-title"><p className="section-label">数据文件</p><span>{draftConfig.data.length}</span></div><p className="hint source-hint">编辑只修改草稿；保存并应用后才读取数据和刷新图表。</p><div className="source-list">{draftConfig.data.map((source) => <DataFileEditor key={source.id} source={source} dataset={datasets.find((dataset) => dataset.id === source.id)} workspace={workspaces.find((workspace) => workspace.config?.workspace_id === source.workspaceId)} onSearch={() => setSearchTarget(source.id)} onChange={(patch) => updateDataFile(source.id, patch)} onDelete={() => updateDraft((current) => ({ ...current, data: current.data.filter((item) => item.id !== source.id), mappings: current.mappings.filter((mapping) => mapping.sourceId !== source.id) }))} />)}</div><button className="add-button add-data-file" onClick={() => setSearchTarget('new')}>+ 搜索并新增数据文件</button></div>
      <div className="sidebar-section pane-list"><div className="section-title"><p className="section-label">Pane</p><span>{draftConfig.view.panes.length}</span></div>{draftConfig.view.panes.map((pane) => <div className="pane-editor" key={pane.id}><input value={pane.name} aria-label="Pane 名称" onChange={(event) => updatePane(pane.id, event.target.value)} /><button className="icon-button danger" disabled={draftConfig.view.panes.length === 1} onClick={() => removePane(pane.id)} aria-label={`移除 ${pane.name}`}>×</button></div>)}<button className="add-button add-pane" onClick={addPane}>+ 新增副图 Pane</button></div>
      <div className="sidebar-section mapping-list"><div className="section-title"><p className="section-label">图形映射</p><span>{draftConfig.mappings.length}</span></div>{draftConfig.mappings.map((mapping) => <MappingEditor key={mapping.id} mapping={mapping} panes={draftConfig.view.panes} sources={draftConfig.data} datasets={datasets} onChange={(patch) => updateMapping(mapping.id, patch)} onDelete={() => updateDraft((current) => ({ ...current, mappings: current.mappings.filter((item) => item.id !== mapping.id) }))} />)}{draftConfig.data.length > 0 ? <div className="add-row">{kinds.map((kind) => <button key={kind.value} className="add-button" onClick={() => updateDraft((current) => ({ ...current, mappings: [...current.mappings, createMapping(kind.value, current.mappings.length, current.data[0].id, current.view.panes[0].id)] }))}>+ {kind.label}</button>)}</div> : <p className="muted">先从搜索中新增数据文件，再添加图层。</p>}</div>
    </aside><section className="canvas-area">{error && <div className="notice error" role="alert">{error}</div>}{isLoading && <div className="notice loading" role="status">正在读取工作区文件…</div>}{hasChart ? <div className="chart-layout"><div className="chart-caption"><div><p className="section-label">{appliedConfig.view.name}</p><h1>{datasets.length} 个数据文件 · {appliedConfig.view.panes.length} 个 Pane · {appliedConfig.mappings.length} 个图层</h1></div><span>{dirty ? '存在未保存修改' : '已应用'}</span></div><Chart datasets={datasets} config={appliedConfig} /></div> : <EmptyState hasWorkspaces={workspaces.length > 0} hasData={draftConfig.data.length > 0} onAddWorkspace={addWorkspace} onNewView={newView} />}</section></section>
    {searchTarget && <FileSearchModal files={searchFiles} target={searchTarget === 'new' ? undefined : searchTarget} onClose={() => setSearchTarget(undefined)} onChoose={chooseSearchFile} />}
  </main>;
}

const EmptyState = ({ hasWorkspaces, hasData, onAddWorkspace, onNewView }: { hasWorkspaces: boolean; hasData: boolean; onAddWorkspace: () => void; onNewView: () => void }) => <div className="empty-state"><div className="empty-symbol">↗</div><p className="section-label">本地时间序列复盘</p><h1>{hasData ? '保存并应用草稿以绘制图表。' : hasWorkspaces ? '新建 View，然后搜索数据文件。' : '从一个可写的本地工作区开始。'}</h1><p>工作区身份和 View 文件都存储在本地目录中，跨机器同步时保持一致。</p>{hasWorkspaces ? <button className="primary-button" onClick={onNewView}>新建 View</button> : <button className="primary-button" onClick={() => void onAddWorkspace()}>添加工作区</button>}</div>;
