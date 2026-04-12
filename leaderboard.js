const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const leaderboardBody = document.getElementById("leaderboardBody");
const leaderboardMessage = document.getElementById("leaderboardMessage");
const refreshLeaderboard = document.getElementById("refreshLeaderboard");
const leaderboardSearch = document.getElementById("leaderboardSearch");
const leaderboardSort = document.getElementById("leaderboardSort");
const leaderboardMineOnly = document.getElementById("leaderboardMineOnly");
const leaderboardAutoRefresh = document.getElementById("leaderboardAutoRefresh");
const leaderboardTotalPlayers = document.getElementById("leaderboardTotalPlayers");
const leaderboardMyRank = document.getElementById("leaderboardMyRank");
const leaderboardMyScore = document.getElementById("leaderboardMyScore");
const leaderboardUpdatedAt = document.getElementById("leaderboardUpdatedAt");

const AUTO_REFRESH_MS = 30 * 1000;

let avatarCatalog = null;
let leaderboardUsers = [];
let currentUserId = null;
let previousRankById = new Map();
let autoRefreshTimer = null;
let isLoadingLeaderboard = false;
let hasAppliedTheme = false;

function applyThemePreference(theme, options = {}) {
  const mode = theme === "dark" ? "dark" : "light";
  if (typeof window.applyTheme === "function") {
    window.applyTheme(mode, options);
    return mode;
  }
  document.body.classList.toggle("theme-dark", mode === "dark");
  if (options.persist !== false) {
    localStorage.setItem("theme", mode);
  }
  return mode;
}

function normalizeAvatarData(data) {
  if (!data || !Array.isArray(data.bases)) {
    return { bases: [], props: data?.props || [] };
  }

  const bases = [];
  data.bases.forEach((base) => {
    const sheet = base.spriteSheet;
    if (!sheet) {
      bases.push(base);
      return;
    }

    const rows = Math.max(1, Number(sheet.rows) || 1);
    const cols = Math.max(1, Number(sheet.cols) || 1);
    const sheetWidth = Number(sheet.sheetWidth) || 0;
    const sheetHeight = Number(sheet.sheetHeight) || 0;
    if (!sheetWidth || !sheetHeight) {
      bases.push(base);
      return;
    }

    const tileWidth = sheetWidth / cols;
    const tileHeight = sheetHeight / rows;
    const prefix = sheet.labelPrefix || base.label || base.id;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col + 1;
        bases.push({
          id: `${base.id}-${index}`,
          label: `${prefix} ${index}`,
          src: base.src,
          spriteParentId: base.id,
          sprite: {
            sheetWidth,
            sheetHeight,
            x: col * tileWidth,
            y: row * tileHeight,
            width: tileWidth,
            height: tileHeight
          }
        });
      }
    }
  });

  return { ...data, bases, props: data.props || [] };
}

function resolveBase(bases, baseId) {
  if (!baseId) return null;
  return bases.find((base) => base.id === baseId)
    || bases.find((base) => base.spriteParentId === baseId)
    || null;
}

function createAvatarLayer(item, size, className) {
  if (!item) return null;

  if (item.sprite) {
    const layer = document.createElement("span");
    layer.className = `${className || ""} avatar-sprite`.trim();
    layer.setAttribute("role", "img");
    layer.setAttribute("aria-label", item.label || "");
    layer.style.backgroundImage = `url(${item.src})`;

    const scaleX = size / item.sprite.width;
    const scaleY = size / item.sprite.height;
    layer.style.backgroundSize = `${item.sprite.sheetWidth * scaleX}px ${item.sprite.sheetHeight * scaleY}px`;
    layer.style.backgroundPosition = `${-item.sprite.x * scaleX}px ${-item.sprite.y * scaleY}px`;

    return layer;
  }

  const img = document.createElement("img");
  img.src = item.src;
  img.alt = item.label || "";
  if (className) img.className = className;
  return img;
}

function setMessage(text) {
  if (!leaderboardMessage) return;
  leaderboardMessage.textContent = text;
}

