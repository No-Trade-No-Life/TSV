import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Chart } from './Chart';
import { createMapping, defaultView, readConfig, readDataset, toJson } from './data';
import type { DataFileConfig, Dataset, Mapping, MappingKind, PaneConfig, ViewerConfig } from './types';
import { fuzzyPathMatch, indexWorkspace, type WorkspaceDirectoryHandle, type WorkspaceFile } from './workspace';
import { listWorkspaces, saveWorkspace, type StoredWorkspace } from './workspace-store';

const kinds: { value: MappingKind; label: string }[] = [
  { value: 'candlestick', label: 'OHLC 蜡烛图' },
  { value: 'line', label: '折线图' },
  { value: 'histogram', label: '柱状图' },
  { value: 'markers', label: 'Marker 标记' },
  { value: 'segment', label: '线段' },
];

const empty: ViewerConfig = { version: 4, data: [], view: defaultView(), mappings: [] };

type WorkspaceRuntime = StoredWorkspace & { files: WorkspaceFile[]; permission: PermissionState };
type SearchFile = { workspace: WorkspaceRuntime; file: WorkspaceFile };

const download = (name: string, content: string) => {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

type FieldProps = { label: string; value?: string; columns: string[]; onChange: (value: string) => void };
const ColumnField = ({ label, value, columns, onChange }: FieldProps) => <label className="field"><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)}><option value="">选择列</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>;

const TimeColumnField = ({ source, dataset, onChange }: { source: DataFileConfig; dataset?: Dataset; onChange: (timeColumn: string) => void }) => dataset
  ? <ColumnField label="时间列" value={source.timeColumn} columns={dataset.columns} onChange={onChange} />
  : <label className="field"><span>时间列</span><input value={source.timeColumn} placeholder="读取后选择列" onChange={(event) => onChange(event.target.value)} /></label>;

const DataFileEditor = ({ source, dataset, workspace, onSearch, onChange, onDelete }: { source: DataFileConfig; dataset?: Dataset; workspace?: WorkspaceRuntime; onSearch: () => void; onChange: (patch: Partial<DataFileConfig>) => void; onDelete: () => void }) => {
  const status = dataset ? `${dataset.format} · ${dataset.rows.length.toLocaleString()} 行 · ${dataset.columns.length} 列` : !source.workspaceId ? '从搜索文件中选择数据' : workspace?.permission !== 'granted' ? '工作区需要重新授权' : '正在自动读取';
  return <div className="source-summary">
    <div className="source-head"><strong title={source.filename}>{source.filename || '未选择文件'}</strong><button className="icon-button danger" onClick={onDelete} aria-label={`移除 ${source.filename || source.id}`}>×</button></div>
    <div className="metadata"><span className={dataset ? '' : 'pending'}>{status}</span></div>
    <div className="source-fields">
      <label className="field"><span>引用 ID</span><input value={source.id} onChange={(event) => onChange({ id: event.target.value })} /></label>
      <label className="field"><span>工作区</span><input disabled value={workspace?.name ?? '未选择'} /></label>
      <label className="field file-field"><span>文件</span><button className="file-selector" onClick={onSearch}>{source.filename || '搜索文件…'}</button></label>
      <TimeColumnField source={source} dataset={dataset} onChange={(timeColumn) => onChange({ timeColumn })} />
    </div>
  </div>;
};

