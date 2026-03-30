const API_BASE = window.API_BASE || "https://your-backend.onrender.com";

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authMessage = document.getElementById("authMessage");

function setMessage(text) {
  authMessage.textContent = text;
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
  try {
    await handleAuth("/api/auth/signup", {
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      password: formData.get("password")
    });
  } catch (error) {
    setMessage(error.message);
  }
});
