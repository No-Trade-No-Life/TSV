import { useRef, useState, type ChangeEvent } from 'react';
import { Chart } from './Chart';
import { createInitialConfig, createMapping, readConfig, readDataset, sourceIdsFor, toJson } from './data';
import type { DataFileConfig, Dataset, Mapping, MappingKind, ViewerConfig } from './types';
import { indexWorkspace, type WorkspaceDirectoryHandle, type WorkspaceFile } from './workspace';

const kinds: { value: MappingKind; label: string }[] = [
  { value: 'candlestick', label: 'OHLC 蜡烛图' },
  { value: 'line', label: '折线图' },
  { value: 'histogram', label: '柱状图' },
  { value: 'markers', label: 'Marker 标记' },
  { value: 'segment', label: '线段' },
];

const empty: ViewerConfig = { version: 3, data: [], mappings: [] };

const download = (name: string, content: string) => {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

type FieldProps = { label: string; value?: string; columns: string[]; onChange: (value: string) => void };
const ColumnField = ({ label, value, columns, onChange }: FieldProps) => (
  <label className="field">
    <span>{label}</span>
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">选择列</option>
      {columns.map((column) => <option key={column} value={column}>{column}</option>)}
    </select>
  </label>
);

const TimeColumnField = ({ source, dataset, onChange }: { source: DataFileConfig; dataset?: Dataset; onChange: (timeColumn: string) => void }) => (
  dataset
    ? <ColumnField label="时间列" value={source.timeColumn} columns={dataset.columns} onChange={onChange} />
    : <label className="field"><span>时间列</span><input value={source.timeColumn} placeholder="例如 timestamp" onChange={(event) => onChange(event.target.value)} /></label>
);

const DataFileEditor = ({ source, dataset, onChange, onDelete }: { source: DataFileConfig; dataset?: Dataset; onChange: (patch: Partial<DataFileConfig>) => void; onDelete: () => void }) => (
  <div className="source-summary">
    <div className="source-head"><strong title={source.filename}>{source.filename || '未命名文件'}</strong><button className="icon-button danger" onClick={onDelete} aria-label={`移除 ${source.filename || source.id}`}>×</button></div>
    <div className="metadata">
      {dataset ? <><span>{dataset.format}</span><span>{dataset.rows.length.toLocaleString()} 行</span><span>{dataset.columns.length} 列</span></> : <span className="pending">待绑定本地文件</span>}
    </div>
    <div className="source-fields">
      <label className="field"><span>引用 ID</span><input value={source.id} onChange={(event) => onChange({ id: event.target.value })} /></label>
      <label className="field"><span>文件名 / 工作区路径</span><input value={source.filename} placeholder="例如 price.parquet" onChange={(event) => onChange({ filename: event.target.value })} /></label>
      <TimeColumnField source={source} dataset={dataset} onChange={(timeColumn) => onChange({ timeColumn })} />
    </div>
  </div>
);

const MappingEditor = ({ mapping, sources, datasets, onChange, onDelete }: { mapping: Mapping; sources: DataFileConfig[]; datasets: Dataset[]; onChange: (patch: Partial<Mapping>) => void; onDelete: () => void }) => {
  const dataset = datasets.find((item) => item.id === mapping.sourceId);
  const columns = dataset?.columns ?? [];
  return <article className="mapping">
    <div className="mapping-head">
      <select aria-label="图形类型" value={mapping.kind} onChange={(event) => onChange({ kind: event.target.value as MappingKind })}>
        {kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
      </select>
      <button className="icon-button danger" onClick={onDelete} aria-label={`移除 ${mapping.name}`}>×</button>
    </div>
    <div className="mapping-meta">
      <label className="field grow"><span>名称</span><input value={mapping.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
      <label className="field color-field"><span>颜色</span><input aria-label="颜色" type="color" value={mapping.color} onChange={(event) => onChange({ color: event.target.value })} /></label>
    </div>
    <label className="field source-field"><span>数据源</span><select value={mapping.sourceId} onChange={(event) => onChange({ sourceId: event.target.value })}>{sources.map((source) => <option key={source.id} value={source.id}>{source.filename || source.id}</option>)}</select></label>
    {!dataset && <p className="hint mapping-pending">载入“{sources.find((source) => source.id === mapping.sourceId)?.filename || mapping.sourceId}”后可选择列。</p>}
    {dataset && mapping.kind === 'candlestick' && <div className="mapping-fields">
      <ColumnField label="Open" value={mapping.openColumn} columns={columns} onChange={(openColumn) => onChange({ openColumn })} />
      <ColumnField label="High" value={mapping.highColumn} columns={columns} onChange={(highColumn) => onChange({ highColumn })} />
      <ColumnField label="Low" value={mapping.lowColumn} columns={columns} onChange={(lowColumn) => onChange({ lowColumn })} />
      <ColumnField label="Close" value={mapping.closeColumn} columns={columns} onChange={(closeColumn) => onChange({ closeColumn })} />
    </div>}
    {dataset && ['line', 'histogram', 'markers'].includes(mapping.kind) && <div className="mapping-fields one-column">
      <ColumnField label="数值列" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} />
      {mapping.kind === 'markers' && <ColumnField label="标记文字（可选）" value={mapping.textColumn} columns={columns} onChange={(textColumn) => onChange({ textColumn })} />}
    </div>}
    {dataset && mapping.kind === 'segment' && <div className="mapping-fields">
      <ColumnField label="起点数值" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} />
      <ColumnField label="终点时间" value={mapping.endTimeColumn} columns={columns} onChange={(endTimeColumn) => onChange({ endTimeColumn })} />
      <ColumnField label="终点数值" value={mapping.endValueColumn} columns={columns} onChange={(endValueColumn) => onChange({ endValueColumn })} />
    </div>}
  </article>;
};

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [config, setConfig] = useState<ViewerConfig>(empty);
  const [workspace, setWorkspace] = useState<{ name: string; handle: WorkspaceDirectoryHandle; files: WorkspaceFile[] }>();
  const [previewSourceId, setPreviewSourceId] = useState<string>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const configInput = useRef<HTMLInputElement>(null);

  const loadDataFiles = async (files: File[], fileKeys = files.map((file) => file.name)) => {
    if (files.length === 0) return;
    setError(undefined);
    setIsLoading(true);
    try {
      if (config.data.length === 0) {
        const ids = sourceIdsFor(files);
        const nextDatasets = await Promise.all(files.map((file, index) => readDataset(file, ids[index])));
        if (nextDatasets.some((dataset) => dataset.columns.length === 0)) throw new Error('至少一个文件没有可读取的列。');
        setDatasets(nextDatasets);
        const initial = createInitialConfig(nextDatasets);
        setConfig({ ...initial, data: initial.data.map((source, index) => ({ ...source, filename: fileKeys[index] })) });
        setPreviewSourceId(nextDatasets[0].id);
      } else {
        const sources = files.map((file, index) => config.data.find((source) => source.filename === fileKeys[index]) ?? config.data.find((source) => source.filename === file.name));
        const unknown = sources.findIndex((source) => !source);
        if (unknown !== -1) throw new Error(`“${fileKeys[unknown]}”不在当前 JSON 的 data 文件清单中。请先新增该数据文件配置。`);
        const nextDatasets = await Promise.all(files.map((file, index) => readDataset(file, sources[index]!.id)));
        if (nextDatasets.some((dataset) => dataset.columns.length === 0)) throw new Error('至少一个文件没有可读取的列。');
        setDatasets((current) => [...current.filter((dataset) => !nextDatasets.some((next) => next.id === dataset.id)), ...nextDatasets]);
        setPreviewSourceId((current) => current ?? nextDatasets[0].id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取这个文件。');
    } finally {
      setIsLoading(false);
    }
  };

  const loadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    await loadDataFiles(files);
    event.target.value = '';
  };

  const addWorkspace = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: 'read' }) => Promise<WorkspaceDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      setError('当前浏览器不支持 File System Access API；请使用 Chromium 系浏览器。');
      return;
    }
    try {
      const handle = await picker.call(window, { mode: 'read' });
      setWorkspace({ name: handle.name, handle, files: await indexWorkspace(handle) });
      setError(undefined);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : '无法读取这个工作区。');
    }
  };

  const refreshWorkspace = async () => {
    if (!workspace) return;
    try {
      if (await workspace.handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('未获得工作区的只读权限。');
      const files = await indexWorkspace(workspace.handle);
      setWorkspace((current) => current ? { ...current, files } : current);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法刷新工作区索引。');
    }
  };

  const loadWorkspaceFiles = async (files: WorkspaceFile[]) => loadDataFiles(await Promise.all(files.map((entry) => entry.handle.getFile())), files.map((entry) => entry.path));

  const updateMapping = (id: string, patch: Partial<Mapping>) => setConfig((current) => ({ ...current, mappings: current.mappings.map((item) => item.id === id ? { ...item, ...patch } : item) }));

  const addDataFile = () => setConfig((current) => {
    const number = Array.from({ length: current.data.length + 1 }, (_, index) => index + 1).find((value) => !current.data.some((source) => source.id === `data-${value}`))!;
    const id = `data-${number}`;
    return { ...current, data: [...current.data, { id, filename: `data-${number}.csv`, timeColumn: '' }] };
  });

  const updateDataFile = (sourceId: string, patch: Partial<DataFileConfig>) => {
    const nextId = patch.id?.trim();
    if (patch.id !== undefined && !nextId) {
      setError('数据源 ID 不能为空。');
      return;
    }
    if (nextId && nextId !== sourceId && config.data.some((source) => source.id === nextId)) {
      setError(`数据源 ID “${nextId}”已存在。`);
      return;
    }
    const nextFilename = patch.filename?.trim();
    if (patch.filename !== undefined && !nextFilename) {
      setError('文件名不能为空。');
      return;
    }
    if (nextFilename && config.data.some((source) => source.id !== sourceId && source.filename === nextFilename)) {
      setError(`文件名“${nextFilename}”已被另一个数据源使用。`);
      return;
    }
    const resolvedId = nextId || sourceId;
    setConfig((current) => ({
      ...current,
      data: current.data.map((source) => source.id === sourceId ? { ...source, ...patch, id: resolvedId } : source),
      mappings: current.mappings.map((mapping) => mapping.sourceId === sourceId ? { ...mapping, sourceId: resolvedId } : mapping),
    }));
    if (resolvedId !== sourceId) setDatasets((current) => current.map((dataset) => dataset.id === sourceId ? { ...dataset, id: resolvedId } : dataset));
    if (patch.filename !== undefined) setDatasets((current) => current.filter((dataset) => dataset.id !== resolvedId));
    if (previewSourceId === sourceId) setPreviewSourceId(resolvedId);
    setError(undefined);
  };

  const removeDataFile = (sourceId: string) => {
    setConfig((current) => ({ ...current, data: current.data.filter((source) => source.id !== sourceId), mappings: current.mappings.filter((mapping) => mapping.sourceId !== sourceId) }));
    setDatasets((current) => current.filter((dataset) => dataset.id !== sourceId));
    if (previewSourceId === sourceId) setPreviewSourceId(undefined);
  };

  const importConfig = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const nextConfig = readConfig(await file.text());
      const sourcesByFilename = new Map(nextConfig.data.map((source) => [source.filename, source]));
      const nextDatasets = datasets.flatMap((dataset) => {
        const source = sourcesByFilename.get(dataset.fileName);
        return source ? [{ ...dataset, id: source.id }] : [];
      });
      setConfig(nextConfig);
      setDatasets(nextDatasets);
      setPreviewSourceId(nextDatasets[0]?.id);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '配置导入失败。');
    } finally {
      event.target.value = '';
    }
  };

  const previewDataset = datasets.find((dataset) => dataset.id === previewSourceId) ?? datasets[0];
  const hasChart = config.mappings.some((mapping) => datasets.some((dataset) => dataset.id === mapping.sourceId) && config.data.some((source) => source.id === mapping.sourceId && source.timeColumn));
  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="TSV 首页"><span className="brand-mark">T</span><span>TSV</span></a>
      <div className="topbar-title"><span>时间序列工作台</span><em>浏览器本地解析 · 文件不会离开此设备</em></div>
      <label className="primary-button upload"><input type="file" multiple accept=".csv,.parquet,.pq,text/csv,application/vnd.apache.parquet" onChange={loadFiles} />绑定本地文件</label>
    </header>

    <section className="workspace">
      <aside className="sidebar" aria-label="图表配置">
        <div className="sidebar-section workspace-summary">
          <div className="section-title"><p className="section-label">本地工作区</p>{workspace && <span>{workspace.files.length} 个表格文件</span>}</div>
          {workspace ? <>
            <strong title={workspace.name}>{workspace.name}</strong>
            <p className="hint">已获只读权限。索引包含子目录中的 CSV、Parquet 与 PQ 文件。</p>
            <div className="workspace-actions">
              <button className="secondary-button" onClick={() => void refreshWorkspace()}>刷新索引</button>
              <button className="secondary-button" disabled={workspace.files.length === 0} onClick={() => void loadWorkspaceFiles(workspace.files)}>载入全部</button>
            </div>
            <details className="workspace-index">
              <summary>环境索引 · {workspace.files.length} 个文件</summary>
              <div className="workspace-file-list">
                {workspace.files.map((file) => <div className="workspace-file" key={file.path}><code title={file.path}>{file.path}</code><button className="add-button" onClick={() => void loadWorkspaceFiles([file])}>绑定</button></div>)}
              </div>
            </details>
          </> : <>
            <p className="muted">选择一个本地目录后，TSV 只会索引并按需读取其中的表格文件。</p>
            <button className="secondary-button add-workspace" onClick={() => void addWorkspace()}>添加工作区</button>
          </>}
        </div>
        <div className="sidebar-section data-summary">
          <div className="section-title"><p className="section-label">数据文件</p><span>{config.data.length}</span></div>
          <p className="hint source-hint">这里直接编辑 JSON 的 data 数组。文件只在你主动选择后按文件名或工作区相对路径绑定，不会保存绝对路径或内容。</p>
          <div className="source-list">{config.data.map((source) => <DataFileEditor key={source.id} source={source} dataset={datasets.find((dataset) => dataset.id === source.id)} onChange={(patch) => updateDataFile(source.id, patch)} onDelete={() => removeDataFile(source.id)} />)}</div>
          {config.data.length === 0 && <p className="muted">新增数据文件，或直接载入文件自动生成清单。</p>}
          <button className="add-button add-data-file" onClick={addDataFile}>+ 新增数据文件</button>
        </div>
        <div className="sidebar-section mapping-list">
          <div className="section-title"><p className="section-label">图形映射</p><span>{config.mappings.length}</span></div>
          {config.mappings.map((mapping) => <MappingEditor key={mapping.id} mapping={mapping} sources={config.data} datasets={datasets} onChange={(patch) => updateMapping(mapping.id, patch)} onDelete={() => setConfig((current) => ({ ...current, mappings: current.mappings.filter((item) => item.id !== mapping.id) }))} />)}
          {config.data.length > 0 ? <div className="add-row">{kinds.map((kind) => <button key={kind.value} className="add-button" onClick={() => setConfig((current) => ({ ...current, mappings: [...current.mappings, createMapping(kind.value, current.mappings.length, current.data[0].id)] }))}>+ {kind.label}</button>)}</div> : <p className="muted">先新增一个数据文件，再添加图层。</p>}
        </div>
        <div className="sidebar-section config-actions">
          <button className="secondary-button" onClick={() => download('tsv-chart.v3.json', toJson(config))}>导出 JSON</button>
          <button className="secondary-button" onClick={() => configInput.current?.click()}>导入 JSON</button>
          <input ref={configInput} hidden type="file" accept="application/json,.json" onChange={importConfig} />
        </div>
      </aside>

      <section className="canvas-area">
        {error && <div className="notice error" role="alert">{error}</div>}
        {isLoading && <div className="notice loading" role="status">正在浏览器中读取文件…</div>}
        {hasChart ? <div className="chart-layout">
          <div className="chart-caption"><div><p className="section-label">复盘图表</p><h1>{datasets.length} 个已绑定文件 · {config.mappings.length} 个图层</h1></div><span>拖动缩放 · 十字线检查</span></div>
          <Chart datasets={datasets} config={config} />
          {previewDataset && <Preview dataset={previewDataset} datasets={datasets} selectedId={previewDataset.id} onSelect={setPreviewSourceId} />}
        </div> : <EmptyState hasData={config.data.length > 0} onLoad={loadFiles} />}
      </section>
    </section>
  </main>;
}

