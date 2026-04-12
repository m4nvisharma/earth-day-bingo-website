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
const discoverySource = document.getElementById("discoverySource");
const raceSelect = document.getElementById("raceSelect");
const friendReferralWrap = document.getElementById("friendReferralWrap");
const cycatReferralWrap = document.getElementById("cycatReferralWrap");
const otherDiscoveryWrap = document.getElementById("otherDiscoveryWrap");
const raceOtherWrap = document.getElementById("raceOtherWrap");

const RACE_PRESET_VALUES = new Set([
  "Indigenous (First Nations, Inuit, Metis)",
  "Black",
  "East Asian",
  "South Asian",
  "Southeast Asian",
  "Middle Eastern or North African (MENA)",
  "Latinx or Hispanic",
  "White",
  "Mixed or multiple backgrounds",
  "Other"
]);

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

function updateRaceOtherField() {
  if (!surveyForm) return;
  const raceOtherInput = surveyForm.elements.raceOther;
  const isOther = (raceSelect?.value || "").trim() === "Other";

  if (raceOtherWrap) raceOtherWrap.hidden = !isOther;
  if (!raceOtherInput) return;

  raceOtherInput.required = isOther;
  if (!isOther) {
    raceOtherInput.value = "";
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

  const raceValue = typeof survey.race === "string" ? survey.race.trim() : "";
  if (raceSelect) {
    if (!raceValue) {
      raceSelect.value = "";
      setValue("raceOther", "");
    } else if (RACE_PRESET_VALUES.has(raceValue)) {
      raceSelect.value = raceValue;
      setValue("raceOther", "");
    } else {
      raceSelect.value = "Other";
      setValue("raceOther", raceValue);
    }
  }

  setValue("disability", survey.disability);
  setValue("sexualOrientation", survey.sexualOrientation);
  setValue("rural", survey.rural);
  setValue("location", survey.location);
  setValue("isUnder30", survey.isUnder30 === true ? "yes" : survey.isUnder30 === false ? "no" : "");
  setValue("discoverySource", survey.discoverySource);
  setValue("friendReferralEmail", survey.friendReferralEmail);
  setValue("cycatReferralEmail", survey.cycatReferralEmail);
  setValue("otherDiscovery", survey.otherDiscovery);

  updateRaceOtherField();
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
raceSelect?.addEventListener("change", updateRaceOtherField);

surveyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  const formData = new FormData(surveyForm);
  const isUnder30Value = String(formData.get("isUnder30") || "").trim().toLowerCase();
  const discovery = String(formData.get("discoverySource") || "").trim();
  const friendReferralEmail = String(formData.get("friendReferralEmail") || "").trim();
  const cycatReferralEmail = String(formData.get("cycatReferralEmail") || "").trim();
  const raceSelection = String(formData.get("raceSelect") || "").trim();
  const raceOther = String(formData.get("raceOther") || "").trim();

  if (isUnder30Value !== "yes" && isUnder30Value !== "no") {
    setMessage("Please indicate whether you are aged below 30.");
    return;
  }

  if (discovery === "friend" && !friendReferralEmail) {
    setMessage("Friend referral email is required.");
    return;
  }

  if (discovery === "cycat" && !cycatReferralEmail) {
    setMessage("Please enter the referring CYCAT member email so they receive the extra ticket.");
    return;
  }

  if (raceSelection === "Other" && !raceOther) {
    setMessage("Please share your race or ethnicity in the Other field, or choose another option.");
    return;
  }

  const race = raceSelection === "Other" ? raceOther : raceSelection || null;

  const payload = {
    isUnder30: isUnder30Value === "yes",
    ageRange: formData.get("ageRange"),
    race,
    disability: formData.get("disability"),
    sexualOrientation: formData.get("sexualOrientation"),
    rural: formData.get("rural"),
    location: formData.get("location"),
    discoverySource: discovery || null,
    friendReferralEmail: discovery === "friend" ? friendReferralEmail : null,
    cycatReferralEmail: discovery === "cycat" ? cycatReferralEmail : null,
    otherDiscovery: discovery === "other" ? formData.get("otherDiscovery") : null
  };

  surveyContinueBtn.disabled = true;

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
  }
});

bootstrap();