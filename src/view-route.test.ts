import { describe, expect, it } from 'vitest';
import { shouldRestoreStoredView, viewHash, viewRouteFromHash } from './view-route';

describe('View 路由', () => {
  it('将 View、可见时间范围与焦点时间往返到 URL Hash', () => {
    const route = {
      viewId: 'f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2',
      visibleRange: { startTime: 1_722_513_000_000, endTime: 1_722_516_600_000 },
      focusTime: 1_722_514_200_000,
    };
    expect(viewHash(route)).toBe('#view_id=f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2&start_time=1722513000000&end_time=1722516600000&focus_time=1722514200000');
    expect(viewRouteFromHash(viewHash(route))).toEqual(route);
  });

  it('忽略不完整或逆序的可见时间范围', () => {
    expect(viewRouteFromHash('#view_id=view&start_time=200&end_time=100')).toEqual({ viewId: 'view', visibleRange: undefined, focusTime: undefined });
    expect(viewRouteFromHash('#view_id=view&start_time=100')).toEqual({ viewId: 'view', visibleRange: undefined, focusTime: undefined });
  });

  it('不会在未保存的 View 编辑会话中回退到旧 View', () => {
    expect(shouldRestoreStoredView(true, false)).toBe(false);
    expect(shouldRestoreStoredView(false, true)).toBe(false);
    expect(shouldRestoreStoredView(false, false)).toBe(true);
  });
});
