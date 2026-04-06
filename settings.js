const API_BASE = window.API_BASE || "https://your-backend.onrender.com";

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Ignore storage failures.
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    // Ignore storage failures.
  }
}

const token = safeGetItem("token");
if (!token) {
  window.location.href = "index.html";
}

const settingsMessage = document.getElementById("settingsMessage");
const saveSettings = document.getElementById("saveSettings");
const themeSelect = document.getElementById("themeSelect");
const avatarPreview = document.getElementById("avatarPreview");
const avatarGrid = document.getElementById("avatarGrid");
const toggleAvatars = document.getElementById("toggleAvatars");
const accountMeta = document.getElementById("accountMeta");
const usernameInput = document.getElementById("usernameInput");
const updateUsername = document.getElementById("updateUsername");
const logoutBtn = document.getElementById("logoutBtn");
const deleteAccount = document.getElementById("deleteAccount");

const MAX_VISIBLE_AVATARS = 24;
const SUPPORTED_THEMES = new Set(["light", "dark", "love"]);

let avatarData = null;
let selectedBase = null;
let selectedTheme = "light";
let showAllAvatars = false;
let isReady = false;

function setMessage(text) {
  if (!settingsMessage) return;
  settingsMessage.textContent = text;
}

function normalizeThemePreference(value) {
  if (typeof window.normalizeTheme === "function") {
    return window.normalizeTheme(value);
  }
  return SUPPORTED_THEMES.has(value) ? value : "light";
}

function applyThemePreference(theme, options = {}) {
  const mode = normalizeThemePreference(theme);
  if (typeof window.applyTheme === "function") {
    window.applyTheme(mode, options);
  } else {
    document.body.classList.remove("theme-dark", "theme-love");
    if (mode !== "light") {
      document.body.classList.add(`theme-${mode}`);
    }
    if (options.persist !== false) {
      safeSetItem("theme", mode);
    }
  }
  selectedTheme = mode;
  return mode;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
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

function resolveBase(bases, baseId) {
  if (!baseId) return null;
  return bases.find((base) => base.id === baseId)
    || bases.find((base) => base.spriteParentId === baseId)
    || null;
}

function getAvatarFileName(src) {
  if (typeof src !== "string") return "";
  const segments = src.split("/");
  const fileName = segments[segments.length - 1] || "";
  return decodeURIComponent(fileName).toLowerCase();
}

function sortAvatarBasesByName(bases) {
  return [...bases].sort((a, b) => getAvatarFileName(a.src).localeCompare(getAvatarFileName(b.src), undefined, {
    numeric: true,
    sensitivity: "base"
  }));
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

function renderPreview() {
  if (!avatarPreview) return;
  avatarPreview.innerHTML = "";
  if (!selectedBase) return;

  const frame = document.createElement("div");
  frame.className = "avatar-frame";
  const baseLayer = createAvatarLayer(selectedBase, 120, "avatar-layer");
  if (baseLayer) frame.appendChild(baseLayer);
  avatarPreview.appendChild(frame);
}

function getVisibleBases() {
  if (!avatarData?.bases?.length) return [];
  return showAllAvatars ? avatarData.bases : avatarData.bases.slice(0, MAX_VISIBLE_AVATARS);
}

function renderAvatarGrid() {
  if (!avatarGrid) return;
  avatarGrid.innerHTML = "";
  const visibleBases = getVisibleBases();

  visibleBases.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-choice";
    button.dataset.id = item.id;
    button.setAttribute("aria-pressed", selectedBase?.id === item.id ? "true" : "false");
    button.setAttribute("aria-label", item.label || "Avatar option");
    button.title = item.label || "Avatar option";

    const thumb = createAvatarLayer(item, 64, "avatar-thumb");
    if (thumb) button.appendChild(thumb);

    if (selectedBase?.id === item.id) {
      button.classList.add("selected");
    }

    avatarGrid.appendChild(button);
  });

  if (toggleAvatars) {
    const hasOverflow = (avatarData?.bases?.length || 0) > MAX_VISIBLE_AVATARS;
    toggleAvatars.hidden = !hasOverflow;
    toggleAvatars.textContent = showAllAvatars ? "Show fewer avatars" : "Show all avatars";
  }
}

