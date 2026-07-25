import { describe, expect, it } from 'vitest';
import { fuzzyPathMatch, indexWorkspace, isTableFile, workspaceHash, workspaceIdFromHash, type WorkspaceDirectoryHandle, type WorkspaceFileHandle, type WorkspaceHandle } from './workspace';

const file = (name: string) => ({ kind: 'file', name }) as unknown as WorkspaceFileHandle;
const directory = (name: string, entries: Array<[string, WorkspaceHandle]>) => ({
  kind: 'directory',
  name,
  async *entries() { yield* entries; },
}) as unknown as WorkspaceDirectoryHandle;

describe('工作区索引', () => {
  it('只索引 CSV 和 Parquet，并保留递归相对路径', async () => {
    const workspace = directory('workspace', [
      ['prices.csv', file('prices.csv')],
      ['notes.md', file('notes.md')],
      ['signals', directory('signals', [['daily.parquet', file('daily.parquet')], ['orders.pq', file('orders.pq')]])],
    ]);

    await expect(indexWorkspace(workspace)).resolves.toMatchObject([
      { name: 'prices.csv', path: 'prices.csv' },
      { name: 'daily.parquet', path: 'signals/daily.parquet' },
      { name: 'orders.pq', path: 'signals/orders.pq' },
    ]);
  });

  it('识别扩展名时不区分大小写', () => {
    expect(isTableFile('ticks.CSV')).toBe(true);
    expect(isTableFile('prices.PARQUET')).toBe(true);
    expect(isTableFile('readme.txt')).toBe(false);
  });

  it('按顺序模糊匹配工作区相对路径', () => {
    expect(fuzzyPathMatch('futures/IC8888/minute.parquet', 'ic min')).toBe(true);
    expect(fuzzyPathMatch('futures/IC8888/minute.parquet', 'ic tick')).toBe(false);
  });

  it('在 URL Hash 中编码并读取工作区 ID', () => {
    const id = 'f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2';
    expect(workspaceHash(id)).toBe(`#workspace=${id}`);
    expect(workspaceIdFromHash(`#workspace=${id}`)).toBe(id);
    expect(workspaceIdFromHash('#other=value')).toBeUndefined();
  });
});
