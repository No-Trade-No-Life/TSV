import { describe, expect, it } from 'vitest';
import { shouldRestoreStoredView, viewHash, viewIdFromHash } from './view-route';

describe('View 路由', () => {
  it('将 View ID 往返到 URL Hash', () => {
    const viewId = 'f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2';
    expect(viewIdFromHash(viewHash(viewId))).toBe(viewId);
  });

  it('不会在未保存的 View 编辑会话中回退到旧 View', () => {
    expect(shouldRestoreStoredView(true, false)).toBe(false);
    expect(shouldRestoreStoredView(false, true)).toBe(false);
    expect(shouldRestoreStoredView(false, false)).toBe(true);
  });
});
