const enabledToggle = document.querySelector("#enabledToggle");
const statusText = document.querySelector("#statusText");

const volumeSlider = document.querySelector("#volumeSlider");
const volumeValue = document.querySelector("#volumeValue");

const wpmValue = document.querySelector("#wpmValue");
const keystrokeValue = document.querySelector("#keystrokeValue");
const wordValue = document.querySelector("#wordValue");
const statsDate = document.querySelector("#statsDate");

const resetStatsButton = document.querySelector("#resetStatsButton");
const version = document.querySelector("#version");

const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.3,
};

function updateStatus(enabled) {
  enabledToggle.checked = enabled;
  statusText.textContent = enabled ? "Enabled" : "Disabled";
  document.body.classList.toggle("is-disabled", !enabled);
}

function updateVolume(volume) {
  const percentage = Math.round(normalizeVolume(volume) * 100);

  volumeSlider.value = percentage;
  volumeValue.textContent = `${percentage}%`;
}

function formatNumber(number) {
  const safeNumber = Number.isFinite(Number(number)) ? Number(number) : 0;
  return new Intl.NumberFormat("en-US").format(Math.max(0, safeNumber));
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

function updateStats(stats) {
  const safeStats = stats && typeof stats === "object" ? stats : {};
  const estimatedWords = Math.floor(
    Math.max(0, Number(safeStats.characters) || 0) / 5,
  );

  wpmValue.textContent = formatNumber(safeStats.latestWpm);
  keystrokeValue.textContent = formatNumber(safeStats.keystrokes);
  wordValue.textContent = formatNumber(estimatedWords);
  statsDate.textContent = formatDate(safeStats.date);
}

function normalizeVolume(volume) {
  const parsedVolume = Number(volume);

  if (!Number.isFinite(parsedVolume)) {
    return DEFAULT_SETTINGS.volume;
  }

  return Math.min(1, Math.max(0, parsedVolume));
}

function requestStats() {
  chrome.runtime.sendMessage(
    {
      type: "GET_STATS",
    },
    (response) => {
      if (chrome.runtime.lastError) {
        return;
      }

      if (response?.success) {
        updateStats(response.stats);
      }
    },
  );
}

chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
  if (chrome.runtime.lastError) {
    return;
  }

  updateStatus(settings.enabled !== false);
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

  chrome.storage.local.set({
    volume,
  });
});

resetStatsButton.addEventListener("click", () => {
  resetStatsButton.disabled = true;

  chrome.runtime.sendMessage(
    {
      type: "RESET_STATS",
    },
    (response) => {
      if (chrome.runtime.lastError) {
        resetStatsButton.disabled = false;
        return;
      }

      if (response?.success) {
        updateStats(response.stats);
      }

      resetStatsButton.disabled = false;
    },
  );
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.typingStats?.newValue) {
    updateStats(changes.typingStats.newValue);
  }
});

requestStats();

version.textContent = `v${chrome.runtime.getManifest().version}`;
