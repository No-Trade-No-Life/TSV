import { useRef, useState, type ChangeEvent } from 'react';
import { Chart } from './Chart';
import { createInitialConfig, createMapping, readConfig, readDataset, sourceIdsFor, toJson } from './data';
import type { Dataset, Mapping, MappingKind, ViewerConfig } from './types';

const kinds: { value: MappingKind; label: string }[] = [
  { value: 'candlestick', label: 'OHLC 蜡烛图' },
  { value: 'line', label: '折线图' },
  { value: 'histogram', label: '柱状图' },
  { value: 'markers', label: 'Marker 标记' },
  { value: 'segment', label: '线段' },
];

const empty: ViewerConfig = { version: 2, sources: [], mappings: [] };

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

const MappingEditor = ({ mapping, datasets, onChange, onDelete }: { mapping: Mapping; datasets: Dataset[]; onChange: (patch: Partial<Mapping>) => void; onDelete: () => void }) => {
  const dataset = datasets.find((item) => item.id === mapping.sourceId);
  const columns = dataset?.columns ?? [];
  return (
  <article className="mapping">
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
    <label className="field source-field"><span>数据源</span><select value={mapping.sourceId} onChange={(event) => onChange({ sourceId: event.target.value })}>{datasets.map((item) => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label>
    {mapping.kind === 'candlestick' && <div className="mapping-fields">
      <ColumnField label="Open" value={mapping.openColumn} columns={columns} onChange={(openColumn) => onChange({ openColumn })} />
      <ColumnField label="High" value={mapping.highColumn} columns={columns} onChange={(highColumn) => onChange({ highColumn })} />
      <ColumnField label="Low" value={mapping.lowColumn} columns={columns} onChange={(lowColumn) => onChange({ lowColumn })} />
      <ColumnField label="Close" value={mapping.closeColumn} columns={columns} onChange={(closeColumn) => onChange({ closeColumn })} />
    </div>}
    {['line', 'histogram', 'markers'].includes(mapping.kind) && <div className="mapping-fields one-column">
      <ColumnField label="数值列" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} />
      {mapping.kind === 'markers' && <ColumnField label="标记文字（可选）" value={mapping.textColumn} columns={columns} onChange={(textColumn) => onChange({ textColumn })} />}
    </div>}
    {mapping.kind === 'segment' && <div className="mapping-fields">
      <ColumnField label="起点数值" value={mapping.valueColumn} columns={columns} onChange={(valueColumn) => onChange({ valueColumn })} />
      <ColumnField label="终点时间" value={mapping.endTimeColumn} columns={columns} onChange={(endTimeColumn) => onChange({ endTimeColumn })} />
      <ColumnField label="终点数值" value={mapping.endValueColumn} columns={columns} onChange={(endValueColumn) => onChange({ endValueColumn })} />
    </div>}
  </article>
  );
};

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [config, setConfig] = useState<ViewerConfig>(empty);
  const [previewSourceId, setPreviewSourceId] = useState<string>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const configInput = useRef<HTMLInputElement>(null);

  const loadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setError(undefined);
    setIsLoading(true);
    try {
      const sourceIds = sourceIdsFor(files);
      const nextDatasets = await Promise.all(files.map((file, index) => readDataset(file, sourceIds[index])));
      if (nextDatasets.some((dataset) => dataset.columns.length === 0)) throw new Error('至少一个文件没有可读取的列。');
      setDatasets(nextDatasets);
      setConfig(createInitialConfig(nextDatasets));
      setPreviewSourceId(nextDatasets[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取这个文件。');
    } finally {
      setIsLoading(false);
      event.target.value = '';
    }
  };

  const updateMapping = (id: string, patch: Partial<Mapping>) => setConfig((current) => ({
    ...current,
    mappings: current.mappings.map((item) => item.id === id ? { ...item, ...patch } : item),
  }));

  const updateSourceTimeColumn = (id: string, timeColumn: string) => setConfig((current) => ({
    ...current,
    sources: current.sources.map((source) => source.id === id ? { ...source, timeColumn } : source),
  }));

  const importConfig = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setConfig(readConfig(await file.text()));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '配置导入失败。');
    } finally {
      event.target.value = '';
    }
  };

  const previewDataset = datasets.find((dataset) => dataset.id === previewSourceId) ?? datasets[0];
  const hasChart = datasets.length > 0 && config.sources.some((source) => source.timeColumn) && config.mappings.length > 0;
  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="TSV 首页"><span className="brand-mark">T</span><span>TSV</span></a>
      <div className="topbar-title"><span>时间序列工作台</span><em>浏览器本地解析 · 文件不会离开此设备</em></div>
      <label className="primary-button upload"><input type="file" multiple accept=".csv,.parquet,.pq,text/csv,application/vnd.apache.parquet" onChange={loadFiles} />载入数据文件</label>
    </header>

    <section className="workspace">
      <aside className="sidebar" aria-label="图表配置">
        <div className="sidebar-section data-summary">
          <p className="section-label">数据源</p>
          {datasets.length > 0 ? <div className="source-list">{datasets.map((dataset) => {
            const source = config.sources.find((item) => item.id === dataset.id);
            return <div className="source-summary" key={dataset.id}>
              <strong title={dataset.fileName}>{dataset.fileName}</strong>
              <div className="metadata"><span>{dataset.format}</span><span>{dataset.rows.length.toLocaleString()} 行</span><span>{dataset.columns.length} 列</span></div>
              <ColumnField label="时间列" value={source?.timeColumn} columns={dataset.columns} onChange={(timeColumn) => updateSourceTimeColumn(dataset.id, timeColumn)} />
            </div>;
          })}</div> : <p className="muted">尚未载入文件</p>}
        </div>
        {datasets.length > 0 && <>
          <p className="hint source-hint">每个数据文件使用自己的时间列；图形映射只读取所选数据源。</p>
          <div className="sidebar-section mapping-list">
            <div className="section-title"><p className="section-label">图形映射</p><span>{config.mappings.length}</span></div>
            {config.mappings.map((mapping) => <MappingEditor key={mapping.id} mapping={mapping} datasets={datasets} onChange={(patch) => updateMapping(mapping.id, patch)} onDelete={() => setConfig((current) => ({ ...current, mappings: current.mappings.filter((item) => item.id !== mapping.id) }))} />)}
            <div className="add-row">
              {kinds.map((kind) => <button key={kind.value} className="add-button" onClick={() => setConfig((current) => ({ ...current, mappings: [...current.mappings, createMapping(kind.value, current.mappings.length, datasets[0].id)] }))}>+ {kind.label}</button>)}
            </div>
          </div>
          <div className="sidebar-section config-actions">
            <button className="secondary-button" onClick={() => download('tsv-chart.v2.json', toJson(config))}>导出 JSON</button>
            <button className="secondary-button" onClick={() => configInput.current?.click()}>导入 JSON</button>
            <input ref={configInput} hidden type="file" accept="application/json,.json" onChange={importConfig} />
          </div>
        </>}
      </aside>

      <section className="canvas-area">
        {error && <div className="notice error" role="alert">{error}</div>}
        {isLoading && <div className="notice loading" role="status">正在浏览器中读取文件…</div>}
        {hasChart ? <div className="chart-layout">
          <div className="chart-caption"><div><p className="section-label">复盘图表</p><h1>{datasets.length} 个数据源 · {config.mappings.length} 个图层</h1></div><span>拖动缩放 · 十字线检查</span></div>
          <Chart datasets={datasets} config={config} />
          {previewDataset && <Preview dataset={previewDataset} datasets={datasets} selectedId={previewDataset.id} onSelect={setPreviewSourceId} />}
        </div> : <EmptyState hasData={datasets.length > 0} onLoad={loadFiles} />}
      </section>
    </section>
  </main>;
}

