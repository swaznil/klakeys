const enabledToggle = document.querySelector("#enabledToggle");
const statusText = document.querySelector("#statusText");
const volumeSlider = document.querySelector("#volumeSlider");
const volumeValue = document.querySelector("#volumeValue");

const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.3
};

function updateStatus(enabled) {
  enabledToggle.checked = enabled;
  statusText.textContent = enabled ? "Enabled" : "Disabled";
}

function updateVolume(volume) {
  const percentage = Math.round(volume * 100);

  volumeSlider.value = percentage;
  volumeValue.textContent = `${percentage}%`;
}

chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
  updateStatus(settings.enabled);
  updateVolume(settings.volume);
});

enabledToggle.addEventListener("change", () => {
  const enabled = enabledToggle.checked;

  chrome.storage.local.set({ enabled });
  updateStatus(enabled);
});

volumeSlider.addEventListener("input", () => {
  const percentage = Number(volumeSlider.value);
  const volume = percentage / 100;

  volumeValue.textContent = `${percentage}%`;
  chrome.storage.local.set({ volume });
});