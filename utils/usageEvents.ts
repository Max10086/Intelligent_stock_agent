let refreshUsageCallback: (() => void) | null = null;

export const setUsageRefreshCallback = (callback: (() => void) | null) => {
  refreshUsageCallback = callback;
};

export const notifyUsageUpdated = () => {
  refreshUsageCallback?.();
};
