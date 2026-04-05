const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const avatarPreview = document.getElementById("avatarPreview");
const avatarBases = document.getElementById("avatarBases");
const avatarProps = document.getElementById("avatarProps");
const darkModeToggle = document.getElementById("darkModeToggle");
const saveSettings = document.getElementById("saveSettings");
const deleteAccount = document.getElementById("deleteAccount");
const settingsMessage = document.getElementById("settingsMessage");

let avatarData = null;
let selectedBase = null;
let selectedProps = new Set();

function setMessage(text) {
  if (settingsMessage) settingsMessage.textContent = text;
}

function applyTheme(theme) {
  const mode = theme === "dark" ? "dark" : "light";
  document.body.classList.toggle("theme-dark", mode === "dark");
  localStorage.setItem("theme", mode);
  if (darkModeToggle) {
    darkModeToggle.checked = mode === "dark";
  }
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

  const baseImg = document.createElement("img");
  baseImg.src = selectedBase.src;
  baseImg.alt = selectedBase.label;
  baseImg.className = "avatar-layer";
  frame.appendChild(baseImg);

  selectedProps.forEach((propId) => {
    const prop = avatarData.props.find((item) => item.id === propId);
    if (!prop) return;
    const propImg = document.createElement("img");
    propImg.src = prop.src;
    propImg.alt = prop.label;
    propImg.className = "avatar-layer prop-layer";
    frame.appendChild(propImg);
  });

  avatarPreview.appendChild(frame);
}

function renderOptions(container, items, isMulti) {
  if (!container) return;
  container.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-option";
    button.dataset.id = item.id;

    const img = document.createElement("img");
    img.src = item.src;
    img.alt = item.label;

    const label = document.createElement("span");
    label.textContent = item.label;

    button.append(img, label);

    button.addEventListener("click", () => {
      if (isMulti) {
        if (selectedProps.has(item.id)) {
          selectedProps.delete(item.id);
        } else {
          selectedProps.add(item.id);
        }
      } else {
        selectedBase = item;
      }
      updateSelectedStates();
      renderPreview();
    });

    container.appendChild(button);
  });

  updateSelectedStates();
}

function updateSelectedStates() {
  document.querySelectorAll(".avatar-option").forEach((option) => {
    const id = option.dataset.id;
    const isBase = avatarData?.bases?.some((base) => base.id === id);
    const selected = isBase ? selectedBase?.id === id : selectedProps.has(id);
    option.classList.toggle("selected", selected);
  });
}

async function loadSettings() {
  avatarData = await (await fetch("content/avatars.json")).json();
  const profile = await apiFetch("/api/user/profile");

  selectedBase = avatarData.bases.find((base) => base.id === profile.avatarBase) || avatarData.bases[0];
  selectedProps = new Set(profile.avatarProps || []);

  renderOptions(avatarBases, avatarData.bases, false);
  renderOptions(avatarProps, avatarData.props, true);
  renderPreview();
  applyTheme(profile.themePreference);
}

saveSettings?.addEventListener("click", async () => {
  setMessage("");
  try {
    const themePreference = darkModeToggle?.checked ? "dark" : "light";
    const payload = {
      avatarBase: selectedBase?.id || null,
      avatarProps: Array.from(selectedProps),
      themePreference
    };

    await apiFetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    applyTheme(themePreference);
    setMessage("Settings saved.");
  } catch (error) {
    setMessage(error.message);
  }
});

if (darkModeToggle) {
  darkModeToggle.addEventListener("change", () => {
    applyTheme(darkModeToggle.checked ? "dark" : "light");
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
