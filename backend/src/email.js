import sgMail from "@sendgrid/mail";

const apiKey = process.env.SENDGRID_API_KEY;
const sender = process.env.SENDGRID_FROM;

export function canSendEmail() {
  return Boolean(apiKey && sender);
}

export function configureEmail() {
  if (!apiKey) return;
  sgMail.setApiKey(apiKey);
}

export async function sendEmail({ to, subject, html, text }) {
  if (!apiKey || !sender) {
    throw new Error("SendGrid is not configured");
  }

  await sgMail.send({
    to,
    from: sender,
    subject,
    html,
    text
  });
}
