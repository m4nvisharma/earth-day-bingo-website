const API_BASE = window.API_BASE || "https://your-backend.onrender.com";

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authMessage = document.getElementById("authMessage");
const forgotPasswordToggle = document.getElementById("forgotPasswordToggle");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const forgotPasswordCancel = document.getElementById("forgotPasswordCancel");

if (forgotPasswordForm) {
  forgotPasswordForm.hidden = true;
}

function setMessage(text) {
  authMessage.textContent = text;
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function isValidUsername(value) {
  return /^[a-zA-Z0-9]{4,}$/.test(value);
}

async function handleAuth(endpoint, payload) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  localStorage.setItem("token", data.token);
  localStorage.setItem("displayName", data.user.displayName);
  if (data.user.username) {
    localStorage.setItem("username", data.user.username);
  }
  localStorage.setItem("userEmail", data.user.email);
  window.location.href = "app.html";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  const formData = new FormData(loginForm);
  try {
    await handleAuth("/api/auth/login", {
      email: formData.get("email"),
      password: formData.get("password")
    });
  } catch (error) {
    setMessage(error.message);
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  const formData = new FormData(signupForm);
  const username = normalizeUsername(formData.get("username"));
  if (!isValidUsername(username)) {
    setMessage("Username must be at least 4 characters and contain only letters and numbers.");
    return;
  }
  try {
    await handleAuth("/api/auth/signup", {
      username,
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      password: formData.get("password")
    });
  } catch (error) {
    setMessage(error.message);
  }
});

if (forgotPasswordToggle && forgotPasswordForm) {
  forgotPasswordToggle.addEventListener("click", () => {
    loginForm.hidden = true;
    signupForm.hidden = true;
    forgotPasswordForm.hidden = false;
    setMessage("");
  });
}

if (forgotPasswordCancel && forgotPasswordForm) {
  forgotPasswordCancel.addEventListener("click", () => {
    loginForm.hidden = false;
    signupForm.hidden = false;
    forgotPasswordForm.hidden = true;
    setMessage("");
  });
}

if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");
    const formData = new FormData(forgotPasswordForm);
    try {
      const response = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.get("email") })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }
      setMessage("If that email exists, a reset link is on the way.");
    } catch (error) {
      setMessage(error.message);
    }
  });
}
