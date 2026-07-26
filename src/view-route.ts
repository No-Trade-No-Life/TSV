export type VisibleRange = { startTime: number; endTime: number };
export type ViewRoute = { viewId?: string; visibleRange?: VisibleRange; focusTime?: number };

const timestampFrom = (value: string | null) => {
  if (!value) return undefined;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) ? timestamp : undefined;
};

export const viewRouteFromHash = (hash: string): ViewRoute => {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const startTime = timestampFrom(params.get('start_time'));
  const endTime = timestampFrom(params.get('end_time'));
  const focusTime = timestampFrom(params.get('focus_time'));
  return {
    viewId: params.get('view_id') || undefined,
    visibleRange: startTime !== undefined && endTime !== undefined && startTime < endTime ? { startTime, endTime } : undefined,
    focusTime,
  };
};

export const viewHash = ({ viewId, visibleRange, focusTime }: ViewRoute) => {
  const params = new URLSearchParams();
  if (viewId) params.set('view_id', viewId);
  if (visibleRange) {
    params.set('start_time', String(visibleRange.startTime));
    params.set('end_time', String(visibleRange.endTime));
  }
  if (focusTime !== undefined) params.set('focus_time', String(focusTime));
  return `#${params.toString()}`;
};

export const shouldRestoreStoredView = (hasEditingSession: boolean, currentViewIsStored: boolean) =>
  !hasEditingSession && !currentViewIsStored;
