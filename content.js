const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.3,
  showWpmOverlay: false,
  excludedSites: [],
};

let settings = { ...DEFAULT_SETTINGS };
let extensionContextActive = true;

const soundPaths = {
  key: "sounds/key.mp3",
  space: "sounds/space.mp3",
  enter: "sounds/enter.mp3",
  backspace: "sounds/backspace.mp3",
};

const TEXT_INPUT_TYPES = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

const POOL_SIZE = 8;
const soundPools = {};
const poolIndexes = {};

for (const [soundName, soundPath] of Object.entries(soundPaths)) {
  soundPools[soundName] = Array.from({ length: POOL_SIZE }, () => {
    const audio = new Audio(chrome.runtime.getURL(soundPath));
    audio.preload = "auto";
    return audio;
  });

  poolIndexes[soundName] = 0;
}

// Typing statistics

const recentCharacterTimes = [];

let pendingCharacters = 0;
let pendingWords = 0;
let lastSentWpm = 0;
let statsMessageInFlight = false;
let hasOpenWord = false;
let wpmOverlayHost = null;
let wpmOverlayValue = null;

function removeOldCharacterTimes() {
  const oneMinuteAgo = Date.now() - 60_000;

  while (
    recentCharacterTimes.length > 0 &&
    recentCharacterTimes[0] < oneMinuteAgo
  ) {
    recentCharacterTimes.shift();
  }
}

function calculateWpm() {
  removeOldCharacterTimes();

  if (recentCharacterTimes.length === 0) {
    return 0;
  }

  const elapsedTime = Math.min(
    60_000,
    Math.max(5_000, Date.now() - recentCharacterTimes[0]),
  );
  const words = recentCharacterTimes.length / 5;

  return Math.round(words / (elapsedTime / 60_000));
}

function recordTypingEvent(event) {
  const isCharacter =
    event.key.length === 1 || event.key === "Enter" || event.key === "Tab";

  if (!isCharacter) {
    return;
  }

  pendingCharacters += 1;
  recentCharacterTimes.push(Date.now());

  const isWordBoundary =
    event.key === " " || event.key === "Enter" || event.key === "Tab";

  if (isWordBoundary) {
    if (hasOpenWord) {
      pendingWords += 1;
      hasOpenWord = false;
    }
  } else {
    hasOpenWord = true;
  }

  updateWpmOverlay(calculateWpm());
}

function stopExtensionActivity() {
  extensionContextActive = false;
  clearInterval(statsInterval);
  removeWpmOverlay();
}

