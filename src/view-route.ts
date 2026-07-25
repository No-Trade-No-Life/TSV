export const viewIdFromHash = (hash: string) => hash.replace(/^#/, '');

export const viewHash = (viewId: string) => `#${encodeURIComponent(viewId)}`;
