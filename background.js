const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.3,
};

const EMPTY_STATS = {
  date: "",
  keystrokes: 0,
  characters: 0,
  latestWpm: 0,
};

let statsUpdateQueue = Promise.resolve();

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizeVolume(value) {
  const volume = Number(value);

  if (!Number.isFinite(volume)) {
    return DEFAULT_SETTINGS.volume;
  }

  return Math.min(1, Math.max(0, volume));
}

function normalizeStats(value) {
  const stats = value && typeof value === "object" ? value : {};
  const today = getToday();

  if (stats.date !== today) {
    return {
      ...EMPTY_STATS,
      date: today,
    };
  }

  return {
    date: today,
    keystrokes: Math.floor(toNonNegativeNumber(stats.keystrokes)),
    characters: Math.floor(toNonNegativeNumber(stats.characters)),
    latestWpm: Math.round(toNonNegativeNumber(stats.latestWpm)),
  };
}

async function getStats() {
  const result = await chrome.storage.local.get({
    typingStats: EMPTY_STATS,
  });

  const stats = normalizeStats(result.typingStats);

  if (
    !result.typingStats ||
    result.typingStats.date !== stats.date ||
    JSON.stringify(result.typingStats) !== JSON.stringify(stats)
  ) {
    await chrome.storage.local.set({
      typingStats: stats,
    });
  }

  return stats;
}

async function recordTyping(data) {
  const stats = await getStats();

  stats.keystrokes += Math.floor(toNonNegativeNumber(data.keystrokes));
  stats.characters += Math.floor(toNonNegativeNumber(data.characters));
  stats.latestWpm = Math.round(toNonNegativeNumber(data.wpm));

  await chrome.storage.local.set({
    typingStats: stats,
  });

  return stats;
}

async function resetStats() {
  const stats = {
    ...EMPTY_STATS,
    date: getToday(),
  };

  await chrome.storage.local.set({
    typingStats: stats,
  });

  return stats;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local
    .get(DEFAULT_SETTINGS)
    .then((savedSettings) =>
      chrome.storage.local.set({
        enabled: savedSettings.enabled !== false,
        volume: normalizeVolume(savedSettings.volume),
      }),
    )
    .then(() => getStats())
    .catch(() => {
      // Storage reads still use the same defaults if initialization fails.
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "GET_STATS") {
    getStats()
      .then((stats) => sendResponse({ success: true, stats }))
      .catch(() => sendResponse({ success: false }));

    return true;
  }

  if (message.type === "RECORD_TYPING") {
    const update = statsUpdateQueue
      .then(() => recordTyping(message.data || {}))
      .then((stats) => {
        sendResponse({ success: true, stats });
      })
      .catch(() => {
        sendResponse({ success: false });
      });

    statsUpdateQueue = update.catch(() => {});

    return true;
  }

  if (message.type === "RESET_STATS") {
    const update = statsUpdateQueue
      .then(() => resetStats())
      .then((stats) => {
        sendResponse({ success: true, stats });
      })
      .catch(() => {
        sendResponse({ success: false });
      });

    statsUpdateQueue = update.catch(() => {});

    return true;
  }

  return false;
});
