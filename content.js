const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.3,
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

let pendingKeystrokes = 0;
let pendingCharacters = 0;
let lastSentWpm = 0;
let statsMessageInFlight = false;

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
  pendingKeystrokes += 1;

  const isCharacter =
    event.key.length === 1 || event.key === "Enter" || event.key === "Tab";

  if (!isCharacter) {
    return;
  }

  pendingCharacters += 1;
  recentCharacterTimes.push(Date.now());
}

function stopExtensionActivity() {
  extensionContextActive = false;
  clearInterval(statsInterval);
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

  if (
    pendingKeystrokes === 0 &&
    pendingCharacters === 0 &&
    currentWpm === lastSentWpm
  ) {
    return;
  }

  const data = {
    keystrokes: pendingKeystrokes,
    characters: pendingCharacters,
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

        pendingKeystrokes = Math.max(0, pendingKeystrokes - data.keystrokes);
        pendingCharacters = Math.max(0, pendingCharacters - data.characters);
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

try {
  chrome.storage.local.get(DEFAULT_SETTINGS, (savedSettings) => {
    if (chrome.runtime.lastError) {
      return;
    }

    settings = {
      enabled: savedSettings.enabled !== false,
      volume: normalizeVolume(savedSettings.volume),
    };
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

    recordTypingEvent(event);

    const soundName = getSoundName(event);
    playSound(soundName);
  },
  true,
);
