export type Row = Record<string, unknown>;

export type MappingKind = 'candlestick' | 'line' | 'histogram' | 'markers' | 'segment';

export type Mapping = {
  id: string;
  sourceId: string;
  kind: MappingKind;
  name: string;
  color: string;
  valueColumn?: string;
  openColumn?: string;
  highColumn?: string;
  lowColumn?: string;
  closeColumn?: string;
  endTimeColumn?: string;
  endValueColumn?: string;
  textColumn?: string;
};

export type DataFileConfig = {
  id: string;
  filename: string;
  timeColumn: string;
};

export type ViewerConfig = {
  version: 3;
  data: DataFileConfig[];
  mappings: Mapping[];
};

export type Dataset = {
  id: string;
  fileName: string;
  format: 'CSV' | 'Parquet';
  rows: Row[];
  columns: string[];
};