const MappingEditor = ({ mapping, panes, sources, datasets, onChange, onDelete }: { mapping: Mapping; panes: PaneConfig[]; sources: DataFileConfig[]; datasets: Dataset[]; onChange: (patch: Partial<Mapping>) => void; onDelete: () => void }) => {
  const dataset = datasets.find((item) => item.id === mapping.sourceId);
  const columns = dataset?.columns ?? [];
  return <article className="mapping">
    <div className="mapping-head"><select aria-label="图形类型" value={mapping.kind} onChange={(event) => onChange({ kind: event.target.value as MappingKind })}>{kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select><button className="icon-button danger" onClick={onDelete} aria-label={`移除 ${mapping.name}`}>×</button></div>
    <div className="mapping-meta"><label className="field grow"><span>名称</span><input value={mapping.name} onChange={(event) => onChange({ name: event.target.value })} /></label><label className="field color-field"><span>颜色</span><input aria-label="颜色" type="color" value={mapping.color} onChange={(event) => onChange({ color: event.target.value })} /></label></div>
    <div className="mapping-fields"><label className="field"><span>Pane</span><select value={mapping.paneId} onChange={(event) => onChange({ paneId: event.target.value })}>{panes.map((pane) => <option key={pane.id} value={pane.id}>{pane.name}</option>)}</select></label><label className="field"><span>数据源</span><select value={mapping.sourceId} onChange={(event) => onChange({ sourceId: event.target.value })}>{sources.map((source) => <option key={source.id} value={source.id}>{source.filename || source.id}</option>)}</select></label></div>
    {!dataset && <p className="hint mapping-pending">选择文件后会自动解析并提供列选择。</p>}
    {dataset && mapping.kind === 'candlestick' && <div className="mapping-fields"><ColumnField label="Open" value={mapping.openColumn} columns={columns} onChange={(openColumn) => onChange({ openColumn })} /><ColumnField label="High" value={mapping.highColumn} columns={columns} onChange={(highColumn) => onChange({ highColumn })} /><ColumnField label="Low" value={mapping.lowColumn} columns={columns} onChange={(lowColumn) => onChange({ lowColumn })} /><ColumnField label="Close" value={mapping.closeColumn} columns={columns} onChange={(closeColumn) => onChange({ closeColumn })} /></div>}
    {dataset && ['line', 'histogram', 'markers'].includes(mapping.kind) && <div className="mapping-fields one-column"><ColumnField label="数值列" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} />{mapping.kind === 'markers' && <ColumnField label="标记文字（可选）" value={mapping.textColumn} columns={columns} onChange={(textColumn) => onChange({ textColumn })} />}</div>}
    {dataset && mapping.kind === 'segment' && <div className="mapping-fields"><ColumnField label="起点数值" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} /><ColumnField label="终点时间" value={mapping.endTimeColumn} columns={columns} onChange={(endTimeColumn) => onChange({ endTimeColumn })} /><ColumnField label="终点数值" value={mapping.endValueColumn} columns={columns} onChange={(endValueColumn) => onChange({ endValueColumn })} /></div>}
  </article>;
};

