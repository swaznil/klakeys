const enabledToggle = document.querySelector("#enabledToggle");
const overlayToggle = document.querySelector("#overlayToggle");
const statusText = document.querySelector("#statusText");
const volumeSlider = document.querySelector("#volumeSlider");
const volumeValue = document.querySelector("#volumeValue");
const wpmValue = document.querySelector("#wpmValue");
const wordValue = document.querySelector("#wordValue");
const statsDate = document.querySelector("#statsDate");
const resetStatsButton = document.querySelector("#resetStatsButton");
const version = document.querySelector("#version");
const message = document.querySelector("#message");

const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.3,
  showWpmOverlay: false,
};

let messageTimer;
let previewAudio;

function normalizeVolume(value) {
  const volume = Number(value);

  if (!Number.isFinite(volume)) {
    return DEFAULT_SETTINGS.volume;
  }

  return Math.min(1, Math.max(0, volume));
}

function setMessage(text) {
  clearTimeout(messageTimer);
  message.textContent = text;

  if (text) {
    messageTimer = setTimeout(() => {
      message.textContent = "";
    }, 2500);
  }
}

function updateSoundState(enabled) {
  enabledToggle.checked = enabled;
  statusText.textContent = enabled ? "On" : "Off";
  volumeSlider.disabled = !enabled;
}

function updateVolume(value) {
  const percentage = Math.round(normalizeVolume(value) * 100);
  volumeSlider.value = percentage;
  volumeValue.value = `${percentage}%`;
}

function formatNumber(value) {
  const number = Number(value);
  const safeNumber = Number.isFinite(number) ? Math.max(0, number) : 0;
  return new Intl.NumberFormat("en-US").format(Math.round(safeNumber));
}

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }

  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function updateStats(value) {
  const stats = value && typeof value === "object" ? value : {};
  const words =
    stats.words ?? Math.floor(Math.max(0, Number(stats.characters) || 0) / 5);

  wpmValue.textContent = formatNumber(stats.latestWpm);
  wordValue.textContent = formatNumber(words);
  statsDate.textContent = formatDate(stats.date);
}

function saveSetting(setting, value) {
  chrome.storage.local.set({ [setting]: value }, () => {
    if (chrome.runtime.lastError) {
      setMessage("Could not save that setting.");
    }
  });
}

function previewVolume() {
  if (!enabledToggle.checked || Number(volumeSlider.value) === 0) {
    return;
  }

  if (!previewAudio) {
    previewAudio = new Audio(chrome.runtime.getURL("sounds/key.mp3"));
  }

  previewAudio.pause();
  previewAudio.currentTime = 0;
  previewAudio.volume = normalizeVolume(Number(volumeSlider.value) / 100);
  previewAudio.play().catch(() => {});
}

function requestStats() {
  chrome.runtime.sendMessage({ type: "GET_STATS" }, (response) => {
    if (chrome.runtime.lastError) {
      setMessage("Stats are temporarily unavailable.");
      return;
    }

    if (response?.success) {
      updateStats(response.stats);
    }
  });
}

version.textContent = `v${chrome.runtime.getManifest().version}`;

chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
  if (chrome.runtime.lastError) {
    setMessage("Settings are temporarily unavailable.");
    return;
  }

  updateSoundState(settings.enabled !== false);
  updateVolume(settings.volume);
  overlayToggle.checked = settings.showWpmOverlay === true;
});

enabledToggle.addEventListener("change", () => {
  updateSoundState(enabledToggle.checked);
  saveSetting("enabled", enabledToggle.checked);
});

overlayToggle.addEventListener("change", () => {
  saveSetting("showWpmOverlay", overlayToggle.checked);
});

volumeSlider.addEventListener("input", () => {
  volumeValue.value = `${volumeSlider.value}%`;
});

volumeSlider.addEventListener("change", () => {
  saveSetting("volume", Number(volumeSlider.value) / 100);
  previewVolume();
});

resetStatsButton.addEventListener("click", () => {
  resetStatsButton.disabled = true;
  resetStatsButton.textContent = "Resetting";

  chrome.runtime.sendMessage({ type: "RESET_STATS" }, (response) => {
    resetStatsButton.disabled = false;
    resetStatsButton.textContent = "Reset";

    if (chrome.runtime.lastError || !response?.success) {
      setMessage("Could not reset today's stats.");
      return;
    }

    updateStats(response.stats);
    setMessage("Today's stats were reset.");
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.typingStats?.newValue) {
    updateStats(changes.typingStats.newValue);
  }

  if (changes.enabled) {
    updateSoundState(changes.enabled.newValue !== false);
  }

  if (changes.volume) {
    updateVolume(changes.volume.newValue);
  }

  if (changes.showWpmOverlay) {
    overlayToggle.checked = changes.showWpmOverlay.newValue === true;
  }
});

requestStats();
