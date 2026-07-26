import Papa from 'papaparse';
import { parquetMetadataAsync, parquetReadObjects, parquetSchema, type AsyncBuffer } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { Dataset, Mapping, Row, ViewerConfig, ViewConfig } from './types';

const id = () => crypto.randomUUID();

const normaliseRows = (rows: Row[]) =>
  rows.filter((row) => Object.values(row).some((value) => value !== '' && value !== null && value !== undefined));

export type DatasetMetadata = Pick<Dataset, 'fileName' | 'format' | 'columns'>;

const formatFor = (file: File): DatasetMetadata['format'] | undefined => {
  const filename = file.name.toLowerCase();
  if (filename.endsWith('.csv')) return 'CSV';
  if (filename.endsWith('.parquet') || filename.endsWith('.pq')) return 'Parquet';
  return undefined;
};

const fileBuffer = (file: File): AsyncBuffer => ({
  byteLength: file.size,
  slice: (start, end) => file.slice(start, end).arrayBuffer(),
});

export const readDatasetMetadata = async (file: File): Promise<DatasetMetadata> => {
  const format = formatFor(file);
  if (format === 'CSV') {
    const result = Papa.parse<Row>(await file.slice(0, 64 * 1024).text(), { header: true, preview: 1, skipEmptyLines: 'greedy' });
    const columns = result.meta.fields ?? [];
    if (columns.length === 0) throw new Error('CSV 缺少表头。');
    return { fileName: file.name, format, columns };
  }
  if (format === 'Parquet') {
    const metadata = await parquetMetadataAsync(fileBuffer(file), { initialFetchSize: 64 * 1024 });
    return { fileName: file.name, format, columns: parquetSchema(metadata).children.map((column) => column.element.name) };
  }
  throw new Error('只支持 .csv、.parquet 或 .pq 文件。');
};

export const readDataset = async (file: File, id = file.name): Promise<Dataset> => {
  const format = formatFor(file);
  if (format === 'CSV') {
    const result = Papa.parse<Row>(await file.text(), {
      header: true,
      skipEmptyLines: 'greedy',
    });
    if (result.errors.length > 0) throw new Error(`CSV 解析失败：${result.errors[0].message}`);
    const rows = normaliseRows(result.data);
    return { id, fileName: file.name, format, rows, columns: Object.keys(rows[0] ?? {}) };
  }
  if (format === 'Parquet') {
    const arrayBuffer = await file.arrayBuffer();
    const rows = normaliseRows((await parquetReadObjects({ file: arrayBuffer, compressors })) as Row[]);
    return { id, fileName: file.name, format, rows, columns: Object.keys(rows[0] ?? {}) };
  }
  throw new Error('只支持 .csv、.parquet 或 .pq 文件。');
};

const colorFor = (index: number) => ['#c6dd62', '#72c7e8', '#ea9c62', '#c5a0eb', '#ed7288'][index % 5];

const mapping = (kind: Mapping['kind'], name: string, index: number): Omit<Mapping, 'sourceId' | 'paneId'> => ({
  id: id(),
  kind,
  name,
  color: colorFor(index),
});

export const defaultView = (): ViewConfig => ({ id: 'default', name: '默认视图', panes: [{ id: 'primary', name: '主图' }] });

export const createMapping = (kind: Mapping['kind'], index: number, sourceId: string, paneId: string): Mapping => {
  const labels: Record<Mapping['kind'], string> = {
    candlestick: 'OHLC',
    line: '折线',
    histogram: '柱状',
    markers: '标记',
    segment: '线段',
  };
  return { ...mapping(kind, labels[kind], index), sourceId, paneId };
};

export const parseTime = (value: unknown): number | undefined => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'bigint') {
    const numericValue = Number(value);
    return Number.isSafeInteger(numericValue) ? Math.floor(numericValue > 10_000_000_000 ? numericValue / 1000 : numericValue) : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value > 10_000_000_000 ? value / 1000 : value);
  if (typeof value === 'string') {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && value.trim() !== '') return Math.floor(numberValue > 10_000_000_000 ? numberValue / 1000 : numberValue);
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.floor(timestamp / 1000);
  }
  return undefined;
};

export const parseNumber = (value: unknown): number | undefined => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

export const toJson = (config: ViewerConfig) => JSON.stringify(config, null, 2);

export const readConfig = (text: string): ViewerConfig => {
  const parsed = JSON.parse(text) as Omit<ViewerConfig, 'version'> & { version?: number };
  const legacy = parsed.version === 3;
  const config: ViewerConfig = legacy
    ? { version: 4, data: parsed.data.map((source) => ({ ...source, workspaceId: '' })), view: defaultView(), mappings: parsed.mappings.map((item) => ({ ...item, paneId: 'primary' })) }
    : parsed as ViewerConfig;
  if (config.version !== 4 || !Array.isArray(config.data) || !Array.isArray(config.mappings) || !config.view || !Array.isArray(config.view.panes)) {
    throw new Error('这不是 TSV v4 图表配置。');
  }
  const mappingKinds: Mapping['kind'][] = ['candlestick', 'line', 'histogram', 'markers', 'segment'];
  if (config.data.some((source) => typeof source.id !== 'string' || !source.id || typeof source.workspaceId !== 'string' || typeof source.filename !== 'string' || typeof source.timeColumn !== 'string')) {
    throw new Error('配置包含无效的数据源。');
  }
  if (new Set(config.data.map((source) => source.id)).size !== config.data.length) throw new Error('配置包含重复的数据源 ID。');
  const filenames = config.data.map((source) => `${source.workspaceId}/${source.filename}`).filter((source) => source !== '/');
  if (new Set(filenames).size !== filenames.length) throw new Error('配置包含重复的文件名。');
  if (!config.view.id || typeof config.view.name !== 'string' || config.view.panes.length === 0 || config.view.panes.some((pane) => typeof pane.id !== 'string' || !pane.id || typeof pane.name !== 'string')) {
    throw new Error('配置包含无效的视图分区。');
  }
  if (new Set(config.view.panes.map((pane) => pane.id)).size !== config.view.panes.length) throw new Error('配置包含重复的分区 ID。');
  if (config.mappings.some((item) => !mappingKinds.includes(item.kind) || typeof item.sourceId !== 'string' || typeof item.paneId !== 'string')) {
    throw new Error('配置包含不支持的图形类型。');
  }
  if (config.mappings.some((item) => !config.data.some((source) => source.id === item.sourceId))) throw new Error('图层引用了不存在的数据源。');
  if (config.mappings.some((item) => !config.view.panes.some((pane) => pane.id === item.paneId))) throw new Error('图层引用了不存在的分区。');
  return {
    ...config,
    mappings: config.mappings.map((item, index) => ({
      ...item,
      id: typeof item.id === 'string' && item.id ? item.id : id(),
      name: typeof item.name === 'string' && item.name ? item.name : `序列 ${index + 1}`,
      color: typeof item.color === 'string' && item.color ? item.color : colorFor(index),
    })),
  };
};
