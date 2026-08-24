import nodemailer from "nodemailer";

// Plain SMTP, not a specific vendor's SDK — this is the one part of the
// "forgot password" gap that was actually blocked on "pick an email
// provider first" (see the backlog doc). SMTP works with literally any of
// them (Gmail app password, Postmark, Resend, a self-hosted Postfix) via
// the same four env vars, so nothing here has to pick a winner. Unset
// SMTP_HOST = feature disabled, same "clear setup message, not a crash"
// contract as the local-AI option.
export type SendEmailResult = { ok: true } | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

export async function sendEmail(to: string, subject: string, text: string): Promise<SendEmailResult> {
  if (!process.env.SMTP_HOST) {
    return { ok: false, error: "No SMTP_HOST configured — see .env.example." };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
    return { ok: true };
  } catch (err) {
    console.error("sendEmail failed:", err);
    return { ok: false, error: "Failed to send email." };
  }
}
