const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const grid = document.getElementById("bingoGrid");
const progressCount = document.getElementById("progressCount");
const bingoStatus = document.getElementById("bingoStatus");
const logoutBtn = document.getElementById("logoutBtn");
const toast = document.getElementById("toast");
const adminPanel = document.getElementById("adminPanel");
const adminTableBody = document.getElementById("adminTableBody");
const adminUserCount = document.getElementById("adminUserCount");
const adminTopLines = document.getElementById("adminTopLines");
const adminTopTiles = document.getElementById("adminTopTiles");
const adminTopPhotos = document.getElementById("adminTopPhotos");
const refreshAdminBtn = document.getElementById("refreshAdminBtn");
const celebration = document.getElementById("celebration");
const celebrationTitle = document.getElementById("celebrationTitle");
const celebrationMessage = document.getElementById("celebrationMessage");
const closeCelebration = document.getElementById("closeCelebration");
const adminDetail = document.getElementById("adminDetail");
const adminDetailClose = document.getElementById("adminDetailClose");
const adminDetailName = document.getElementById("adminDetailName");
const adminDetailMeta = document.getElementById("adminDetailMeta");
const adminDetailGrid = document.getElementById("adminDetailGrid");

let items = [];
let state = new Map();
let lastLineCount = 0;
let hasLoadedLines = false;

const adminEmail = (window.ADMIN_EMAIL || "manviisharma01@gmail.com").toLowerCase();
const userEmail = (localStorage.getItem("userEmail") || "").toLowerCase();
const isAdmin = userEmail === adminEmail;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
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

function getLineCompletionCount() {
  if (items.length < 25) return 0;
  const checked = items.map((item) => Boolean(state.get(item.id)?.checked));
  const size = 5;
  const lines = [];

  for (let r = 0; r < size; r++) {
    lines.push(checked.slice(r * size, r * size + size));
  }

  for (let c = 0; c < size; c++) {
    lines.push(Array.from({ length: size }, (_, r) => checked[r * size + c]));
  }

  lines.push(Array.from({ length: size }, (_, i) => checked[i * size + i]));
  lines.push(Array.from({ length: size }, (_, i) => checked[i * size + (size - i - 1)]));

  return lines.filter((line) => line.every(Boolean)).length;
}

function updateGreeting() {
  const userGreeting = document.getElementById("userGreeting");
  if (!userGreeting) return;
  const displayName = localStorage.getItem("displayName") || "";
  const firstName = displayName.trim().split(/\s+/)[0] || "";
  userGreeting.textContent = firstName ? `Welcome, ${firstName}` : "";
}

function showCelebration(newLines, totalLines) {
  if (!celebration) return;
  const lineLabel = newLines === 1 ? "line" : "lines";
  celebrationTitle.textContent = `${newLines} ${lineLabel} completed!`;
  celebrationMessage.textContent = `You now have ${totalLines} total completed ${totalLines === 1 ? "line" : "lines"}.`;
  celebration.classList.add("show");
  celebration.setAttribute("aria-hidden", "false");
  window.clearTimeout(showCelebration._timer);
  showCelebration._timer = window.setTimeout(() => {
    celebration.classList.remove("show");
    celebration.setAttribute("aria-hidden", "true");
  }, 3600);
}

function renderGrid() {
  grid.innerHTML = "";
  let completed = 0;

  items.forEach((item, index) => {
    const status = state.get(item.id) || { checked: false, imageUrl: null };
    if (status.checked) completed += 1;

    const card = document.createElement("article");
    const isCenter = index === 12;
    card.className = `bingo-card${status.checked ? " checked" : ""}${isCenter ? " center-tile" : ""}`;

    const title = document.createElement("p");
    title.className = "title";
    title.textContent = item.label;

    const controls = document.createElement("div");
    controls.className = "controls";

    const checkLabel = document.createElement("label");
    checkLabel.className = "file-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = status.checked;
    checkbox.addEventListener("change", async () => {
      await updateChecked(item.id, checkbox.checked);
      showToast(checkbox.checked ? "Marked complete" : "Unchecked");
    });
    checkLabel.append("Done", checkbox);

    const fileLabel = document.createElement("label");
    fileLabel.className = "file-label";
    fileLabel.textContent = "Add photo";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.addEventListener("change", async () => {
      if (fileInput.files.length === 0) return;
      await uploadImage(item.id, fileInput.files[0]);
      showToast("Photo saved");
    });
    fileLabel.appendChild(fileInput);

    controls.append(checkLabel, fileLabel);

    card.append(title, controls);

    if (isCenter) {
      const pin = document.createElement("span");
      pin.className = "center-pin";
      pin.setAttribute("aria-hidden", "true");
      pin.textContent = "";
      card.appendChild(pin);
    }

    if (status.imageUrl) {
      const img = document.createElement("img");
      img.src = status.imageUrl.startsWith("http") ? status.imageUrl : `${API_BASE}${status.imageUrl}`;
      img.alt = "Uploaded proof";
      card.appendChild(img);
    }

    grid.appendChild(card);
  });

  if (progressCount) {
    progressCount.textContent = `${completed} / ${items.length} complete`;
  }
  const lineCount = getLineCompletionCount();
  if (bingoStatus) {
    bingoStatus.textContent = lineCount > 0 ? "Bingo achieved!" : "No bingo yet. Keep going.";
  }

  if (hasLoadedLines && lineCount > lastLineCount) {
    showCelebration(lineCount - lastLineCount, lineCount);
  }
  lastLineCount = lineCount;
  hasLoadedLines = true;
}

