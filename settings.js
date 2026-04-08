const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const avatarPreview = document.getElementById("avatarPreview");
const avatarBases = document.getElementById("avatarBases");
const avatarProps = document.getElementById("avatarProps");
const toggleMoreAvatars = document.getElementById("toggleMoreAvatars");
const darkModeToggle = document.getElementById("darkModeToggle");
const saveSettings = document.getElementById("saveSettings");
const deleteAccount = document.getElementById("deleteAccount");
const settingsMessage = document.getElementById("settingsMessage");

const BASES_COLLAPSED_COUNT = 12;

let avatarData = null;
let selectedBase = null;
let selectedOverlay = null;
let showAllBases = false;

function setMessage(text) {
  if (settingsMessage) settingsMessage.textContent = text;
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
  const mode = theme === "dark" ? "dark" : "light";
  if (typeof window.applyTheme === "function") {
    window.applyTheme(mode, options);
  } else {
    document.body.classList.toggle("theme-dark", mode === "dark");
    if (options.persist !== false) {
      localStorage.setItem("theme", mode);
    }
  }
  if (darkModeToggle) {
    darkModeToggle.checked = mode === "dark";
  }
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

  if (selectedOverlay) {
    const prop = avatarData.props.find((item) => item.id === selectedOverlay);
    if (prop) {
      const propImg = document.createElement("img");
      propImg.src = prop.src;
      propImg.alt = prop.label;
      propImg.className = "avatar-layer prop-layer";
      frame.appendChild(propImg);
    }
  }

  avatarPreview.appendChild(frame);
}

function renderOptions(container, items, selectionType) {
  if (!container) return;
  container.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-option";
    button.dataset.id = item.id;

    const thumb = createAvatarLayer(item, 64, "avatar-thumb");
    const label = document.createElement("span");
    label.textContent = item.label;

    if (thumb) button.appendChild(thumb);
    button.appendChild(label);

    button.addEventListener("click", () => {
      if (selectionType === "base") {
        selectedBase = selectedBase?.id === item.id ? null : item;
      } else {
        selectedOverlay = selectedOverlay === item.id ? null : item.id;
      }
      updateSelectedStates();
      renderPreview();
    });

    container.appendChild(button);
  });

  updateSelectedStates();
}

function renderBaseOptions() {
  renderOptions(avatarBases, getVisibleBases(), "base");
  updateMoreAvatarsToggle();
}

function updateSelectedStates() {
  if (!avatarData) return;
  document.querySelectorAll(".avatar-option").forEach((option) => {
    const id = option.dataset.id;
    const isBase = avatarData?.bases?.some((base) => base.id === id);
    const selected = isBase ? selectedBase?.id === id : selectedOverlay === id;
    option.classList.toggle("selected", selected);
  });
}

async function loadSettings() {
  const rawAvatarData = await (await fetch("content/avatars.json")).json();
  avatarData = normalizeAvatarData(rawAvatarData);
  avatarData.bases = sortAvatarBasesByName(avatarData.bases || []);
  const profile = await apiFetch("/api/user/profile");

  selectedBase = resolveBase(avatarData.bases, profile.avatarBase) || avatarData.bases[0] || null;
  const overlayCandidate = Array.isArray(profile.avatarProps) ? profile.avatarProps[0] : null;
  selectedOverlay = avatarData.props.find((prop) => prop.id === overlayCandidate)?.id || null;

  renderBaseOptions();
  renderOptions(avatarProps, avatarData.props, "overlay");
  renderPreview();

  const storedTheme = localStorage.getItem("theme");
  const hasStoredTheme = storedTheme === "dark" || storedTheme === "light";
  const themePreference = hasStoredTheme ? storedTheme : profile.themePreference;
  applyThemePreference(themePreference, { persist: !hasStoredTheme });
}

saveSettings?.addEventListener("click", async () => {
  setMessage("");
  try {
    const themePreference = darkModeToggle?.checked ? "dark" : "light";
    const payload = {
      avatarBase: selectedBase?.id || null,
      avatarProps: selectedOverlay ? [selectedOverlay] : [],
      themePreference
    };

    await apiFetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    applyThemePreference(themePreference);
    setMessage("Settings saved.");
  } catch (error) {
    setMessage(error.message);
  }
});

if (darkModeToggle) {
  darkModeToggle.addEventListener("change", () => {
    applyThemePreference(darkModeToggle.checked ? "dark" : "light");
  });
}

if (toggleMoreAvatars) {
  toggleMoreAvatars.addEventListener("click", () => {
    showAllBases = !showAllBases;
    renderBaseOptions();
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
      localStorage.removeItem("token");
      localStorage.removeItem("displayName");
      localStorage.removeItem("username");
      localStorage.removeItem("userEmail");
      localStorage.removeItem("theme");
      window.location.href = "index.html";
    } catch (error) {
      setMessage(error.message);
    }
  });
}

loadSettings().catch((error) => setMessage(error.message));