const FileSearchModal = ({ files, target, onClose, onChoose }: { files: SearchFile[]; target?: string; onClose: () => void; onChoose: (file: SearchFile) => void }) => {
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{ file: SearchFile; dataset?: Dataset }>();
  const results = files.filter(({ workspace, file }) => fuzzyPathMatch(`${workspace.name}/${file.path}`, query)).slice(0, 80);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const previewFile = async (file: SearchFile) => {
    setPreview({ file });
    try {
      const dataset = await readDataset(await file.file.handle.getFile(), 'preview');
      setPreview((current) => current?.file.workspace.workspace_id === file.workspace.workspace_id && current.file.file.path === file.file.path ? { file, dataset } : current);
    } catch {
      setPreview(undefined);
    }
  };
  return <div className="modal-backdrop" role="presentation"><section className="file-search-modal" aria-modal="true" aria-label="搜索文件" role="dialog"><header><div><p className="section-label">所有工作区</p><h2>{target ? '选择数据文件' : '搜索文件'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></header><input autoFocus className="search-input" placeholder="按工作区名或路径模糊搜索" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="file-search-body"><div className="file-search-results">{results.map((entry) => <button className={preview?.file.workspace.workspace_id === entry.workspace.workspace_id && preview.file.file.path === entry.file.path ? 'search-result active' : 'search-result'} key={`${entry.workspace.workspace_id}/${entry.file.path}`} onClick={() => void previewFile(entry)}><span>{entry.file.path}</span><small>{entry.workspace.name}</small></button>)}{results.length === 0 && <p className="muted">没有匹配的数据文件</p>}</div><div className="modal-preview">{preview ? <>{preview.dataset ? <><div className="modal-preview-head"><div><strong>{preview.file.file.path}</strong><span>{preview.dataset.format} · {preview.dataset.rows.length.toLocaleString()} 行 · {preview.dataset.columns.length} 列</span></div><button className="primary-button" onClick={() => onChoose(preview.file)}>{target ? '使用此文件' : '添加为数据源'}</button></div><div className="table-wrap modal-table"><table><thead><tr>{preview.dataset.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.dataset.rows.slice(0, 12).map((row, index) => <tr key={index}>{preview.dataset!.columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div></> : <p className="muted">正在读取文件预览…</p>}</> : <p className="muted">从左侧选择一个文件查看前 12 行。</p>}</div></div></section></div>;
};

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [config, setConfig] = useState<ViewerConfig>(empty);
  const [workspaces, setWorkspaces] = useState<WorkspaceRuntime[]>([]);
  const [searchTarget, setSearchTarget] = useState<string | 'new'>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const configInput = useRef<HTMLInputElement>(null);
  const datasetCache = useRef(new Map<string, Dataset>());

  useEffect(() => {
    // COMPATIBILITY: v3 used the hash to select one workspace. Remove it on first load because v4 combines all workspaces.
    if (window.location.hash.startsWith('#workspace=')) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, []);

  const activateWorkspace = useCallback(async (record: StoredWorkspace, requestPermission: boolean) => {
    const permission = requestPermission ? await record.handle.requestPermission({ mode: 'read' }) : await record.handle.queryPermission({ mode: 'read' });
    const files = permission === 'granted' ? await indexWorkspace(record.handle) : [];
    setWorkspaces((current) => [...current.filter((workspace) => workspace.workspace_id !== record.workspace_id), { ...record, files, permission }].sort((left, right) => left.createdAt - right.createdAt));
  }, []);

  useEffect(() => { listWorkspaces().then((records) => Promise.all(records.map((record) => activateWorkspace(record, false)))).catch((cause) => setError(cause instanceof Error ? cause.message : '无法读取已保存的工作区。')); }, [activateWorkspace]);

  const searchFiles = useMemo<SearchFile[]>(() => workspaces.filter((workspace) => workspace.permission === 'granted').flatMap((workspace) => workspace.files.map((file) => ({ workspace, file }))), [workspaces]);

  useEffect(() => {
    let active = true;
    const selected = config.data.flatMap((source) => {
      const entry = searchFiles.find(({ workspace, file }) => workspace.workspace_id === source.workspaceId && file.path === source.filename);
      return entry ? [{ source, entry }] : [];
    });
    const missing = config.data.filter((source) => source.workspaceId && source.filename && !selected.some((item) => item.source.id === source.id));
    if (selected.length === 0) {
      setDatasets([]);
      setIsLoading(false);
      if (missing.length > 0) setError(`未找到：${missing.map((source) => source.filename).join('、')}`);
      return () => { active = false; };
    }
    setIsLoading(true);
    Promise.all(selected.map(async ({ source, entry }) => {
      const key = `${entry.workspace.workspace_id}/${entry.file.path}`;
      const cached = datasetCache.current.get(key);
      if (cached) return { ...cached, id: source.id };
      const dataset = await readDataset(await entry.file.handle.getFile(), source.id);
      datasetCache.current.set(key, dataset);
      return dataset;
    })).then((nextDatasets) => {
      if (!active) return;
      setDatasets(nextDatasets);
      setError(missing.length > 0 ? `未找到：${missing.map((source) => source.filename).join('、')}` : undefined);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '无法读取工作区中的数据文件。'); }).finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [config.data, searchFiles]);

  const addWorkspace = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: 'read' }) => Promise<WorkspaceDirectoryHandle> }).showDirectoryPicker;
    if (!picker) return setError('当前浏览器不支持 File System Access API；请使用 Chromium 系浏览器。');
    try {
      const handle = await picker.call(window, { mode: 'read' });
      const record: StoredWorkspace = { workspace_id: crypto.randomUUID(), name: handle.name, handle, createdAt: Date.now() };
      await saveWorkspace(record);
      await activateWorkspace(record, true);
      setError(undefined);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : '无法添加这个工作区。');
    }
  };

  const refreshWorkspace = async (record: WorkspaceRuntime) => {
    try {
      datasetCache.current.clear();
      await activateWorkspace(record, true);
      setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法刷新工作区索引。'); }
  };

  const updateMapping = (id: string, patch: Partial<Mapping>) => setConfig((current) => ({ ...current, mappings: current.mappings.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const updateDataFile = (id: string, patch: Partial<DataFileConfig>) => setConfig((current) => ({ ...current, data: current.data.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const addPane = () => setConfig((current) => ({ ...current, view: { ...current.view, panes: [...current.view.panes, { id: crypto.randomUUID(), name: `副图 ${current.view.panes.length}` }] } }));
  const updatePane = (id: string, name: string) => setConfig((current) => ({ ...current, view: { ...current.view, panes: current.view.panes.map((pane) => pane.id === id ? { ...pane, name } : pane) } }));
  const removePane = (id: string) => setConfig((current) => current.view.panes.length === 1 ? current : { ...current, view: { ...current.view, panes: current.view.panes.filter((pane) => pane.id !== id) }, mappings: current.mappings.filter((mapping) => mapping.paneId !== id) });

  const chooseSearchFile = (entry: SearchFile) => {
    if (searchTarget === 'new') {
      setConfig((current) => {
        const number = current.data.length + 1;
        return { ...current, data: [...current.data, { id: `data-${number}`, workspaceId: entry.workspace.workspace_id, filename: entry.file.path, timeColumn: '' }] };
      });
    } else if (searchTarget) updateDataFile(searchTarget, { workspaceId: entry.workspace.workspace_id, filename: entry.file.path });
    setSearchTarget(undefined);
  };

  const importConfig = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { setConfig(readConfig(await file.text())); setError(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : '配置导入失败。'); } finally { event.target.value = ''; }
  };

  const hasChart = config.mappings.some((mapping) => datasets.some((dataset) => dataset.id === mapping.sourceId) && config.data.some((source) => source.id === mapping.sourceId && source.timeColumn));
  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="TSV 首页"><span className="brand-mark">T</span><span>TSV</span></a><div className="topbar-title"><span>时间序列工作台</span><em>浏览器本地解析 · 文件不会离开此设备</em></div><button className="secondary-button top-search" onClick={() => setSearchTarget('new')}>搜索文件</button><button className="primary-button" onClick={() => void addWorkspace()}>添加工作区</button></header>
    <section className="workspace"><aside className="sidebar" aria-label="图表配置">
      <div className="sidebar-section handle-list"><div className="section-title"><p className="section-label">工作区</p><span>{workspaces.length}</span></div>{workspaces.length > 0 ? <div className="handle-items">{workspaces.map((workspace) => <div className="handle-item" key={workspace.workspace_id}><span>{workspace.name}</span><code>{workspace.workspace_id}</code><small>{workspace.permission === 'granted' ? `${workspace.files.length} 个表格文件` : '需要重新授权'}</small><button className="add-button" onClick={() => void refreshWorkspace(workspace)}>{workspace.permission === 'granted' ? '刷新索引' : '重新授权'}</button></div>)}</div> : <p className="muted">添加多个工作区后，它们的文件会共同参与搜索。</p>}</div>
      <div className="sidebar-section data-summary"><div className="section-title"><p className="section-label">数据文件</p><span>{config.data.length}</span></div><p className="hint source-hint">文件来源可跨多个工作区。通过搜索弹窗选择后，应用自动解析并缓存。</p><div className="source-list">{config.data.map((source) => <DataFileEditor key={source.id} source={source} dataset={datasets.find((dataset) => dataset.id === source.id)} workspace={workspaces.find((workspace) => workspace.workspace_id === source.workspaceId)} onSearch={() => setSearchTarget(source.id)} onChange={(patch) => updateDataFile(source.id, patch)} onDelete={() => setConfig((current) => ({ ...current, data: current.data.filter((item) => item.id !== source.id), mappings: current.mappings.filter((mapping) => mapping.sourceId !== source.id) }))} />)}</div><button className="add-button add-data-file" onClick={() => setSearchTarget('new')}>+ 搜索并新增数据文件</button></div>
      <div className="sidebar-section pane-list"><div className="section-title"><p className="section-label">Pane</p><span>{config.view.panes.length}</span></div>{config.view.panes.map((pane) => <div className="pane-editor" key={pane.id}><input value={pane.name} aria-label="Pane 名称" onChange={(event) => updatePane(pane.id, event.target.value)} /><button className="icon-button danger" disabled={config.view.panes.length === 1} onClick={() => removePane(pane.id)} aria-label={`移除 ${pane.name}`}>×</button></div>)}<button className="add-button add-pane" onClick={addPane}>+ 新增副图 Pane</button></div>
      <div className="sidebar-section mapping-list"><div className="section-title"><p className="section-label">图形映射</p><span>{config.mappings.length}</span></div>{config.mappings.map((mapping) => <MappingEditor key={mapping.id} mapping={mapping} panes={config.view.panes} sources={config.data} datasets={datasets} onChange={(patch) => updateMapping(mapping.id, patch)} onDelete={() => setConfig((current) => ({ ...current, mappings: current.mappings.filter((item) => item.id !== mapping.id) }))} />)}{config.data.length > 0 ? <div className="add-row">{kinds.map((kind) => <button key={kind.value} className="add-button" onClick={() => setConfig((current) => ({ ...current, mappings: [...current.mappings, createMapping(kind.value, current.mappings.length, current.data[0].id, current.view.panes[0].id)] }))}>+ {kind.label}</button>)}</div> : <p className="muted">先从搜索中新增数据文件，再添加图层。</p>}</div>
      <div className="sidebar-section config-actions"><button className="secondary-button" onClick={() => download('tsv-chart.v4.json', toJson(config))}>导出 JSON</button><button className="secondary-button" onClick={() => configInput.current?.click()}>导入 JSON</button><input ref={configInput} hidden type="file" accept="application/json,.json" onChange={importConfig} /></div>
    </aside><section className="canvas-area">{error && <div className="notice error" role="alert">{error}</div>}{isLoading && <div className="notice loading" role="status">正在读取工作区文件…</div>}{hasChart ? <div className="chart-layout"><div className="chart-caption"><div><p className="section-label">{config.view.name}</p><h1>{datasets.length} 个数据文件 · {config.view.panes.length} 个 Pane · {config.mappings.length} 个图层</h1></div><span>拖动缩放 · 十字线检查</span></div><Chart datasets={datasets} config={config} /></div> : <EmptyState hasWorkspaces={workspaces.length > 0} hasData={config.data.length > 0} onAddWorkspace={addWorkspace} onSearch={() => setSearchTarget('new')} />}</section></section>
    {searchTarget && <FileSearchModal files={searchFiles} target={searchTarget === 'new' ? undefined : searchTarget} onClose={() => setSearchTarget(undefined)} onChoose={chooseSearchFile} />}
  </main>;
}

const EmptyState = ({ hasWorkspaces, hasData, onAddWorkspace, onSearch }: { hasWorkspaces: boolean; hasData: boolean; onAddWorkspace: () => void; onSearch: () => void }) => <div className="empty-state"><div className="empty-symbol">↗</div><p className="section-label">本地时间序列复盘</p><h1>{hasData ? '搜索文件，完成数据源配置。' : hasWorkspaces ? '从所有工作区中搜索数据文件。' : '从一个本地工作区开始。'}</h1><p>多个工作区可以共同提供数据文件；搜索、预览与图表解析都在浏览器本地完成。</p>{hasWorkspaces ? <button className="primary-button" onClick={onSearch}>搜索文件</button> : <button className="primary-button" onClick={() => void onAddWorkspace()}>添加工作区</button>}</div>;