function createWpmOverlay() {
  if (wpmOverlayHost || !document.documentElement) {
    return;
  }

  wpmOverlayHost = document.createElement("div");
  wpmOverlayHost.id = "klakeys-wpm-overlay";

  const shadowRoot = wpmOverlayHost.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      pointer-events: none;
    }

    .counter {
      display: flex;
      align-items: baseline;
      gap: 5px;
      padding: 8px 11px;
      color: #ffffff;
      font: 600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: rgba(20, 20, 24, 0.62);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 999px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .label {
      color: rgba(255, 255, 255, 0.72);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
  `;

  const counter = document.createElement("div");
  counter.className = "counter";

  wpmOverlayValue = document.createElement("span");
  wpmOverlayValue.textContent = "0";

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "WPM";

  counter.append(wpmOverlayValue, label);
  shadowRoot.append(style, counter);
  document.documentElement.append(wpmOverlayHost);
}

function removeWpmOverlay() {
  wpmOverlayHost?.remove();
  wpmOverlayHost = null;
  wpmOverlayValue = null;
}

function syncWpmOverlay() {
  if (
    settings.showWpmOverlay &&
    extensionContextActive &&
    !isExcludedSite()
  ) {
    createWpmOverlay();
    updateWpmOverlay(calculateWpm());
    return;
  }

  removeWpmOverlay();
}

function updateWpmOverlay(wpm) {
  if (settings.showWpmOverlay && !wpmOverlayHost) {
    createWpmOverlay();
  }

  if (wpmOverlayValue) {
    wpmOverlayValue.textContent = String(Math.max(0, Math.round(wpm)));
  }
}

function sendStats() {
  if (!extensionContextActive || statsMessageInFlight) {
    return;
  }

  try {
    if (!chrome.runtime?.id) {
      stopExtensionActivity();
      return;
    }
  } catch {
    stopExtensionActivity();
    return;
  }

  const currentWpm = calculateWpm();
  updateWpmOverlay(currentWpm);

  if (
    pendingCharacters === 0 &&
    pendingWords === 0 &&
    currentWpm === lastSentWpm
  ) {
    return;
  }

  const data = {
    characters: pendingCharacters,
    words: pendingWords,
    wpm: currentWpm,
  };

  statsMessageInFlight = true;

  try {
    chrome.runtime.sendMessage(
      {
        type: "RECORD_TYPING",
        data,
      },
      (response) => {
        statsMessageInFlight = false;

        if (chrome.runtime.lastError) {
          if (!chrome.runtime?.id) {
            stopExtensionActivity();
          }
          return;
        }

        if (!response?.success) {
          return;
        }

        pendingCharacters = Math.max(0, pendingCharacters - data.characters);
        pendingWords = Math.max(0, pendingWords - data.words);
        lastSentWpm = currentWpm;
      },
    );
  } catch {
    statsMessageInFlight = false;
    stopExtensionActivity();
  }
}

const statsInterval = setInterval(sendStats, 2000);

// Sound handling

function isTypingTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  if (
    target.matches("input:disabled, textarea:disabled, input[readonly], textarea[readonly]")
  ) {
    return false;
  }

  if (tagName === "input") {
    return TEXT_INPUT_TYPES.has(target.type || "text");
  }

  return (
    tagName === "textarea" ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

function getSoundName(event) {
  if (event.key === " ") {
    return "space";
  }

  if (event.key === "Enter") {
    return "enter";
  }

  if (event.key === "Backspace" || event.key === "Delete") {
    return "backspace";
  }

  if (event.key.length === 1) {
    return "key";
  }

  return null;
}

function playSound(soundName) {
  if (!extensionContextActive || !settings.enabled || !soundName) {
    return;
  }

  const pool = soundPools[soundName];

  if (!pool) {
    return;
  }

  const index = poolIndexes[soundName];
  const audio = pool[index];

  audio.pause();
  audio.currentTime = 0;
  audio.volume = settings.volume;

  audio.play().catch(() => {
    // Some pages may block audio briefly
  });

  poolIndexes[soundName] = (index + 1) % pool.length;
}

function normalizeVolume(volume) {
  const parsedVolume = Number(volume);

  if (!Number.isFinite(parsedVolume)) {
    return DEFAULT_SETTINGS.volume;
  }

  return Math.min(1, Math.max(0, parsedVolume));
}

function normalizeExcludedSites(value) {
  return Array.isArray(value)
    ? value
        .map((site) => String(site).trim().toLowerCase())
        .filter(Boolean)
    : [];
}

function isExcludedSite() {
  const hostname = window.location.hostname.toLowerCase();

  return settings.excludedSites.some(
    (site) => hostname === site || hostname.endsWith(`.${site}`),
  );
}

try {
  chrome.storage.local.get(DEFAULT_SETTINGS, (savedSettings) => {
    if (chrome.runtime.lastError) {
      return;
    }

    settings = {
      enabled: savedSettings.enabled !== false,
      volume: normalizeVolume(savedSettings.volume),
      showWpmOverlay: savedSettings.showWpmOverlay === true,
      excludedSites: normalizeExcludedSites(savedSettings.excludedSites),
    };
    syncWpmOverlay();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.enabled) {
      settings.enabled = changes.enabled.newValue !== false;
    }

    if (changes.volume) {
      settings.volume = normalizeVolume(changes.volume.newValue);
    }

    if (changes.showWpmOverlay) {
      settings.showWpmOverlay = changes.showWpmOverlay.newValue === true;
      syncWpmOverlay();
    }

    if (changes.excludedSites) {
      settings.excludedSites = normalizeExcludedSites(changes.excludedSites.newValue);
      syncWpmOverlay();
    }
  });
} catch {
  stopExtensionActivity();
}

document.addEventListener(
  "keydown",
  (event) => {
    const isShortcut =
      (event.ctrlKey || event.metaKey || event.altKey) &&
      !event.getModifierState?.("AltGraph");

    if (event.repeat || event.isComposing || isShortcut) {
      return;
    }

    if (!isTypingTarget(event.target)) {
      return;
    }

    if (isExcludedSite()) {
      return;
    }

    recordTypingEvent(event);

    const soundName = getSoundName(event);
    playSound(soundName);
  },
  true,
);
