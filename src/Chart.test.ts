import { describe, expect, it } from 'vitest';
import { resolveMappings } from './Chart';
import type { Dataset, ViewerConfig } from './types';

describe('多数据源图层解析', () => {
  it('每个图层只使用自己数据源的时间列', () => {
    const datasets: Dataset[] = [
      { id: 'price.csv', fileName: 'price.csv', format: 'CSV', columns: ['date', 'close'], rows: [] },
      { id: 'signal.csv', fileName: 'signal.csv', format: 'CSV', columns: ['timestamp', 'signal'], rows: [] },
    ];
    const config: ViewerConfig = {
      version: 2,
      sources: [{ id: 'price.csv', timeColumn: 'date' }, { id: 'signal.csv', timeColumn: 'timestamp' }],
      mappings: [
        { id: 'price', sourceId: 'price.csv', kind: 'line', name: '收盘价', color: '#c6dd62', valueColumn: 'close' },
        { id: 'signal', sourceId: 'signal.csv', kind: 'markers', name: '信号', color: '#72c7e8', valueColumn: 'signal' },
        { id: 'missing', sourceId: 'missing.csv', kind: 'line', name: '缺失', color: '#ea9c62', valueColumn: 'value' },
      ],
    };

    expect(resolveMappings(datasets, config)).toMatchObject([
      { dataset: { id: 'price.csv' }, timeColumn: 'date', mapping: { id: 'price' } },
      { dataset: { id: 'signal.csv' }, timeColumn: 'timestamp', mapping: { id: 'signal' } },
    ]);
  });
});
