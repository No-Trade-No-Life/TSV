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
      version: 4,
      data: [{ id: 'price.csv', workspaceId: 'prices', filename: 'price.csv', timeColumn: 'date' }, { id: 'signal.csv', workspaceId: 'signals', filename: 'signal.csv', timeColumn: 'timestamp' }],
      view: { id: 'default', name: '复盘', panes: [{ id: 'price-pane', name: '主图' }, { id: 'signal-pane', name: '副图' }] },
      mappings: [
        { id: 'price', sourceId: 'price.csv', paneId: 'price-pane', kind: 'line', name: '收盘价', color: '#c6dd62', valueColumn: 'close' },
        { id: 'signal', sourceId: 'signal.csv', paneId: 'signal-pane', kind: 'markers', name: '信号', color: '#72c7e8', valueColumn: 'signal' },
        { id: 'missing', sourceId: 'missing.csv', paneId: 'price-pane', kind: 'line', name: '缺失', color: '#ea9c62', valueColumn: 'value' },
      ],
    };

    expect(resolveMappings(datasets, config)).toMatchObject([
      { dataset: { id: 'price.csv' }, timeColumn: 'date', paneIndex: 0, mapping: { id: 'price' } },
      { dataset: { id: 'signal.csv' }, timeColumn: 'timestamp', paneIndex: 1, mapping: { id: 'signal' } },
    ]);
  });
});
