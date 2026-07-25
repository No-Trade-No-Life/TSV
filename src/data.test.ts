import { File } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { createInitialConfig, parseTime, readDataset, readConfig, sourceIdsFor, toJson } from './data';

describe('本地数据读取', () => {
  it('读取 CSV，并从标准 OHLC 列生成配置', async () => {
    const file = new File([
      'timestamp,open,high,low,close,volume\n1722470400000,10,12,9,11,200\n',
    ], 'candles.csv', { type: 'text/csv' });
    const dataset = await readDataset(file as unknown as globalThis.File);
    const config = createInitialConfig([dataset]);

    expect(dataset.format).toBe('CSV');
    expect(dataset.rows).toHaveLength(1);
    expect(config.sources).toEqual([{ id: 'candles.csv', timeColumn: 'timestamp' }]);
    expect(config.mappings).toMatchObject([{ sourceId: 'candles.csv', kind: 'candlestick', openColumn: 'open', closeColumn: 'close' }]);
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
});

describe('图表配置', () => {
  it('保留每个数据源自己的时间列并保持 JSON 往返', () => {
    const original = createInitialConfig([
      { id: 'price.csv', fileName: 'price.csv', format: 'CSV', rows: [], columns: ['date', 'open', 'high', 'low', 'close'] },
      { id: 'signal.csv', fileName: 'signal.csv', format: 'CSV', rows: [], columns: ['timestamp', 'signal'] },
    ]);
    expect(readConfig(toJson(original))).toEqual(original);
    expect(original.sources).toEqual([{ id: 'price.csv', timeColumn: 'date' }, { id: 'signal.csv', timeColumn: 'timestamp' }]);
    expect(() => readConfig('{"version":1}')).toThrow('TSV v2');
    expect(() => readConfig('{"version":2,"sources":[],"mappings":[{"kind":"scatter","sourceId":"x"}]}')).toThrow('不支持');
  });

  it('为手写配置补齐编辑所需的元数据', () => {
    const config = readConfig('{"version":2,"sources":[{"id":"price.csv","timeColumn":"date"}],"mappings":[{"kind":"line","sourceId":"price.csv","valueColumn":"close"}]}');

    expect(config.mappings[0]).toMatchObject({ kind: 'line', name: '序列 1', color: expect.any(String), id: expect.any(String) });
  });

  it('为重复文件名生成确定且不冲突的数据源标识', () => {
    const files = [new File(['a'], 'ticks.csv'), new File(['b'], 'ticks.csv'), new File(['c'], 'orders.csv')];
    expect(sourceIdsFor(files as unknown as globalThis.File[])).toEqual(['ticks.csv', 'ticks.csv (2)', 'orders.csv']);
  });
});
