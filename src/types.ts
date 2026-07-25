export type Row = Record<string, unknown>;

export type MappingKind = 'candlestick' | 'line' | 'histogram' | 'markers' | 'segment';

export type Mapping = {
  id: string;
  sourceId: string;
  paneId: string;
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
  workspaceId: string;
  filename: string;
  timeColumn: string;
};

export type PaneConfig = {
  id: string;
  name: string;
};

export type ViewConfig = {
  id: string;
  name: string;
  panes: PaneConfig[];
};

export type ViewerConfig = {
  version: 4;
  data: DataFileConfig[];
  view: ViewConfig;
  mappings: Mapping[];
};

export type Dataset = {
  id: string;
  fileName: string;
  format: 'CSV' | 'Parquet';
  rows: Row[];
  columns: string[];
};