function updateTimestamp() {
  if (!leaderboardUpdatedAt) return;
  const now = new Date();
  leaderboardUpdatedAt.textContent = `Updated ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

async function apiFetch(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function getTrendDisplay(user) {
  if (typeof user.movement !== "number") {
    return { text: "new", trend: "new" };
  }
  if (user.movement > 0) {
    return { text: `+${user.movement}`, trend: "up" };
  }
  if (user.movement < 0) {
    return { text: String(user.movement), trend: "down" };
  }
  return { text: "0", trend: "flat" };
}

function getSortedUsers(users) {
  const sortMode = leaderboardSort?.value || "rank";
  const sorted = [...users];

  if (sortMode === "name") {
    sorted.sort((a, b) => (a.username || "").localeCompare((b.username || ""), undefined, { sensitivity: "base" }));
    return sorted;
  }

  if (sortMode === "lines") {
    sorted.sort((a, b) => {
      if (b.linesCompleted !== a.linesCompleted) return b.linesCompleted - a.linesCompleted;
      if (b.tilesCompleted !== a.tilesCompleted) return b.tilesCompleted - a.tilesCompleted;
      return (a.username || "").localeCompare((b.username || ""), undefined, { sensitivity: "base" });
    });
    return sorted;
  }

  if (sortMode === "tiles") {
    sorted.sort((a, b) => {
      if (b.tilesCompleted !== a.tilesCompleted) return b.tilesCompleted - a.tilesCompleted;
      if (b.linesCompleted !== a.linesCompleted) return b.linesCompleted - a.linesCompleted;
      return (a.username || "").localeCompare((b.username || ""), undefined, { sensitivity: "base" });
    });
    return sorted;
  }

  sorted.sort((a, b) => (a.serverRank || 0) - (b.serverRank || 0));
  return sorted;
}

function getVisibleUsers() {
  const query = normalizeText(leaderboardSearch?.value);
  const mineOnly = Boolean(leaderboardMineOnly?.checked);

  const filtered = leaderboardUsers.filter((user) => {
    if (mineOnly && user.id !== currentUserId) return false;
    if (!query) return true;
    return normalizeText(user.username).includes(query);
  });

  return getSortedUsers(filtered);
}

function updateSummaryCards() {
  if (leaderboardTotalPlayers) {
    leaderboardTotalPlayers.textContent = String(leaderboardUsers.length);
  }

  const me = leaderboardUsers.find((user) => user.id === currentUserId);
  if (leaderboardMyRank) {
    leaderboardMyRank.textContent = me ? `#${me.serverRank}` : "-";
  }
  if (leaderboardMyScore) {
    leaderboardMyScore.textContent = me ? `${me.linesCompleted} lines / ${me.tilesCompleted} tiles` : "-";
  }
}

function renderLeaderboard(users) {
  if (!leaderboardBody) return;
  leaderboardBody.innerHTML = "";

  if (users.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 5;
    emptyCell.textContent = "No participants match your filters.";
    emptyRow.appendChild(emptyCell);
    leaderboardBody.appendChild(emptyRow);
    return;
  }

  const sortMode = leaderboardSort?.value || "rank";

  users.forEach((user, index) => {
    const row = document.createElement("tr");

    const rankCell = document.createElement("td");
    rankCell.textContent = String(sortMode === "rank" ? user.serverRank : index + 1);

    const userCell = document.createElement("td");
    const userWrap = document.createElement("div");
    userWrap.className = "leaderboard-user";

    const baseEntry = resolveBase(avatarCatalog?.bases || [], user.avatarBase);
    const overlayId = Array.isArray(user.avatarProps) ? user.avatarProps[0] : null;
    const overlayEntry = overlayId
      ? avatarCatalog?.props?.find((prop) => prop.id === overlayId)
      : null;

    if (baseEntry) {
      const avatar = document.createElement("div");
      avatar.className = "leaderboard-avatar";
      const baseLayer = createAvatarLayer(baseEntry, 42, "avatar-layer");
      if (baseLayer) avatar.appendChild(baseLayer);

      if (overlayEntry) {
        const overlayImg = document.createElement("img");
        overlayImg.src = overlayEntry.src;
        overlayImg.alt = "";
        overlayImg.className = "prop-layer";
        avatar.appendChild(overlayImg);
      }

      userWrap.appendChild(avatar);
    }

    const nameSpan = document.createElement("span");
    nameSpan.textContent = user.username || "Player";
    userWrap.appendChild(nameSpan);
    userCell.appendChild(userWrap);

    const trendCell = document.createElement("td");
    trendCell.className = "leaderboard-trend";
    const trend = getTrendDisplay(user);
    trendCell.textContent = trend.text;
    trendCell.dataset.trend = trend.trend;

    const linesCell = document.createElement("td");
    linesCell.textContent = String(user.linesCompleted);

    const tilesCell = document.createElement("td");
    tilesCell.textContent = String(user.tilesCompleted);

    row.append(rankCell, userCell, trendCell, linesCell, tilesCell);
    if (user.id === currentUserId) {
      row.classList.add("current-user");
    }
    leaderboardBody.appendChild(row);
  });
}

