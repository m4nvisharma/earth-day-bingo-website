const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const leaderboardBody = document.getElementById("leaderboardBody");
const leaderboardMessage = document.getElementById("leaderboardMessage");
const refreshLeaderboard = document.getElementById("refreshLeaderboard");
let avatarCatalog = null;

function applyThemePreference(theme, options = {}) {
  const mode = typeof window.normalizeTheme === "function"
    ? window.normalizeTheme(theme)
    : (theme === "dark" || theme === "love" ? theme : "light");
  if (typeof window.applyTheme === "function") {
    window.applyTheme(mode, options);
    return mode;
  }
  document.body.classList.remove("theme-dark", "theme-love");
  if (mode !== "light") {
    document.body.classList.add(`theme-${mode}`);
  }
  if (options.persist !== false) {
    localStorage.setItem("theme", mode);
  }
  return mode;
}

function normalizeAvatarData(data) {
  if (!data || !Array.isArray(data.bases)) {
    return { bases: [] };
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

  return { ...data, bases };
}

async function loadAvatarCatalog() {
  if (window.AVATAR_CATALOG && typeof window.AVATAR_CATALOG === "object") {
    return normalizeAvatarData(window.AVATAR_CATALOG);
  }

  const response = await fetch("content/avatars.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load avatars");
  }
  const raw = await response.json();
  return normalizeAvatarData(raw);
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

function renderLeaderboard(users, currentUserId) {
  if (!leaderboardBody) return;
  leaderboardBody.innerHTML = "";

  users.forEach((user, index) => {
    const row = document.createElement("tr");

    const rankCell = document.createElement("td");
    rankCell.textContent = String(index + 1);

    const userCell = document.createElement("td");
    const userWrap = document.createElement("div");
    userWrap.className = "leaderboard-user";

    const baseEntry = resolveBase(avatarCatalog?.bases || [], user.avatarBase);

    if (baseEntry) {
      const avatar = document.createElement("div");
      avatar.className = "leaderboard-avatar";
      const baseLayer = createAvatarLayer(baseEntry, 42, "avatar-layer");
      if (baseLayer) avatar.appendChild(baseLayer);

      userWrap.appendChild(avatar);
    }

    const nameSpan = document.createElement("span");
    nameSpan.textContent = user.username || "Player";
    userWrap.appendChild(nameSpan);
    userCell.appendChild(userWrap);

    const linesCell = document.createElement("td");
    linesCell.textContent = String(user.linesCompleted);

    const tilesCell = document.createElement("td");
    tilesCell.textContent = String(user.tilesCompleted);

    row.append(rankCell, userCell, linesCell, tilesCell);
    if (user.id === currentUserId) {
      row.classList.add("current-user");
    }
    leaderboardBody.appendChild(row);
  });
}

async function loadLeaderboard() {
  setMessage("");
  const me = await apiFetch("/api/user/me");
  const storedTheme = localStorage.getItem("theme");
  const hasStoredTheme = storedTheme === "dark" || storedTheme === "light" || storedTheme === "love";
  if (!hasStoredTheme && me?.themePreference) {
    applyThemePreference(me.themePreference);
  }
  if (!avatarCatalog) {
    avatarCatalog = await loadAvatarCatalog();
  }
  const data = await apiFetch("/api/leaderboard");
  const users = data.users || [];
  const normalized = users.map((user) => ({
    ...user,
    avatarBase: user.avatarBase ? user.avatarBase : null
  }));
  renderLeaderboard(normalized, data.currentUserId);
}

refreshLeaderboard?.addEventListener("click", () => {
  loadLeaderboard().catch((error) => setMessage(error.message));
});

loadLeaderboard().catch((error) => setMessage(error.message));
