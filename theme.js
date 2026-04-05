const THEME_KEY = "theme";

function normalizeTheme(value) {
  return value === "dark" ? "dark" : "light";
}

function applyTheme(theme, options = {}) {
  const mode = normalizeTheme(theme);
  document.body.classList.toggle("theme-dark", mode === "dark");
  if (options.persist !== false) {
    localStorage.setItem(THEME_KEY, mode);
  }
  return mode;
}

applyTheme(localStorage.getItem(THEME_KEY), { persist: false });
window.applyTheme = applyTheme;

window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY) {
    applyTheme(event.newValue, { persist: false });
  }
});