function applyLeaderboardView({ announce = true } = {}) {
  const visibleUsers = getVisibleUsers();
  renderLeaderboard(visibleUsers);
  updateSummaryCards();

  if (!announce) return;

  if (!leaderboardUsers.length) {
    setMessage("No leaderboard entries yet.");
    return;
  }

  if (visibleUsers.length !== leaderboardUsers.length) {
    setMessage(`Showing ${visibleUsers.length} of ${leaderboardUsers.length} participants.`);
    return;
  }

  setMessage(`Showing ${leaderboardUsers.length} participants.`);
}

function resetAutoRefreshTimer() {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
  }

  if (!leaderboardAutoRefresh?.checked) {
    autoRefreshTimer = null;
    return;
  }

  autoRefreshTimer = window.setInterval(() => {
    loadLeaderboard({ silent: true }).catch(() => {});
  }, AUTO_REFRESH_MS);
}

async function loadLeaderboard({ silent = false } = {}) {
  if (isLoadingLeaderboard) return;
  isLoadingLeaderboard = true;
  if (refreshLeaderboard) {
    refreshLeaderboard.disabled = true;
  }
  if (!silent) {
    setMessage("Refreshing leaderboard...");
  }

  try {
    const me = await apiFetch("/api/user/me");
    if (!hasAppliedTheme) {
      const storedTheme = localStorage.getItem("theme");
      const hasStoredTheme = storedTheme === "dark" || storedTheme === "light";
      if (!hasStoredTheme && me?.themePreference) {
        applyThemePreference(me.themePreference);
      }
      hasAppliedTheme = true;
    }

    if (!avatarCatalog) {
      const raw = await (await fetch("content/avatars.json")).json();
      avatarCatalog = normalizeAvatarData(raw);
    }

    const data = await apiFetch("/api/leaderboard");
    currentUserId = data.currentUserId || me?.id || null;
    const users = Array.isArray(data.users) ? data.users : [];

    leaderboardUsers = users.map((user, index) => {
      const serverRank = index + 1;
      const previousRank = previousRankById.get(user.id);
      return {
        ...user,
        avatarBase: user.avatarBase || null,
        avatarProps: Array.isArray(user.avatarProps) ? user.avatarProps : [],
        serverRank,
        movement: typeof previousRank === "number" ? previousRank - serverRank : null
      };
    });

    previousRankById = new Map(leaderboardUsers.map((user) => [user.id, user.serverRank]));
    updateTimestamp();
    applyLeaderboardView({ announce: !silent });
  } catch (error) {
    setMessage(error.message);
  } finally {
    isLoadingLeaderboard = false;
    if (refreshLeaderboard) {
      refreshLeaderboard.disabled = false;
    }
  }
}

refreshLeaderboard?.addEventListener("click", () => {
  loadLeaderboard().catch((error) => setMessage(error.message));
});

leaderboardSearch?.addEventListener("input", () => {
  applyLeaderboardView({ announce: true });
});

leaderboardSort?.addEventListener("change", () => {
  applyLeaderboardView({ announce: true });
});

leaderboardMineOnly?.addEventListener("change", () => {
  applyLeaderboardView({ announce: true });
});

leaderboardAutoRefresh?.addEventListener("change", () => {
  resetAutoRefreshTimer();
  setMessage(leaderboardAutoRefresh.checked ? "Auto refresh enabled." : "Auto refresh paused.");
});

window.addEventListener("beforeunload", () => {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
  }
});

resetAutoRefreshTimer();
loadLeaderboard().catch((error) => setMessage(error.message));