async function loadData() {
  const itemsData = await apiFetch("/api/bingo/items");
  const stateData = await apiFetch("/api/bingo/state");

  items = itemsData.items;
  state = new Map(stateData.state.map((entry) => [entry.item_id, {
    checked: entry.checked,
    imageUrl: entry.image_url
  }]));

  updateGreeting();
  renderGrid();
}

async function updateChecked(itemId, checked) {
  await apiFetch("/api/bingo/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, checked })
  });

  state.set(itemId, { ...state.get(itemId), checked });
  renderGrid();
}

async function uploadImage(itemId, file) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`${API_BASE}/api/bingo/item/${itemId}/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Upload failed");
  }

  state.set(itemId, { ...state.get(itemId), imageUrl: data.imageUrl, checked: true });
  renderGrid();
}

async function loadLeaderboard() {
  if (!isAdmin || !adminPanel) return;
  const data = await apiFetch("/api/admin/leaderboard");
  const users = data.users || [];
  adminUserCount.textContent = users.length;
  adminTopLines.textContent = users[0]?.linesCompleted ?? 0;
  adminTopTiles.textContent = users[0]?.tilesCompleted ?? 0;
  adminTopPhotos.textContent = users[0]?.photoTiles ?? 0;

  adminTableBody.innerHTML = "";
  users.forEach((user, index) => {
    const row = document.createElement("tr");
    row.dataset.userId = user.id;
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${user.displayName}</td>
      <td>${user.email}</td>
      <td>${user.linesCompleted}</td>
      <td>${user.tilesCompleted}</td>
      <td>${user.photoTiles}</td>
    `;
    row.addEventListener("click", () => {
      loadAdminDetail(user.id).catch((error) => showToast(error.message));
    });
    adminTableBody.appendChild(row);
  });
}

function openAdminDetail() {
  if (!adminDetail) return;
  adminDetail.classList.add("show");
  adminDetail.setAttribute("aria-hidden", "false");
}

function closeAdminDetail() {
  if (!adminDetail) return;
  adminDetail.classList.remove("show");
  adminDetail.setAttribute("aria-hidden", "true");
}

function renderAdminDetail({ user, items, state }) {
  if (!adminDetailGrid || !adminDetailName || !adminDetailMeta) return;
  const statusMap = new Map(state.map((entry) => [entry.item_id, entry]));
  adminDetailName.textContent = user.display_name;
  adminDetailMeta.textContent = user.email;
  adminDetailGrid.innerHTML = "";

  items.forEach((item, index) => {
    const status = statusMap.get(item.id) || { checked: false, image_url: null };
    const card = document.createElement("article");
    const isCenter = index === 12;
    card.className = `bingo-card${status.checked ? " checked" : ""}${isCenter ? " center-tile" : ""}`;

    const title = document.createElement("p");
    title.className = "title";
    title.textContent = item.label;
    card.appendChild(title);

    if (status.image_url) {
      const img = document.createElement("img");
      img.src = status.image_url.startsWith("http") ? status.image_url : `${API_BASE}${status.image_url}`;
      img.alt = "Uploaded proof";
      card.appendChild(img);
    }

    adminDetailGrid.appendChild(card);
  });

  openAdminDetail();
}

async function loadAdminDetail(userId) {
  if (!isAdmin) return;
  const data = await apiFetch(`/api/admin/users/${userId}/board`);
  renderAdminDetail(data);
}

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("token");
  localStorage.removeItem("displayName");
  localStorage.removeItem("userEmail");
  window.location.href = "index.html";
});

if (closeCelebration) {
  closeCelebration.addEventListener("click", () => {
    celebration.classList.remove("show");
    celebration.setAttribute("aria-hidden", "true");
  });
}

if (adminDetailClose) {
  adminDetailClose.addEventListener("click", closeAdminDetail);
}

if (isAdmin && adminPanel) {
  adminPanel.hidden = false;
  refreshAdminBtn?.addEventListener("click", () => {
    loadLeaderboard().catch((error) => showToast(error.message));
  });
  loadLeaderboard().catch((error) => showToast(error.message));
} else if (adminPanel) {
  adminPanel.hidden = true;
}

loadData().catch((error) => {
  showToast(error.message);
});
