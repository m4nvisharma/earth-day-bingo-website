const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

const KEEP_WARM_MS = 13 * 60 * 1000;

function keepWarm() {
  fetch(`${API_BASE}/api/health`, { cache: "no-store" }).catch(() => {});
}

keepWarm();
setInterval(keepWarm, KEEP_WARM_MS);

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
const adminStorageCard = document.getElementById("adminStorageCard");
const adminStorageUsage = document.getElementById("adminStorageUsage");
const adminStorageMeta = document.getElementById("adminStorageMeta");
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
const adminDetailLines = document.getElementById("adminDetailLines");
const adminDetailLineList = document.getElementById("adminDetailLineList");
const adminDetailLineEmpty = document.getElementById("adminDetailLineEmpty");
const adminLineTableBody = document.getElementById("adminLineTableBody");
const ticketCount = document.getElementById("ticketCount");
const consentModal = document.getElementById("consentModal");
const consentTitle = document.getElementById("consentTitle");
const consentBody = document.getElementById("consentBody");
const consentUsePhotos = document.getElementById("consentUsePhotos");
const consentUsePhotosLabel = document.getElementById("consentUsePhotosLabel");
const consentAuthentic = document.getElementById("consentAuthentic");
const consentAuthenticLabel = document.getElementById("consentAuthenticLabel");
const consentAgreeBtn = document.getElementById("consentAgreeBtn");
const consentNote = document.getElementById("consentNote");
const certificateBtn = document.getElementById("certificateBtn");
const certificateCard = document.getElementById("certificateCard");

let items = [];
let state = new Map();
let lastLineCount = 0;
let hasLoadedLines = false;
let consentReadyAt = 0;
let referralBonusTickets = 0;

function applyThemePreference(theme, options = {}) {
  const mode = theme === "dark" ? "dark" : "light";
  if (typeof window.applyTheme === "function") {
    window.applyTheme(mode, options);
    return mode;
  }
  document.body.classList.toggle("theme-dark", mode === "dark");
  if (options.persist !== false) {
    localStorage.setItem("theme", mode);
  }
  return mode;
}

