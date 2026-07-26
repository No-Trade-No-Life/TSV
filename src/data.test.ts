import { File } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { parseTime, readDataset, readDatasetMetadata, readConfig, toJson } from './data';

describe('本地数据读取', () => {
  it('读取 CSV', async () => {
    const file = new File([
      'timestamp,open,high,low,close,volume\n1722470400000,10,12,9,11,200\n',
    ], 'candles.csv', { type: 'text/csv' });
    const dataset = await readDataset(file as unknown as globalThis.File);

    expect(dataset.format).toBe('CSV');
    expect(dataset.rows).toHaveLength(1);
  });

  it('读取含 Date 时间列的 Parquet', async () => {
    const date = new Date('2026-07-17T09:31:00.000Z');
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: 'date', data: [date], type: 'TIMESTAMP' },
        { name: 'close', data: [7781.454], type: 'DOUBLE' },
        { name: 'volume', data: [5942n], type: 'INT64' },
      ],
    });
    const file = new File([buffer], 'IC8888.parquet', { type: 'application/vnd.apache.parquet' });
    const dataset = await readDataset(file as unknown as globalThis.File);

    expect(dataset.format).toBe('Parquet');
    expect(dataset.columns).toEqual(['date', 'close', 'volume']);
    expect(parseTime(dataset.rows[0].date)).toBe(Math.floor(date.getTime() / 1000));
    expect(parseTime(dataset.rows[0].volume)).toBe(5942);
  });

  it('只读取 CSV 和 Parquet 的列 metadata', async () => {
    const csv = new File(['timestamp,close\n1722470400000,11\n'], 'candles.csv', { type: 'text/csv' });
    const parquet = new File([parquetWriteBuffer({ columnData: [{ name: 'date', data: [new Date('2026-07-17T09:31:00.000Z')], type: 'TIMESTAMP' }, { name: 'close', data: [7781.454], type: 'DOUBLE' }] })], 'IC8888.parquet');
    const metadataOnly = (file: File) => ({ name: file.name, size: file.size, slice: file.slice.bind(file), arrayBuffer: async () => { throw new Error('不应读取完整文件'); } }) as unknown as globalThis.File;

    await expect(readDatasetMetadata(metadataOnly(csv))).resolves.toMatchObject({ format: 'CSV', columns: ['timestamp', 'close'] });
    await expect(readDatasetMetadata(metadataOnly(parquet))).resolves.toMatchObject({ format: 'Parquet', columns: ['date', 'close'] });
  });
});

describe('图表配置', () => {
  it('保留每个数据源自己的时间列并保持 JSON 往返', () => {
    const original = readConfig('{"version":4,"data":[{"id":"price","workspaceId":"prices","filename":"price.csv","timeColumn":"date"},{"id":"signal","workspaceId":"signals","filename":"signal.csv","timeColumn":"timestamp"}],"view":{"id":"default","name":"复盘","panes":[{"id":"primary","name":"主图"},{"id":"indicator","name":"副图"}]},"mappings":[{"id":"price-line","sourceId":"price","paneId":"primary","kind":"line","name":"收盘","color":"#c6dd62","valueColumn":"close"},{"id":"signal-line","sourceId":"signal","paneId":"indicator","kind":"line","name":"信号","color":"#72c7e8","valueColumn":"signal"}]}');
    expect(readConfig(toJson(original))).toEqual(original);
    expect(original.view.panes).toHaveLength(2);
    expect(() => readConfig('{"version":1}')).toThrow('TSV v4');
    expect(() => readConfig('{"version":4,"data":[],"view":{"id":"default","name":"主图","panes":[{"id":"primary","name":"主图"}]},"mappings":[{"kind":"scatter","sourceId":"x","paneId":"primary"}]}')).toThrow('不支持');
  });

  it('为手写配置补齐编辑所需的元数据', () => {
    const config = readConfig('{"version":4,"data":[{"id":"price","workspaceId":"workspace","filename":"price.csv","timeColumn":"date"}],"view":{"id":"default","name":"主图","panes":[{"id":"primary","name":"主图"}]},"mappings":[{"kind":"line","sourceId":"price","paneId":"primary","valueColumn":"close"}]}');

    expect(config.mappings[0]).toMatchObject({ kind: 'line', name: '序列 1', color: expect.any(String), id: expect.any(String) });
  });

  it('拒绝重复文件名和不存在的数据源引用', () => {
    const view = '{"id":"default","name":"主图","panes":[{"id":"primary","name":"主图"}]}';
    expect(() => readConfig(`{"version":4,"data":[{"id":"one","workspaceId":"a","filename":"same.csv","timeColumn":"time"},{"id":"two","workspaceId":"a","filename":"same.csv","timeColumn":"time"}],"view":${view},"mappings":[]}`)).toThrow('重复的文件名');
    expect(() => readConfig(`{"version":4,"data":[{"id":"one","workspaceId":"a","filename":"one.csv","timeColumn":"time"}],"view":${view},"mappings":[{"kind":"line","sourceId":"two","paneId":"primary"}]}`)).toThrow('不存在的数据源');
    expect(() => readConfig(`{"version":4,"data":[{"id":"one","workspaceId":"a","filename":"one.csv","timeColumn":"time"}],"view":${view},"mappings":[{"kind":"line","sourceId":"one","paneId":"missing"}]}`)).toThrow('不存在的分区');
  });

  it('允许尚未选择工作区路径的数据文件模板', () => {
    expect(readConfig('{"version":4,"data":[{"id":"price","workspaceId":"","filename":"","timeColumn":""}],"view":{"id":"default","name":"主图","panes":[{"id":"primary","name":"主图"}]},"mappings":[]}')).toMatchObject({ data: [{ id: 'price', filename: '' }] });
  });

  it('导入 v3 配置时迁移到主图 Pane', () => {
    const config = readConfig('{"version":3,"data":[{"id":"price","filename":"price.csv","timeColumn":"date"}],"mappings":[{"kind":"line","sourceId":"price","valueColumn":"close"}]}');
    expect(config).toMatchObject({ version: 4, view: { panes: [{ id: 'primary' }] }, mappings: [{ paneId: 'primary' }] });
  });
});
