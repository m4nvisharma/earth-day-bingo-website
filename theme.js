const THEME_KEY = "theme";

const SUPPORTED_THEMES = ["light", "dark", "love"];

function normalizeTheme(value) {
  return SUPPORTED_THEMES.includes(value) ? value : "light";
}

function applyTheme(theme, options = {}) {
  const mode = normalizeTheme(theme);
  document.body.classList.remove("theme-dark", "theme-love");
  if (mode !== "light") {
    document.body.classList.add(`theme-${mode}`);
  }
  document.body.dataset.theme = mode;
  if (options.persist !== false) {
    localStorage.setItem(THEME_KEY, mode);
  }
  return mode;
}

const initialTheme = localStorage.getItem(THEME_KEY);
applyTheme(initialTheme, { persist: false });
window.applyTheme = applyTheme;
window.normalizeTheme = normalizeTheme;

if (!SUPPORTED_THEMES.includes(initialTheme)) {
  const token = localStorage.getItem("token");
  const apiBase = window.API_BASE;
  if (token && apiBase) {
    fetch(`${apiBase}/api/user/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.themePreference) {
          applyTheme(data.themePreference);
        }
      })
      .catch(() => {});
  }
}

window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY) {
    applyTheme(event.newValue, { persist: false });
  }
});