const EmptyState = ({ hasData, onLoad }: { hasData: boolean; onLoad: (event: ChangeEvent<HTMLInputElement>) => void }) => <div className="empty-state">
  <div className="empty-symbol">↗</div>
  <p className="section-label">{hasData ? '等待本地文件绑定' : '本地时间序列复盘'}</p>
  <h1>{hasData ? '选择与 data 文件名相同的本地文件。' : '把多份数据留在你的浏览器里。'}</h1>
  <p>{hasData ? '左侧 JSON 清单已可编辑。绑定后，再为图层选择对应数据列。' : '一次载入多个 CSV 或 Parquet 文件开始。所有解析、配置与绘图都在当前浏览器标签页内完成。'}</p>
  <label className="primary-button upload"><input type="file" multiple accept=".csv,.parquet,.pq,text/csv,application/vnd.apache.parquet" onChange={onLoad} />绑定 CSV 或 Parquet</label>
</div>;

const Preview = ({ dataset, datasets, selectedId, onSelect }: { dataset: Dataset; datasets: Dataset[]; selectedId: string; onSelect: (id: string) => void }) => <section className="preview">
  <div className="section-title"><div><p className="section-label">数据预览</p><h2>前 8 行</h2></div><label className="preview-source"><span>数据源</span><select value={selectedId} onChange={(event) => onSelect(event.target.value)}>{datasets.map((item) => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label></div>
  <div className="table-wrap"><table><thead><tr>{dataset.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{dataset.rows.slice(0, 8).map((row, index) => <tr key={index}>{dataset.columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
</section>;
