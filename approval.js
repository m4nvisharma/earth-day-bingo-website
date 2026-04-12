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

const consentStep = document.getElementById("consentStep");
const surveyStep = document.getElementById("surveyStep");
const approvalMessage = document.getElementById("approvalMessage");
const consentBody = document.getElementById("consentBody");
const consentUsePhotos = document.getElementById("consentUsePhotos");
const consentUsePhotosLabel = document.getElementById("consentUsePhotosLabel");
const consentAuthentic = document.getElementById("consentAuthentic");
const consentAuthenticLabel = document.getElementById("consentAuthenticLabel");
const consentContinueBtn = document.getElementById("consentContinueBtn");

const surveyForm = document.getElementById("surveyForm");
const surveyContinueBtn = document.getElementById("surveyContinueBtn");
const skipSurveyBtn = document.getElementById("skipSurveyBtn");
const discoverySource = document.getElementById("discoverySource");
const friendReferralWrap = document.getElementById("friendReferralWrap");
const cycatReferralWrap = document.getElementById("cycatReferralWrap");
const otherDiscoveryWrap = document.getElementById("otherDiscoveryWrap");

function setMessage(text, type = "error") {
  if (!approvalMessage) return;
  approvalMessage.textContent = text || "";
  if (!text) {
    delete approvalMessage.dataset.state;
    return;
  }
  approvalMessage.dataset.state = type;
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
  } catch {
    data = {};
  }

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("displayName");
      localStorage.removeItem("username");
      localStorage.removeItem("userEmail");
      window.location.href = "index.html";
    }
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function loadConsentCopy() {
  const response = await fetch("content/copy.json");
  if (!response.ok) {
    throw new Error("Unable to load consent copy");
  }
  return response.json();
}

function renderConsentCopy(consent) {
  if (consentUsePhotosLabel) {
    consentUsePhotosLabel.textContent =
      consent?.photoUseLabel ||
      "I allow CYCAT to use my uploaded photos on social media and in program communications.";
  }
  if (consentAuthenticLabel) {
    consentAuthenticLabel.textContent =
      consent?.authenticLabel ||
      "I confirm my uploads are my own photos, not AI-generated, and not taken from the internet.";
  }

  if (!consentBody) return;
  consentBody.innerHTML = "";

  const summary = document.createElement("p");
  summary.textContent =
    consent?.summary ||
    "Before continuing, please confirm how your photos can be used and that your submissions are authentic.";
  consentBody.appendChild(summary);

  const points = Array.isArray(consent?.points) ? consent.points : [];
  if (points.length > 0) {
    const list = document.createElement("ul");
    points.forEach((point) => {
      const item = document.createElement("li");
      item.textContent = point;
      list.appendChild(item);
    });
    consentBody.appendChild(list);
  }
}

function setStep(step) {
  const onConsent = step === "consent";
  if (consentStep) consentStep.hidden = !onConsent;
  if (surveyStep) surveyStep.hidden = onConsent;
}

function updateConsentContinueButton() {
  if (!consentContinueBtn) return;
  consentContinueBtn.disabled = !(consentUsePhotos?.checked && consentAuthentic?.checked);
}

function updateDiscoveryFields() {
  if (!surveyForm) return;
  const source = (discoverySource?.value || "").trim();

  const friendEmailInput = surveyForm.elements.friendReferralEmail;
  const cycatEmailInput = surveyForm.elements.cycatReferralEmail;
  const otherDiscoveryInput = surveyForm.elements.otherDiscovery;

  const isFriend = source === "friend";
  const isCycat = source === "cycat";
  const isOther = source === "other";

  if (friendReferralWrap) friendReferralWrap.hidden = !isFriend;
  if (cycatReferralWrap) cycatReferralWrap.hidden = !isCycat;
  if (otherDiscoveryWrap) otherDiscoveryWrap.hidden = !isOther;

  if (friendEmailInput) {
    friendEmailInput.required = isFriend;
    if (!isFriend) friendEmailInput.value = "";
  }
  if (cycatEmailInput) {
    cycatEmailInput.required = isCycat;
    if (!isCycat) cycatEmailInput.value = "";
  }
  if (otherDiscoveryInput && !isOther) {
    otherDiscoveryInput.value = "";
  }
}

