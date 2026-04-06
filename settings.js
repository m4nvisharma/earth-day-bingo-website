const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = getStoredValue("token");

if (!token) {
  window.location.href = "index.html";
}

const avatarPreview = document.getElementById("avatarPreview");
const avatarBases = document.getElementById("avatarBases");
const toggleMoreAvatars = document.getElementById("toggleMoreAvatars");
const themePreferenceSelect = document.getElementById("themePreference");
const saveSettings = document.getElementById("saveSettings");
const deleteAccount = document.getElementById("deleteAccount");
const settingsMessage = document.getElementById("settingsMessage");
const accountMeta = document.getElementById("accountMeta");
const currentUsername = document.getElementById("currentUsername");
const usernameEditor = document.getElementById("usernameEditor");
const usernameInput = document.getElementById("usernameInput");
const applyUsername = document.getElementById("applyUsername");
const cancelUsername = document.getElementById("cancelUsername");
const changeUsernameBtn = document.getElementById("changeUsernameBtn");
const settingsLogoutBtn = document.getElementById("settingsLogoutBtn");

const BASES_COLLAPSED_COUNT = 12;
const SUPPORTED_THEMES = new Set(["light", "dark", "love"]);

let avatarData = null;
let selectedBase = null;
let showAllBases = false;
let selectedTheme = "light";

function setMessage(text) {
  if (settingsMessage) settingsMessage.textContent = text;
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function isValidUsername(value) {
  return /^[a-zA-Z0-9]{4,}$/.test(value);
}

function normalizeThemePreference(value) {
  if (typeof window.normalizeTheme === "function") {
    return window.normalizeTheme(value);
  }
  return SUPPORTED_THEMES.has(value) ? value : "light";
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

function getVisibleBases() {
  if (!avatarData || !Array.isArray(avatarData.bases)) return [];

  if (showAllBases || avatarData.bases.length <= BASES_COLLAPSED_COUNT) {
    return avatarData.bases;
  }

  const visible = avatarData.bases.slice(0, BASES_COLLAPSED_COUNT);
  if (visible.length > 0 && selectedBase && !visible.some((base) => base.id === selectedBase.id)) {
    visible[visible.length - 1] = selectedBase;
  }
  return visible;
}

function updateMoreAvatarsToggle() {
  if (!toggleMoreAvatars) return;

  const hasOverflow = (avatarData?.bases?.length || 0) > BASES_COLLAPSED_COUNT;
  toggleMoreAvatars.hidden = !hasOverflow;
  if (!hasOverflow) return;

  toggleMoreAvatars.textContent = showAllBases ? "Show fewer avatars" : "More avatars";
  toggleMoreAvatars.setAttribute("aria-expanded", showAllBases ? "true" : "false");
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
      setStoredValue("theme", mode);
    }
  }
  if (themePreferenceSelect) {
    themePreferenceSelect.value = mode;
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

function selectAvatarById(baseId) {
  if (!avatarData?.bases?.length || !baseId) return;
  const next = resolveBase(avatarData.bases, baseId);
  if (!next) return;
  selectedBase = next;
  updateSelectedStates();
  renderPreview();
}

function renderOptions(container, items) {
  if (!container) return;
  container.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-option";
    button.dataset.id = item.id;
    button.setAttribute("aria-label", item.label || "Avatar option");
    button.title = item.label || "Avatar option";

    const thumb = createAvatarLayer(item, 64, "avatar-thumb");

    if (thumb) button.appendChild(thumb);

    container.appendChild(button);
  });

  updateSelectedStates();
}

function renderBaseOptions() {
  renderOptions(avatarBases, getVisibleBases());
  updateMoreAvatarsToggle();
}

