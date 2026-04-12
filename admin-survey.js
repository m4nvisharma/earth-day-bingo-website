const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const adminEmail = (window.ADMIN_EMAIL || "info@cycat.ca").toLowerCase();
const logoutBtn = document.getElementById("logoutBtn");
const refreshSurveyBtn = document.getElementById("refreshSurveyBtn");
const surveySearch = document.getElementById("surveySearch");
const surveyTableBody = document.getElementById("surveyTableBody");
const surveyMessage = document.getElementById("surveyMessage");
const surveyTotalUsers = document.getElementById("surveyTotalUsers");
const surveySubmittedUsers = document.getElementById("surveySubmittedUsers");
const surveyRequiredOnlyUsers = document.getElementById("surveyRequiredOnlyUsers");
const surveyPendingUsers = document.getElementById("surveyPendingUsers");

let surveyRows = [];

function clearSessionAndRedirect() {
  localStorage.removeItem("token");
  localStorage.removeItem("displayName");
  localStorage.removeItem("username");
  localStorage.removeItem("userEmail");
  window.location.href = "index.html";
}

function setMessage(text, state) {
  if (!surveyMessage) return;
  surveyMessage.textContent = text || "";
  if (state) {
    surveyMessage.setAttribute("data-state", state);
  } else {
    surveyMessage.removeAttribute("data-state");
  }
}

function formatText(value) {
  if (value === null || value === undefined) return "-";
  const text = String(value).trim();
  return text ? text : "-";
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function toSearchText(value) {
  return String(value || "").toLowerCase();
}

function getSurveyStatus(entry) {
  if (entry?.skippedAt) {
    return { key: "required", label: "Required only" };
  }
  if (entry?.completedAt) {
    return { key: "submitted", label: "Submitted" };
  }
  return { key: "pending", label: "Pending" };
}

function getAgeIndicator(isUnder30) {
  if (isUnder30 === true) return "Below 30";
  if (isUnder30 === false) return "30 and above";
  return "No answer";
}

function getReferralEmail(entry) {
  return entry?.friendReferralEmail || entry?.cycatReferralEmail || "-";
}

function createCell(content) {
  const td = document.createElement("td");
  td.textContent = content;
  return td;
}

function createStatusCell(status) {
  const td = document.createElement("td");
  const pill = document.createElement("span");
  pill.className = "survey-pill";
  pill.dataset.status = status.key;
  pill.textContent = status.label;
  td.appendChild(pill);
  return td;
}

function renderStats(rows) {
  const total = rows.length;
  const submitted = rows.filter((entry) => Boolean(entry?.completedAt) && !entry?.skippedAt).length;
  const requiredOnly = rows.filter((entry) => Boolean(entry?.skippedAt)).length;
  const pending = rows.filter((entry) => !entry?.completedAt && !entry?.skippedAt).length;

  if (surveyTotalUsers) surveyTotalUsers.textContent = String(total);
  if (surveySubmittedUsers) surveySubmittedUsers.textContent = String(submitted);
  if (surveyRequiredOnlyUsers) surveyRequiredOnlyUsers.textContent = String(requiredOnly);
  if (surveyPendingUsers) surveyPendingUsers.textContent = String(pending);
}

function renderTable(rows) {
  if (!surveyTableBody) return;
  surveyTableBody.innerHTML = "";

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 14;
    cell.textContent = "No users match your search.";
    row.appendChild(cell);
    surveyTableBody.appendChild(row);
    return;
  }

  rows.forEach((entry) => {
    const tr = document.createElement("tr");
    const status = getSurveyStatus(entry);

    tr.append(
      createCell(formatText(entry.displayName)),
      createCell(formatText(entry.username)),
      createCell(formatText(entry.email)),
      createStatusCell(status),
      createCell(getAgeIndicator(entry.isUnder30)),
      createCell(formatText(entry.ageRange)),
      createCell(formatText(entry.race)),
      createCell(formatText(entry.disability)),
      createCell(formatText(entry.rural)),
      createCell(formatText(entry.location)),
      createCell(formatText(entry.discoverySource)),
      createCell(formatText(getReferralEmail(entry))),
      createCell(formatText(entry.otherDiscovery)),
      createCell(formatTimestamp(entry.completedAt))
    );

    surveyTableBody.appendChild(tr);
  });
}

function getFilteredRows() {
  const query = toSearchText(surveySearch?.value);
  if (!query) return [...surveyRows];

  return surveyRows.filter((entry) => {
    return [
      entry.displayName,
      entry.username,
      entry.email
    ].some((field) => toSearchText(field).includes(query));
  });
}

function applyFilter(showMessage = false) {
  const filtered = getFilteredRows();
  renderTable(filtered);

  if (!showMessage) return;

  const query = toSearchText(surveySearch?.value);
  if (!query) {
    setMessage(`Showing all ${surveyRows.length} users.`, "success");
    return;
  }
  setMessage(`Showing ${filtered.length} of ${surveyRows.length} users.`, "success");
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function ensureAdminAccess() {
  const me = await apiFetch("/api/user/me");
  const requesterEmail = (me?.email || "").toLowerCase();
  if (requesterEmail !== adminEmail) {
    setMessage("This page is only available to the admin account.", "error");
    window.setTimeout(() => {
      window.location.href = "app.html";
    }, 900);
    return false;
  }
  return true;
}

async function loadSurveyData() {
  setMessage("Loading survey responses...");
  if (refreshSurveyBtn) {
    refreshSurveyBtn.disabled = true;
  }

  try {
    const data = await apiFetch("/api/admin/surveys");
    surveyRows = Array.isArray(data.users) ? data.users : [];
    renderStats(surveyRows);
    applyFilter(false);
    setMessage(`Loaded ${surveyRows.length} users.`, "success");
  } catch (error) {
    renderStats([]);
    renderTable([]);
    setMessage(error.message, "error");
  } finally {
    if (refreshSurveyBtn) {
      refreshSurveyBtn.disabled = false;
    }
  }
}

logoutBtn?.addEventListener("click", () => {
  clearSessionAndRedirect();
});

refreshSurveyBtn?.addEventListener("click", () => {
  loadSurveyData().catch((error) => setMessage(error.message, "error"));
});

surveySearch?.addEventListener("input", () => {
  applyFilter(true);
});

ensureAdminAccess()
  .then((allowed) => {
    if (!allowed) return null;
    return loadSurveyData();
  })
  .catch((error) => {
    if (error.message === "Missing token" || error.message === "Invalid token") {
      clearSessionAndRedirect();
      return;
    }
    setMessage(error.message, "error");
  });
