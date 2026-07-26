export const viewIdFromHash = (hash: string) => hash.replace(/^#/, '');

export const viewHash = (viewId: string) => `#${encodeURIComponent(viewId)}`;

export const shouldRestoreStoredView = (hasEditingSession: boolean, currentViewIsStored: boolean) =>
  !hasEditingSession && !currentViewIsStored;
