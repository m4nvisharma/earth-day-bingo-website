const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const leaderboardBody = document.getElementById("leaderboardBody");
const leaderboardMessage = document.getElementById("leaderboardMessage");
const refreshLeaderboard = document.getElementById("refreshLeaderboard");
let avatarCatalog = null;

function applyTheme(theme) {
  const mode = theme === "dark" ? "dark" : "light";
  document.body.classList.toggle("theme-dark", mode === "dark");
  localStorage.setItem("theme", mode);
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
    const baseSrc = avatarCatalog?.bases?.find((base) => base.id === user.avatarBase)?.src;
    const overlayId = Array.isArray(user.avatarProps) ? user.avatarProps[0] : null;
    const overlaySrc = overlayId
      ? avatarCatalog?.props?.find((prop) => prop.id === overlayId)?.src
      : null;
    const avatarHtml = baseSrc
      ? `<div class="leaderboard-avatar">
          <img src="${baseSrc}" alt="" />
          ${overlaySrc ? `<img src="${overlaySrc}" alt="" class="prop-layer" />` : ""}
        </div>`
      : "";
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>
        <div class="leaderboard-user">
          ${avatarHtml}
          <span>${user.username || "Player"}</span>
        </div>
      </td>
      <td>${user.linesCompleted}</td>
      <td>${user.tilesCompleted}</td>
    `;
    if (user.id === currentUserId) {
      row.classList.add("current-user");
    }
    leaderboardBody.appendChild(row);
  });
}

async function loadLeaderboard() {
  setMessage("");
  const me = await apiFetch("/api/user/me");
  if (me?.themePreference) {
    applyTheme(me.themePreference);
  }
  if (!avatarCatalog) {
    avatarCatalog = await (await fetch("content/avatars.json")).json();
  }
  const data = await apiFetch("/api/leaderboard");
  const users = data.users || [];
  const normalized = users.map((user) => ({
    ...user,
    avatarBase: user.avatarBase ? user.avatarBase : null,
    avatarProps: Array.isArray(user.avatarProps) ? user.avatarProps : []
  }));
  renderLeaderboard(normalized, data.currentUserId);
}

refreshLeaderboard?.addEventListener("click", () => {
  loadLeaderboard().catch((error) => setMessage(error.message));
});

loadLeaderboard().catch((error) => setMessage(error.message));
