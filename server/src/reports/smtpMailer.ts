import nodemailer from "nodemailer";
import type { Mailer } from "./types.js";

/** Email through the company mail server. Returns null when SMTP is not configured. */
export function smtpMailerFromEnv(env = process.env): Mailer | null {
  if (!env.SMTP_HOST || !env.MAIL_FROM) return null;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 587),
    secure: env.SMTP_SECURE === "true",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({
        from: env.MAIL_FROM,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        attachments: [{ filename: mail.attachment.filename, content: mail.attachment.content, contentType: "text/html; charset=utf-8" }],
      });
    },
  };
}
