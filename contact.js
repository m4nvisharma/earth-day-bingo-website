const contactForm = document.getElementById("contactForm");
const contactMessage = document.getElementById("contactMessage");
const contactEmail = window.CONTACT_EMAIL || "info@cycat.ca";

function setMessage(text) {
  if (contactMessage) contactMessage.textContent = text;
}

if (contactForm) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setMessage("");
    const formData = new FormData(contactForm);
    const name = formData.get("name");
    const email = formData.get("email");
    const message = formData.get("message");

    const subject = encodeURIComponent("Earth Day Bingo inquiry");
    const body = encodeURIComponent(`From: ${name} (${email})\n\n${message}`);
    window.location.href = `mailto:${contactEmail}?subject=${subject}&body=${body}`;
    setMessage(`Opening your email client to contact ${contactEmail}.`);
  });
}
