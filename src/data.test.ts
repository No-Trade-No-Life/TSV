import { File } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { createInitialConfig, parseTime, readDataset, readConfig, toJson } from './data';

describe('本地数据读取', () => {
  it('读取 CSV，并从标准 OHLC 列生成配置', async () => {
    const file = new File([
      'timestamp,open,high,low,close,volume\n1722470400000,10,12,9,11,200\n',
    ], 'candles.csv', { type: 'text/csv' });
    const dataset = await readDataset(file as unknown as globalThis.File);
    const config = createInitialConfig(dataset.columns);

    expect(dataset.format).toBe('CSV');
    expect(dataset.rows).toHaveLength(1);
    expect(config.timeColumn).toBe('timestamp');
    expect(config.mappings).toMatchObject([{ kind: 'candlestick', openColumn: 'open', closeColumn: 'close' }]);
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
  it('仅接受 TSV v1 配置并保持 JSON 往返', () => {
    const original = createInitialConfig(['date', 'open', 'high', 'low', 'close']);
    expect(readConfig(toJson(original))).toEqual(original);
    expect(() => readConfig('{"version":2}')).toThrow('TSV v1');
  });
});
