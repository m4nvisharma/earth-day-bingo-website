const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "index.html";
}

const certificateName = document.getElementById("certificateName");
const certificateDetail = document.getElementById("certificateDetail");
const certificateDate = document.getElementById("certificateDate");
const downloadCertificate = document.getElementById("downloadCertificate");
const certificateMessage = document.getElementById("certificateMessage");
const certificateCanvas = document.getElementById("certificateCanvas");

function setMessage(text) {
  if (certificateMessage) certificateMessage.textContent = text;
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

async function loadCertificate() {
  const me = await apiFetch("/api/user/me");
  const displayName = me.username || me.displayName || "Participant";
  if (certificateName) certificateName.textContent = displayName;

  const storedDate = me.certificateEarnedAt || localStorage.getItem("certificateDate");
  const date = storedDate ? new Date(storedDate) : new Date();
  const formatted = date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  if (certificateDate) certificateDate.textContent = `Completed on ${formatted}`;
  if (certificateDetail) certificateDetail.textContent = "For completing the Earth Day Bingo card.";
}

async function downloadPdf() {
  if (!certificateCanvas) return;
  setMessage("Preparing PDF...");

  const canvas = await html2canvas(certificateCanvas, { scale: 2, backgroundColor: "#ffffff" });
  const imageData = canvas.toDataURL("image/png");

  const pdf = new window.jspdf.jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [canvas.width, canvas.height]
  });
  pdf.addImage(imageData, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save("Earth-Day-Bingo-Certificate.pdf");
  setMessage("PDF downloaded.");
}

downloadCertificate?.addEventListener("click", () => {
  downloadPdf().catch((error) => setMessage(error.message));
});

loadCertificate().catch((error) => setMessage(error.message));