const adminEmail = (window.ADMIN_EMAIL || "manviisharma01@gmail.com").toLowerCase();
const userEmail = (localStorage.getItem("userEmail") || "").toLowerCase();
const isAdmin = userEmail === adminEmail;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Unknown";
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / mb))} MB`;
}

function renderStorageStatus(summary) {
  if (!adminStorageCard || !adminStorageUsage || !adminStorageMeta) return;
  if (!summary || summary.status === "external") {
    adminStorageCard.hidden = true;
    return;
  }

  adminStorageCard.hidden = false;
  const usageText = formatBytes(summary.usageBytes);
  const limitText = summary.limitBytes ? formatBytes(summary.limitBytes) : "Unknown";
  const percentText = Number.isFinite(summary.usagePercent) ? `${summary.usagePercent.toFixed(1)}%` : "Unknown";
  const status = summary.status || "unknown";

  adminStorageUsage.textContent = `${percentText} used`;
  adminStorageMeta.textContent = `${usageText} of ${limitText}`;
  adminStorageCard.dataset.status = status;
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
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

function isSurveyCompleted(survey) {
  return Boolean(survey && (survey.completedAt || survey.skippedAt));
}

async function ensureApprovalFlow() {
  const [me, survey] = await Promise.all([
    apiFetch("/api/user/me"),
    apiFetch("/api/user/survey").catch(() => null)
  ]);

  const hasConsent = Boolean(me?.consentPhotoUse && me?.consentAuthentic);
  const surveyDone = isSurveyCompleted(survey);

  if (!hasConsent || !surveyDone) {
    window.location.href = "approval.html";
    return false;
  }

  return true;
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
  const username = localStorage.getItem("username") || "";
  const displayName = localStorage.getItem("displayName") || "";
  const rawName = username || displayName;
  const firstName = rawName.trim().split(/\s+/)[0] || "";
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

    const fileLabel = document.createElement("label");
    fileLabel.className = "file-label";
    fileLabel.textContent = status.imageUrl ? "Replace photo" : "Add photo";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.addEventListener("change", async () => {
      if (fileInput.files.length === 0) return;
      try {
        await uploadImage(item.id, fileInput.files[0]);
        showToast("Photo saved");
      } catch (error) {
        showToast(error.message);
      }
    });
    fileLabel.appendChild(fileInput);

    controls.append(fileLabel);

    if (status.checked) {
      const undoBtn = document.createElement("button");
      undoBtn.type = "button";
      undoBtn.className = "ghost small";
      undoBtn.textContent = "Undone";
      undoBtn.addEventListener("click", async () => {
        try {
          await removeImage(item.id);
          showToast("Marked undone");
        } catch (error) {
          showToast(error.message);
        }
      });
      controls.appendChild(undoBtn);
    } else {
      const note = document.createElement("p");
      note.className = "photo-required";
      note.textContent = "Photo required to complete.";
      controls.appendChild(note);
    }

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
  if (ticketCount) {
    ticketCount.textContent = `${lineCount + referralBonusTickets}`;
  }

  const isCardComplete = completed === items.length && items.length > 0;
  if (certificateBtn) {
    certificateBtn.disabled = !isCardComplete;
    certificateBtn.textContent = isCardComplete ? "Download certificate" : "Complete all tiles to unlock";
  }
  if (isCardComplete) {
    const storedDate = localStorage.getItem("certificateDate");
    if (!storedDate) {
      localStorage.setItem("certificateDate", new Date().toISOString());
    }
  }

  if (hasLoadedLines && lineCount > lastLineCount) {
    showCelebration(lineCount - lastLineCount, lineCount);
  }
  lastLineCount = lineCount;
  hasLoadedLines = true;
}

async function loadData() {
  const [itemsData, stateData, surveyData] = await Promise.all([
    apiFetch("/api/bingo/items"),
    apiFetch("/api/bingo/state"),
    apiFetch("/api/user/survey").catch(() => ({ referralBonus: 0 }))
  ]);

  items = itemsData.items;
  state = new Map(stateData.state.map((entry) => [entry.item_id, {
    checked: entry.checked,
    imageUrl: entry.image_url
  }]));
  referralBonusTickets = Number(surveyData?.referralBonus) === 1 ? 1 : 0;

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

async function removeImage(itemId) {
  const response = await fetch(`${API_BASE}/api/bingo/item/${itemId}/image`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Remove failed");
  }

  state.set(itemId, { ...state.get(itemId), imageUrl: null, checked: false });
  renderGrid();
}

async function loadConsentCopy() {
  const response = await fetch("content/copy.json");
  if (!response.ok) {
    throw new Error("Unable to load consent copy");
  }
  return response.json();
}

function openConsentModal() {
  if (!consentModal) return;
  consentModal.classList.add("show");
  consentModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeConsentModal() {
  if (!consentModal) return;
  consentModal.classList.remove("show");
  consentModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function updateConsentButton() {
  if (!consentAgreeBtn) return;
  const now = Date.now();
  const remaining = Math.max(0, Math.ceil((consentReadyAt - now) / 1000));
  const canClick = remaining === 0 && consentUsePhotos?.checked && consentAuthentic?.checked;
  consentAgreeBtn.disabled = !canClick;
  consentAgreeBtn.textContent = remaining > 0 ? `Agree (${remaining})` : "Agree";
}

function startConsentCountdown(seconds = 5) {
  consentReadyAt = Date.now() + seconds * 1000;
  updateConsentButton();
  window.clearInterval(startConsentCountdown._timer);
  startConsentCountdown._timer = window.setInterval(() => {
    updateConsentButton();
    if (Date.now() >= consentReadyAt) {
      window.clearInterval(startConsentCountdown._timer);
    }
  }, 300);
}

async function ensureConsent() {
  if (!consentModal) return;
  const me = await apiFetch("/api/user/me");
  const storedTheme = localStorage.getItem("theme");
  const hasStoredTheme = storedTheme === "dark" || storedTheme === "light";
  if (!hasStoredTheme && me?.themePreference) {
    applyThemePreference(me.themePreference);
  }
  if (me?.certificateEarnedAt) {
    localStorage.setItem("certificateDate", me.certificateEarnedAt);
  }
  if (me?.consentPhotoUse && me?.consentAuthentic) return;

  const copy = await loadConsentCopy();
  const consent = copy?.consent || {};
  if (consentTitle) consentTitle.textContent = consent.title || "Photo consent";
  if (consentUsePhotosLabel) consentUsePhotosLabel.textContent = consent.photoUseLabel || consentUsePhotosLabel.textContent;
  if (consentAuthenticLabel) consentAuthenticLabel.textContent = consent.authenticLabel || consentAuthenticLabel.textContent;
  if (consentNote) consentNote.textContent = consent.note || "";

  if (consentBody) {
    consentBody.innerHTML = "";
    if (consent.summary) {
      const p = document.createElement("p");
      p.textContent = consent.summary;
      consentBody.appendChild(p);
    }
    if (Array.isArray(consent.points)) {
      const ul = document.createElement("ul");
      consent.points.forEach((point) => {
        const li = document.createElement("li");
        li.textContent = point;
        ul.appendChild(li);
      });
      consentBody.appendChild(ul);
    }
  }

  consentUsePhotos.checked = false;
  consentAuthentic.checked = false;
  openConsentModal();
  startConsentCountdown(5);

  const syncButton = () => updateConsentButton();
  consentUsePhotos?.addEventListener("change", syncButton);
  consentAuthentic?.addEventListener("change", syncButton);

  consentAgreeBtn?.addEventListener("click", async () => {
    try {
      consentAgreeBtn.disabled = true;
      await apiFetch("/api/user/consent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consentPhotoUse: true,
          consentAuthentic: true
        })
      });
      closeConsentModal();
      showToast("Consent saved");
    } catch (error) {
      showToast(error.message);
      updateConsentButton();
    }
  }, { once: true });
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

async function loadStorageStatus() {
  if (!isAdmin || !adminStorageCard) return;
  try {
    const summary = await apiFetch("/api/admin/storage");
    renderStorageStatus(summary);
  } catch (error) {
    renderStorageStatus({ status: "unknown" });
  }
}

async function loadLineCompletions() {
  if (!isAdmin || !adminLineTableBody) return;
  const data = await apiFetch("/api/admin/line-completions");
  const completions = data.completions || [];
  adminLineTableBody.innerHTML = "";

  if (completions.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = "<td colspan=\"5\">No completed lines yet.</td>";
    adminLineTableBody.appendChild(row);
    return;
  }

  completions.forEach((entry, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${entry.displayName}</td>
      <td>${entry.email}</td>
      <td>${entry.lineLabel}</td>
      <td>${formatTimestamp(entry.createdAt)}</td>
    `;
    adminLineTableBody.appendChild(row);
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

