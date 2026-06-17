// ── Envío de correo ───────────────────────────────────────────────────
// Dos transportes seleccionables por MAIL_TRANSPORT:
//   - "smtp"    : envío real vía nodemailer (producción). Rellena SMTP_* en .env.
//   - "console" : NO envía. Renderiza el email a ./outbox/*.html para
//                 previsualizar y registra el enlace en el log (desarrollo).
import { writeFileSync, mkdirSync } from "node:fs";
import { config } from "./env.js";
import { verificationEmail, invitationEmail } from "./emails.js";

interface Mail { to: string; subject: string; html: string; text: string; }

let smtp: any = null;
async function getSmtp() {
  if (smtp) return smtp;
  const nodemailer = await import("nodemailer");
  smtp = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
  });
  return smtp;
}

async function deliver(mail: Mail, log: (m: string) => void) {
  if (config.mailTransport === "smtp") {
    const t = await getSmtp();
    await t.sendMail({ from: config.mailFrom, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
    log(`Email enviado a ${mail.to} (SMTP)`);
    return;
  }
  // Demo: guarda una previsualización en disco en lugar de enviar.
  try { mkdirSync(new URL("../outbox/", import.meta.url), { recursive: true }); } catch {}
  const file = new URL(`../outbox/${Date.now()}-${mail.to.replace(/[^a-z0-9]/gi, "_")}.html`, import.meta.url);
  writeFileSync(file, mail.html);
  log(`[DEMO] Email no enviado. Previsualización: ${file.pathname}`);
}

export const mailer = {
  async sendVerification(to: string, name: string, token: string, log: (m: string) => void) {
    const link = `${config.apiUrl.replace(/\/$/, "")}/v1/auth/verify-email?token=${token}`;
    const { subject, html, text } = verificationEmail(name, link, config.verifyTtlHours);
    await deliver({ to, subject, html, text }, log);
    return link;
  },

  async sendInvitation(to: string, name: string, specialty: string, token: string, log: (m: string) => void) {
    const link = `${config.appUrl.replace(/\/$/, "")}/invitacion?token=${token}`;
    const { subject, html, text } = invitationEmail(name, specialty, link, config.verifyTtlHours);
    await deliver({ to, subject, html, text }, log);
    return link;
  },
};
