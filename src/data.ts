import Papa from 'papaparse';
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { Dataset, Mapping, Row, ViewerConfig } from './types';

const id = () => crypto.randomUUID();

const normaliseRows = (rows: Row[]) =>
  rows.filter((row) => Object.values(row).some((value) => value !== '' && value !== null && value !== undefined));

export const readDataset = async (file: File, id = file.name): Promise<Dataset> => {
  const filename = file.name.toLowerCase();
  if (filename.endsWith('.csv')) {
    const result = Papa.parse<Row>(await file.text(), {
      header: true,
      skipEmptyLines: 'greedy',
    });
    if (result.errors.length > 0) throw new Error(`CSV 解析失败：${result.errors[0].message}`);
    const rows = normaliseRows(result.data);
    return { id, fileName: file.name, format: 'CSV', rows, columns: Object.keys(rows[0] ?? {}) };
  }
  if (filename.endsWith('.parquet') || filename.endsWith('.pq')) {
    const arrayBuffer = await file.arrayBuffer();
    const rows = normaliseRows((await parquetReadObjects({ file: arrayBuffer, compressors })) as Row[]);
    return { id, fileName: file.name, format: 'Parquet', rows, columns: Object.keys(rows[0] ?? {}) };
  }
  throw new Error('只支持 .csv、.parquet 或 .pq 文件。');
};

const firstMatchingColumn = (columns: string[], candidates: string[]) =>
  columns.find((column) => candidates.includes(column.toLowerCase()));

const colorFor = (index: number) => ['#c6dd62', '#72c7e8', '#ea9c62', '#c5a0eb', '#ed7288'][index % 5];

const mapping = (kind: Mapping['kind'], name: string, index: number): Omit<Mapping, 'sourceId'> => ({
  id: id(),
  kind,
  name,
  color: colorFor(index),
});

export const createInitialConfig = (datasets: Dataset[]): ViewerConfig => {
  const data = datasets.map((dataset) => ({
    id: dataset.id,
    filename: dataset.fileName,
    timeColumn: firstMatchingColumn(dataset.columns, ['time', 'timestamp', 'date', 'datetime', 'ts']) ?? dataset.columns[0] ?? '',
  }));
  const mappings = datasets.flatMap((dataset, index) => {
    const openColumn = firstMatchingColumn(dataset.columns, ['open', 'o']);
    const highColumn = firstMatchingColumn(dataset.columns, ['high', 'h']);
    const lowColumn = firstMatchingColumn(dataset.columns, ['low', 'l']);
    const closeColumn = firstMatchingColumn(dataset.columns, ['close', 'c', 'price']);
    return openColumn && highColumn && lowColumn && closeColumn
      ? [{ ...mapping('candlestick', `${dataset.fileName} · OHLC`, index), sourceId: dataset.id, openColumn, highColumn, lowColumn, closeColumn }]
      : [];
  });
  return { version: 3, data, mappings };
};

export const createMapping = (kind: Mapping['kind'], index: number, sourceId: string): Mapping => {
  const labels: Record<Mapping['kind'], string> = {
    candlestick: 'OHLC',
    line: '折线',
    histogram: '柱状',
    markers: '标记',
    segment: '线段',
  };
  return { ...mapping(kind, labels[kind], index), sourceId };
};

export const sourceIdsFor = (files: File[]) => {
  const counts = new Map<string, number>();
  return files.map((file) => {
    const count = counts.get(file.name) ?? 0;
    counts.set(file.name, count + 1);
    return count === 0 ? file.name : `${file.name} (${count + 1})`;
  });
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
  const parsed = JSON.parse(text) as ViewerConfig;
  if (parsed.version !== 3 || !Array.isArray(parsed.data) || !Array.isArray(parsed.mappings)) {
    throw new Error('这不是 TSV v3 图表配置。');
  }
  const mappingKinds: Mapping['kind'][] = ['candlestick', 'line', 'histogram', 'markers', 'segment'];
  if (parsed.data.some((source) => typeof source.id !== 'string' || !source.id || typeof source.filename !== 'string' || typeof source.timeColumn !== 'string')) {
    throw new Error('配置包含无效的数据源。');
  }
  if (new Set(parsed.data.map((source) => source.id)).size !== parsed.data.length) throw new Error('配置包含重复的数据源 ID。');
  const filenames = parsed.data.map((source) => source.filename).filter(Boolean);
  if (new Set(filenames).size !== filenames.length) throw new Error('配置包含重复的文件名。');
  if (parsed.mappings.some((item) => !mappingKinds.includes(item.kind) || typeof item.sourceId !== 'string')) {
    throw new Error('配置包含不支持的图形类型。');
  }
  if (parsed.mappings.some((item) => !parsed.data.some((source) => source.id === item.sourceId))) throw new Error('图层引用了不存在的数据源。');
  return {
    ...parsed,
    mappings: parsed.mappings.map((item, index) => ({
      ...item,
      id: typeof item.id === 'string' && item.id ? item.id : id(),
      name: typeof item.name === 'string' && item.name ? item.name : `序列 ${index + 1}`,
      color: typeof item.color === 'string' && item.color ? item.color : colorFor(index),
    })),
  };
};