function renderAdminDetail({ user, items, state, lineCompletions }) {
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

  if (adminDetailLineList && adminDetailLineEmpty && adminDetailLines) {
    const lines = Array.isArray(lineCompletions) ? lineCompletions : [];
    adminDetailLineList.innerHTML = "";
    adminDetailLineEmpty.hidden = lines.length > 0;
    lines.forEach((line, index) => {
      const li = document.createElement("li");
      li.className = "admin-line-item";

      const order = document.createElement("span");
      order.className = "admin-line-order";
      order.textContent = `#${index + 1}`;

      const info = document.createElement("div");
      info.className = "admin-line-info";

      const label = document.createElement("span");
      label.className = "admin-line-label";
      label.textContent = line.lineLabel || "Line";

      const time = document.createElement("span");
      time.className = "admin-line-time";
      time.textContent = formatTimestamp(line.createdAt);

      info.append(label, time);
      li.append(order, info);
      adminDetailLineList.appendChild(li);
    });
  }

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
  localStorage.removeItem("username");
  localStorage.removeItem("userEmail");
  window.location.href = "index.html";
});

if (closeCelebration) {
  closeCelebration.addEventListener("click", () => {
    celebration.classList.remove("show");
    celebration.setAttribute("aria-hidden", "true");
  });
}

if (certificateBtn) {
  certificateBtn.addEventListener("click", () => {
    window.location.href = "certificate.html";
  });
}

if (adminDetailClose) {
  adminDetailClose.addEventListener("click", closeAdminDetail);
}

if (isAdmin && adminPanel) {
  adminPanel.hidden = false;
  refreshAdminBtn?.addEventListener("click", () => {
    Promise.all([loadLeaderboard(), loadLineCompletions(), loadStorageStatus()]).catch((error) => showToast(error.message));
  });
  Promise.all([loadLeaderboard(), loadLineCompletions(), loadStorageStatus()]).catch((error) => showToast(error.message));
} else if (adminPanel) {
  adminPanel.hidden = true;
}

ensureApprovalFlow()
  .then((ready) => {
    if (!ready) return null;
    return Promise.all([ensureConsent(), loadData()]);
  })
  .catch((error) => {
    showToast(error.message);
  });
