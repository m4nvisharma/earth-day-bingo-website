const API_BASE = window.API_BASE || "https://your-backend.onrender.com";
const resetForm = document.getElementById("resetForm");
const resetMessage = document.getElementById("resetMessage");

function setResetMessage(text) {
  resetMessage.textContent = text;
}

function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setResetMessage("");
  const formData = new FormData(resetForm);
  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");

  if (password !== confirmPassword) {
    setResetMessage("Passwords do not match.");
    return;
  }

  const token = getToken();
  if (!token) {
    setResetMessage("Missing reset token. Use the link from your email.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Password reset failed");
    }

    setResetMessage("Password updated. You can log in now.");
    resetForm.reset();
  } catch (error) {
    setResetMessage(error.message);
  }
});