function selectAvatarById(baseId) {
  if (!avatarData?.bases?.length || !baseId) return;
  const next = resolveBase(avatarData.bases, baseId);
  if (!next) return;
  selectedBase = next;
  renderAvatarGrid();
  renderPreview();
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function isValidUsername(value) {
  return /^[a-zA-Z0-9]{4,}$/.test(value);
}

async function saveProfile({ includeUsername, successMessage }) {
  if (!selectedBase && avatarData?.bases?.length) {
    selectedBase = avatarData.bases[0];
  }

  const payload = {
    avatarBase: selectedBase?.id || null,
    avatarProps: [],
    themePreference: selectedTheme
  };

  if (includeUsername) {
    const candidate = normalizeUsername(usernameInput?.value);
    if (candidate) {
      if (!isValidUsername(candidate)) {
        setMessage("Username must be at least 4 characters and contain only letters and numbers.");
        return false;
      }
      payload.username = candidate;
    }
  }

  try {
    await apiFetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (payload.username) {
      safeSetItem("username", payload.username);
    }

    if (successMessage) {
      setMessage(successMessage);
    }
    return true;
  } catch (error) {
    setMessage(error.message);
    return false;
  }
}

async function loadSettings() {
  let profile = null;
  let me = null;

  try {
    profile = await apiFetch("/api/user/profile");
  } catch (error) {
    setMessage(error.message);
  }

  try {
    me = await apiFetch("/api/user/me");
  } catch (error) {
    if (!settingsMessage?.textContent) {
      setMessage(error.message);
    }
  }

  const storedTheme = safeGetItem("theme");
  selectedTheme = normalizeThemePreference(storedTheme || profile?.themePreference || "light");
  applyThemePreference(selectedTheme, { persist: !storedTheme });
  if (themeSelect) {
    themeSelect.value = selectedTheme;
  }

  if (accountMeta) {
    const email = me?.email || safeGetItem("userEmail") || "";
    accountMeta.textContent = email ? `Signed in as ${email}` : "Signed in";
  }

  if (usernameInput) {
    usernameInput.value = profile?.username || "";
  }

  if (profile?.username) {
    safeSetItem("username", profile.username);
  }

  try {
    const avatarResponse = await fetch("content/avatars.json");
    if (!avatarResponse.ok) {
      throw new Error("Unable to load avatars");
    }
    const rawAvatarData = await avatarResponse.json();
    avatarData = normalizeAvatarData(rawAvatarData);
    avatarData.bases = sortAvatarBasesByName(avatarData.bases || []);
    selectedBase = resolveBase(avatarData.bases, profile?.avatarBase) || avatarData.bases[0] || null;
    renderAvatarGrid();
    renderPreview();
  } catch (error) {
    if (!settingsMessage?.textContent) {
      setMessage(error.message);
    }
  }

  isReady = true;
}

if (themeSelect) {
  themeSelect.addEventListener("change", () => {
    selectedTheme = normalizeThemePreference(themeSelect.value);
    applyThemePreference(selectedTheme, { persist: true });
    if (isReady && selectedBase) {
      saveProfile({ includeUsername: false, successMessage: "Theme updated." });
    }
  });
}

if (avatarGrid) {
  avatarGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".avatar-choice");
    if (!button || !avatarGrid.contains(button)) return;
    selectAvatarById(button.dataset.id);
  });
}

if (toggleAvatars) {
  toggleAvatars.addEventListener("click", () => {
    showAllAvatars = !showAllAvatars;
    renderAvatarGrid();
  });
}

if (saveSettings) {
  saveSettings.addEventListener("click", () => {
    saveProfile({ includeUsername: true, successMessage: "Settings saved." });
  });
}

if (updateUsername) {
  updateUsername.addEventListener("click", () => {
    saveProfile({ includeUsername: true, successMessage: "Username updated." });
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    safeRemoveItem("token");
    safeRemoveItem("displayName");
    safeRemoveItem("username");
    safeRemoveItem("userEmail");
    window.location.href = "index.html";
  });
}

if (deleteAccount) {
  deleteAccount.addEventListener("click", async () => {
    const confirmation = window.prompt("Type DELETE to permanently remove your account.");
    if (confirmation !== "DELETE") {
      setMessage("Account deletion cancelled.");
      return;
    }

    try {
      await apiFetch("/api/user", { method: "DELETE" });
      safeRemoveItem("token");
      safeRemoveItem("displayName");
      safeRemoveItem("username");
      safeRemoveItem("userEmail");
      safeRemoveItem("theme");
      window.location.href = "index.html";
    } catch (error) {
      setMessage(error.message);
    }
  });
}

loadSettings().catch((error) => setMessage(error.message));