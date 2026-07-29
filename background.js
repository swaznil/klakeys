const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.45
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULT_SETTINGS, (savedSettings) => {
    chrome.storage.local.set({
      enabled: savedSettings.enabled,
      volume: savedSettings.volume
    });
  });
});