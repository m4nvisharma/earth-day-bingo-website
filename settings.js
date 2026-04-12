const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const avatarPreview = document.getElementById("avatarPreview");
const avatarBases = document.getElementById("avatarBases");
const toggleMoreAvatars = document.getElementById("toggleMoreAvatars");
const darkModeToggle = document.getElementById("darkModeToggle");
const saveSettings = document.getElementById("saveSettings");
const logoutButton = document.getElementById("logoutButton");
const deleteAccount = document.getElementById("deleteAccount");
const settingsMessage = document.getElementById("settingsMessage");
const settingsStatus = document.getElementById("settingsStatus");
const adminUserPanel = document.getElementById("adminUserPanel");
const refreshAdminUsers = document.getElementById("refreshAdminUsers");
const adminUsersBody = document.getElementById("adminUsersBody");
const adminUsersMessage = document.getElementById("adminUsersMessage");

const BASES_COLLAPSED_COUNT = 12;
const AUTOSAVE_DELAY_MS = 1400;

let avatarData = null;
let selectedBase = null;
let showAllBases = false;
let isAdmin = false;
let baselineSettings = null;
let settingsReady = false;
let isSavingSettings = false;
let autosaveTimer = null;
let pendingSave = false;

function setMessage(text) {
  if (settingsMessage) settingsMessage.textContent = text;
}

function setAdminMessage(text) {
  if (adminUsersMessage) adminUsersMessage.textContent = text;
}

function setSettingsStatus(text, state) {
  if (!settingsStatus) return;
  settingsStatus.textContent = text;
  if (state) {
    settingsStatus.dataset.state = state;
  } else {
    delete settingsStatus.dataset.state;
  }
}

