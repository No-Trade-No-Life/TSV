import { describe, expect, it } from 'vitest';
import { viewHash, viewIdFromHash } from './view-route';

describe('View 路由', () => {
  it('将 View ID 往返到 URL Hash', () => {
    const viewId = 'f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2';
    expect(viewIdFromHash(viewHash(viewId))).toBe(viewId);
  });
});