function hydrateSurveyForm(survey) {
  if (!surveyForm || !survey) return;

  const setValue = (name, value) => {
    const element = surveyForm.elements[name];
    if (!element) return;
    element.value = value || "";
  };

  setValue("ageRange", survey.ageRange);
  setValue("race", survey.race);
  setValue("disability", survey.disability);
  setValue("rural", survey.rural);
  setValue("location", survey.location);
  setValue("discoverySource", survey.discoverySource);
  setValue("friendReferralEmail", survey.friendReferralEmail);
  setValue("cycatReferralEmail", survey.cycatReferralEmail);
  setValue("otherDiscovery", survey.otherDiscovery);

  updateDiscoveryFields();
}

async function bootstrap() {
  try {
    const [copy, me, survey] = await Promise.all([
      loadConsentCopy(),
      apiFetch("/api/user/me"),
      apiFetch("/api/user/survey").catch(() => null)
    ]);

    renderConsentCopy(copy?.consent || {});
    hydrateSurveyForm(survey);

    if (me?.consentPhotoUse && me?.consentAuthentic) {
      setStep("survey");
    } else {
      setStep("consent");
      updateConsentContinueButton();
    }
  } catch (error) {
    setMessage(error.message);
  }
}

consentUsePhotos?.addEventListener("change", updateConsentContinueButton);
consentAuthentic?.addEventListener("change", updateConsentContinueButton);

consentContinueBtn?.addEventListener("click", async () => {
  setMessage("");
  consentContinueBtn.disabled = true;
  try {
    await apiFetch("/api/user/consent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consentPhotoUse: true,
        consentAuthentic: true
      })
    });
    setStep("survey");
    setMessage("Consent saved.", "success");
  } catch (error) {
    setMessage(error.message);
  } finally {
    updateConsentContinueButton();
  }
});

discoverySource?.addEventListener("change", updateDiscoveryFields);

surveyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  const formData = new FormData(surveyForm);
  const discovery = String(formData.get("discoverySource") || "").trim();
  const friendReferralEmail = String(formData.get("friendReferralEmail") || "").trim();
  const cycatReferralEmail = String(formData.get("cycatReferralEmail") || "").trim();

  if (discovery === "friend" && !friendReferralEmail) {
    setMessage("Friend referral email is required.");
    return;
  }

  if (discovery === "cycat" && !cycatReferralEmail) {
    setMessage("CYCAT referral email is required for the extra ticket.");
    return;
  }

  const payload = {
    ageRange: formData.get("ageRange"),
    race: formData.get("race"),
    disability: formData.get("disability"),
    rural: formData.get("rural"),
    location: formData.get("location"),
    discoverySource: discovery || null,
    friendReferralEmail: discovery === "friend" ? friendReferralEmail : null,
    cycatReferralEmail: discovery === "cycat" ? cycatReferralEmail : null,
    otherDiscovery: discovery === "other" ? formData.get("otherDiscovery") : null
  };

  surveyContinueBtn.disabled = true;
  skipSurveyBtn.disabled = true;

  try {
    await apiFetch("/api/user/survey", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    window.location.href = "app.html";
  } catch (error) {
    setMessage(error.message);
    surveyContinueBtn.disabled = false;
    skipSurveyBtn.disabled = false;
  }
});

skipSurveyBtn?.addEventListener("click", async () => {
  setMessage("");
  surveyContinueBtn.disabled = true;
  skipSurveyBtn.disabled = true;

  try {
    await apiFetch("/api/user/survey/skip", { method: "POST" });
    window.location.href = "app.html";
  } catch (error) {
    setMessage(error.message);
    surveyContinueBtn.disabled = false;
    skipSurveyBtn.disabled = false;
  }
});

bootstrap();