function clearSessionAndRedirect() {
  window.clearTimeout(autosaveTimer);
  localStorage.removeItem("token");
  localStorage.removeItem("displayName");
  localStorage.removeItem("username");
  localStorage.removeItem("userEmail");
  localStorage.removeItem("theme");
  window.location.href = "index.html";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
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

function buildSettingsPayload() {
  return {
    avatarBase: selectedBase?.id || null,
    avatarProps: [],
    themePreference: darkModeToggle?.checked ? "dark" : "light"
  };
}

function isSamePayload(left, right) {
  if (!left || !right) return false;
  return left.avatarBase === right.avatarBase
    && Array.isArray(left.avatarProps)
    && Array.isArray(right.avatarProps)
    && left.avatarProps.length === 0
    && right.avatarProps.length === 0
    && left.themePreference === right.themePreference;
}

function hasPendingSettingsChanges() {
  if (!settingsReady || !baselineSettings) return false;
  return !isSamePayload(buildSettingsPayload(), baselineSettings);
}

function updateSaveButtonState() {
  if (!saveSettings) return;
  const dirty = hasPendingSettingsChanges();
  saveSettings.disabled = !settingsReady || isSavingSettings || !dirty;
  saveSettings.textContent = isSavingSettings ? "Saving..." : (dirty ? "Save changes" : "Saved");
}

function queueAutosave() {
  if (!settingsReady) return;
  window.clearTimeout(autosaveTimer);
  if (!hasPendingSettingsChanges()) return;
  autosaveTimer = window.setTimeout(() => {
    persistSettings("auto").catch(() => {});
  }, AUTOSAVE_DELAY_MS);
}

function onSettingsChanged() {
  if (!settingsReady) return;
  if (hasPendingSettingsChanges()) {
    setSettingsStatus("Unsaved changes. Autosaving shortly...", "dirty");
    queueAutosave();
  } else {
    window.clearTimeout(autosaveTimer);
    setSettingsStatus("All changes saved.", "saved");
  }
  updateSaveButtonState();
}

async function persistSettings(source = "manual") {
  if (!settingsReady) return false;
  if (isSavingSettings) {
    pendingSave = true;
    return false;
  }

  const payload = buildSettingsPayload();
  if (isSamePayload(payload, baselineSettings)) {
    if (source === "manual") {
      setMessage("No changes to save.");
    }
    setSettingsStatus("All changes saved.", "saved");
    updateSaveButtonState();
    return false;
  }

  isSavingSettings = true;
  setSettingsStatus(source === "auto" ? "Autosaving changes..." : "Saving changes...", "saving");
  if (source === "manual") {
    setMessage("");
  }
  updateSaveButtonState();

  try {
    await apiFetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    baselineSettings = {
      avatarBase: payload.avatarBase,
      avatarProps: [...payload.avatarProps],
      themePreference: payload.themePreference
    };
    applyThemePreference(payload.themePreference);
    setSettingsStatus(source === "auto" ? "Changes autosaved." : "Settings saved.", "saved");
    if (source === "manual") {
      setMessage("Settings saved.");
    }
    return true;
  } catch (error) {
    setSettingsStatus(`Save failed: ${error.message}`, "error");
    setMessage(error.message);
    throw error;
  } finally {
    isSavingSettings = false;
    updateSaveButtonState();
    if (pendingSave) {
      pendingSave = false;
      queueAutosave();
    }
  }
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

function renderOptions(container, items, selectionType) {
  if (!container) return;
  container.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-option";
    button.dataset.id = item.id;
    button.setAttribute("aria-label", item.label || "Avatar option");

    const thumb = createAvatarLayer(item, 64, "avatar-thumb");

    if (thumb) button.appendChild(thumb);

    button.addEventListener("click", () => {
      if (selectionType === "base") {
        selectedBase = selectedBase?.id === item.id ? null : item;
      }
      updateSelectedStates();
      renderPreview();
      onSettingsChanged();
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
    const selected = isBase ? selectedBase?.id === id : false;
    option.classList.toggle("selected", selected);
  });
}

async function loadSettings() {
  settingsReady = false;
  setSettingsStatus("Loading settings...", "saving");
  updateSaveButtonState();

  const rawAvatarData = await (await fetch("content/avatars.json")).json();
  avatarData = normalizeAvatarData(rawAvatarData);
  avatarData.bases = sortAvatarBasesByName(avatarData.bases || []);
  const [profile, me] = await Promise.all([
    apiFetch("/api/user/profile"),
    apiFetch("/api/user/me")
  ]);

  const adminEmail = (window.ADMIN_EMAIL || "info@cycat.ca").toLowerCase();
  isAdmin = (me?.email || "").toLowerCase() === adminEmail;
  if (adminUserPanel) {
    adminUserPanel.hidden = !isAdmin;
  }
  if (isAdmin) {
    await loadAdminUsers();
  }

  selectedBase = resolveBase(avatarData.bases, profile.avatarBase) || avatarData.bases[0] || null;

  renderBaseOptions();
  renderPreview();

  const storedTheme = localStorage.getItem("theme");
  const hasStoredTheme = storedTheme === "dark" || storedTheme === "light";
  const themePreference = hasStoredTheme ? storedTheme : profile.themePreference;
  applyThemePreference(themePreference, { persist: !hasStoredTheme });

  baselineSettings = {
    avatarBase: selectedBase?.id || null,
    avatarProps: [],
    themePreference: darkModeToggle?.checked ? "dark" : "light"
  };
  settingsReady = true;
  setSettingsStatus("All changes saved.", "saved");
  updateSaveButtonState();
}

function renderAdminUsers(users) {
  if (!adminUsersBody) return;
  adminUsersBody.innerHTML = "";

  users.forEach((user) => {
    const row = document.createElement("tr");

    const displayNameCell = document.createElement("td");
    displayNameCell.textContent = user.displayName || "-";

    const usernameCell = document.createElement("td");
    usernameCell.textContent = user.username || "-";

    const emailCell = document.createElement("td");
    emailCell.textContent = user.email || "-";

    const linesCell = document.createElement("td");
    linesCell.textContent = String(user.linesCompleted ?? 0);

    const tilesCell = document.createElement("td");
    tilesCell.textContent = String(user.tilesCompleted ?? 0);

    const photosCell = document.createElement("td");
    photosCell.textContent = String(user.photoTiles ?? 0);

    const createdCell = document.createElement("td");
    createdCell.textContent = formatDate(user.createdAt);

    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost danger small";
    removeButton.textContent = user.canDelete ? "Remove" : (user.isAdmin ? "Admin" : "Locked");
    removeButton.disabled = !user.canDelete;
    removeButton.addEventListener("click", async () => {
      const targetLabel = user.displayName || user.username || user.email || "this user";
      const confirmed = window.prompt(`Type DELETE to remove ${targetLabel} from the system.`);
      if (confirmed !== "DELETE") {
        setAdminMessage("User removal cancelled.");
        return;
      }

      setAdminMessage("");
      removeButton.disabled = true;
      try {
        await apiFetch(`/api/admin/users/${user.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: "DELETE" })
        });
        setAdminMessage("User removed.");
        await loadAdminUsers();
      } catch (error) {
        removeButton.disabled = !user.canDelete;
        setAdminMessage(error.message);
      }
    });
    actionCell.appendChild(removeButton);

    row.append(
      displayNameCell,
      usernameCell,
      emailCell,
      linesCell,
      tilesCell,
      photosCell,
      createdCell,
      actionCell
    );
    adminUsersBody.appendChild(row);
  });
}

async function loadAdminUsers() {
  if (!isAdmin) return;
  setAdminMessage("");
  const data = await apiFetch("/api/admin/users");
  renderAdminUsers(data.users || []);
}

saveSettings?.addEventListener("click", () => {
  persistSettings("manual").catch(() => {});
});

if (darkModeToggle) {
  darkModeToggle.addEventListener("change", () => {
    applyThemePreference(darkModeToggle.checked ? "dark" : "light");
    onSettingsChanged();
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
      clearSessionAndRedirect();
    } catch (error) {
      setMessage(error.message);
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    clearSessionAndRedirect();
  });
}

if (refreshAdminUsers) {
  refreshAdminUsers.addEventListener("click", () => {
    loadAdminUsers().catch((error) => setAdminMessage(error.message));
  });
}

window.addEventListener("beforeunload", (event) => {
  if (!settingsReady || isSavingSettings || !hasPendingSettingsChanges()) return;
  event.preventDefault();
  event.returnValue = "";
});

loadSettings().catch((error) => setMessage(error.message));