const EmptyState = ({ hasData, onLoad }: { hasData: boolean; onLoad: (event: ChangeEvent<HTMLInputElement>) => void }) => <div className="empty-state">
  <div className="empty-symbol">↗</div>
  <p className="section-label">{hasData ? '配置下一步' : '本地时间序列复盘'}</p>
  <h1>{hasData ? '为图形选择数据源并添加映射' : '把多份数据留在你的浏览器里。'}</h1>
  <p>{hasData ? '每个数据源有独立时间列；从左侧添加 OHLC、折线、柱状、Marker 或线段。' : '一次载入多个 CSV 或 Parquet 文件开始。所有解析、配置与绘图都在当前浏览器标签页内完成。'}</p>
  {!hasData && <label className="primary-button upload"><input type="file" multiple accept=".csv,.parquet,.pq,text/csv,application/vnd.apache.parquet" onChange={onLoad} />载入 CSV 或 Parquet</label>}
</div>;

const Preview = ({ dataset, datasets, selectedId, onSelect }: { dataset: Dataset; datasets: Dataset[]; selectedId: string; onSelect: (id: string) => void }) => <section className="preview">
  <div className="section-title"><div><p className="section-label">数据预览</p><h2>前 8 行</h2></div><label className="preview-source"><span>数据源</span><select value={selectedId} onChange={(event) => onSelect(event.target.value)}>{datasets.map((item) => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label></div>
  <div className="table-wrap"><table><thead><tr>{dataset.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{dataset.rows.slice(0, 8).map((row, index) => <tr key={index}>{dataset.columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
</section>;