function updateSelectedStates() {
  if (!avatarData || !Array.isArray(avatarData.bases)) return;
  document.querySelectorAll(".avatar-option").forEach((option) => {
    const id = option.dataset.id;
    const selected = selectedBase?.id === id;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-pressed", selected ? "true" : "false");
  });
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

  try {
    const avatarResponse = await fetch("content/avatars.json");
    if (!avatarResponse.ok) {
      throw new Error("Unable to load avatars");
    }
    const rawAvatarData = await avatarResponse.json();
    avatarData = normalizeAvatarData(rawAvatarData);
    avatarData.bases = sortAvatarBasesByName(avatarData.bases || []);
  } catch (error) {
    if (!settingsMessage?.textContent) {
      setMessage(error.message);
    }
  }

  if (avatarData?.bases?.length) {
    selectedBase = resolveBase(avatarData.bases, profile?.avatarBase) || avatarData.bases[0] || null;
    renderBaseOptions();
    renderPreview();
  }

  const storedTheme = getStoredValue("theme");
  const hasStoredTheme = SUPPORTED_THEMES.has(storedTheme);
  const themePreference = hasStoredTheme ? storedTheme : (profile?.themePreference || "light");
  applyThemePreference(themePreference, { persist: !hasStoredTheme });

  if (accountMeta) {
    const email = me?.email || getStoredValue("userEmail") || "";
    accountMeta.textContent = email ? `Signed in as ${email}` : "Signed in";
  }

  if (profile?.username) {
    setStoredValue("username", profile.username);
  }

  if (currentUsername) {
    const displayUsername = profile?.username || getStoredValue("username") || "Not set";
    currentUsername.textContent = `Current username: ${displayUsername}`;
  }

  if (usernameInput && profile?.username) {
    usernameInput.value = profile.username;
  }
}

saveSettings?.addEventListener("click", async () => {
  setMessage("");
  try {
    const themePreference = normalizeThemePreference(selectedTheme);
    const payload = {
      avatarBase: selectedBase?.id || null,
      avatarProps: [],
      themePreference
    };

    await apiFetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    applyThemePreference(themePreference, { persist: true });
    setMessage("Settings saved.");
  } catch (error) {
    setMessage(error.message);
  }
});

if (themePreferenceSelect) {
  const handleThemeChange = () => {
    selectedTheme = normalizeThemePreference(themePreferenceSelect.value);
    applyThemePreference(selectedTheme, { persist: true });
  };
  themePreferenceSelect.disabled = false;
  themePreferenceSelect.addEventListener("change", handleThemeChange);
  themePreferenceSelect.addEventListener("input", handleThemeChange);
}

if (toggleMoreAvatars) {
  toggleMoreAvatars.addEventListener("click", () => {
    showAllBases = !showAllBases;
    renderBaseOptions();
  });
}

if (avatarBases) {
  avatarBases.addEventListener("click", (event) => {
    const button = event.target.closest(".avatar-option");
    if (!button || !avatarBases.contains(button)) return;
    selectAvatarById(button.dataset.id);
  });
}

if (changeUsernameBtn && usernameEditor && usernameInput) {
  changeUsernameBtn.addEventListener("click", () => {
    const isHidden = usernameEditor.hidden;
    usernameEditor.hidden = !isHidden;
    if (isHidden) {
      const existing = getStoredValue("username") || "";
      usernameInput.value = existing;
      usernameInput.focus();
      setMessage("");
    }
  });
}

if (cancelUsername && usernameEditor) {
  cancelUsername.addEventListener("click", () => {
    usernameEditor.hidden = true;
    setMessage("");
  });
}

if (applyUsername && usernameInput) {
  applyUsername.addEventListener("click", async () => {
    const nextUsername = normalizeUsername(usernameInput.value);
    if (!isValidUsername(nextUsername)) {
      setMessage("Username must be at least 4 characters and contain only letters and numbers.");
      return;
    }

    setMessage("");
    try {
      await apiFetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarBase: selectedBase?.id || null,
          avatarProps: [],
          themePreference: normalizeThemePreference(selectedTheme),
          username: nextUsername
        })
      });

      setStoredValue("username", nextUsername);
      if (currentUsername) {
        currentUsername.textContent = `Current username: ${nextUsername}`;
      }
      if (usernameEditor) {
        usernameEditor.hidden = true;
      }
      setMessage("Username updated.");
    } catch (error) {
      setMessage(error.message);
    }
  });
}

if (settingsLogoutBtn) {
  settingsLogoutBtn.addEventListener("click", () => {
    removeStoredValue("token");
    removeStoredValue("displayName");
    removeStoredValue("username");
    removeStoredValue("userEmail");
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
      removeStoredValue("token");
      removeStoredValue("displayName");
      removeStoredValue("username");
      removeStoredValue("userEmail");
      removeStoredValue("theme");
      window.location.href = "index.html";
    } catch (error) {
      setMessage(error.message);
    }
  });
}

loadSettings().catch((error) => setMessage(error.message));
