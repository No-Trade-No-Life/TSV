import { describe, expect, it } from 'vitest';
import { formatLocaleDateTime, resolveMappings, resolvePaneLegends } from './Chart';
import type { Time } from 'lightweight-charts';
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

  it('为每个 Pane 分别生成 Legend', () => {
    const datasets: Dataset[] = [{ id: 'price.csv', fileName: 'price.csv', format: 'CSV', columns: ['date', 'close'], rows: [] }];
    const config: ViewerConfig = {
      version: 4,
      data: [{ id: 'price.csv', workspaceId: 'prices', filename: 'price.csv', timeColumn: 'date' }],
      view: { id: 'view', name: '复盘', panes: [{ id: 'price', name: '主图' }, { id: 'volume', name: '成交量' }] },
      mappings: [
        { id: 'line', sourceId: 'price.csv', paneId: 'price', kind: 'line', name: '收盘', color: '#c6dd62', valueColumn: 'close' },
        { id: 'histogram', sourceId: 'price.csv', paneId: 'volume', kind: 'histogram', name: '量能', color: '#72c7e8', valueColumn: 'close' },
      ],
    };

    expect(resolvePaneLegends(resolveMappings(datasets, config), config)).toEqual([
      { paneIndex: 0, paneName: '主图', entries: [{ name: '收盘', color: '#c6dd62' }] },
      { paneIndex: 1, paneName: '成交量', entries: [{ name: '量能', color: '#72c7e8' }] },
    ]);
  });

  it('按浏览器 locale 格式化精确到分钟的时间轴日期', () => {
    const time = 1_722_513_659;
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } as const;
    expect(formatLocaleDateTime(time as Time, 'en-US')).toBe(new Date(time * 1000).toLocaleString('en-US', options));
    expect(formatLocaleDateTime(time as Time, 'zh-CN')).toBe(new Date(time * 1000).toLocaleString('zh-CN', options));
  });
});
