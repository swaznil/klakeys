const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.45
};

let settings = { ...DEFAULT_SETTINGS };

const soundPaths = {
  key: "sounds/key.mp3",
  space: "sounds/space.mp3",
  enter: "sounds/enter.mp3",
  backspace: "sounds/backspace.mp3"
};

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

function playSound(soundName) {
  if (!settings.enabled) {
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
    // Some pages may temporarily block audio playback.
  });

  poolIndexes[soundName] = (index + 1) % pool.length;
}

function getSoundName(event) {
  switch (event.code) {
    case "Space":
      return "space";

    case "Enter":
    case "NumpadEnter":
      return "enter";

    case "Backspace":
    case "Delete":
      return "backspace";

    default:
      return "key";
  }
}

chrome.storage.local.get(DEFAULT_SETTINGS, (savedSettings) => {
  settings = savedSettings;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.enabled) {
    settings.enabled = changes.enabled.newValue;
  }

  if (changes.volume) {
    settings.volume = changes.volume.newValue;
  }
});

document.addEventListener(
  "keydown",
  (event) => {
    if (event.repeat || event.isComposing) {
      return;
    }

    playSound(getSoundName(event));
  },
  true
);