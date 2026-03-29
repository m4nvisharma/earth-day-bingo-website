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

let items = [];
let state = new Map();

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

function computeBingo() {
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

  return lines.some((line) => line.every(Boolean));
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
      pin.textContent = "TREE";
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
  if (bingoStatus) {
    bingoStatus.textContent = computeBingo() ? "Bingo achieved!" : "No bingo yet. Keep going.";
  }
}

async function loadData() {
  const itemsData = await apiFetch("/api/bingo/items");
  const stateData = await apiFetch("/api/bingo/state");

  items = itemsData.items;
  state = new Map(stateData.state.map((entry) => [entry.item_id, {
    checked: entry.checked,
    imageUrl: entry.image_url
  }]));

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

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("token");
  localStorage.removeItem("displayName");
  window.location.href = "index.html";
});

loadData().catch((error) => {
  showToast(error.message);
});
