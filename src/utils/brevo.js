import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config/env.js';

let client = null;

function getClient() {
  if (!client && env.BREVO_API_KEY) {
    client = new BrevoClient({
      apiKey: env.BREVO_API_KEY,
      timeoutInSeconds: 15
    });
  }
  return client;
}

function cleanPhone(phone) {
  if (!phone) return null;
  return phone.replace(/^\+/, '').replace(/\s/g, '');
}

function cleanEmail(email) {
  if (!email) return null;
  return email.trim().toLowerCase();
}

export function isBrevoConfigured() {
  return !!env.BREVO_API_KEY;
}

export function getSenderEmail() {
  return env.BREVO_SENDER_EMAIL || 'noreply@sendprocolis.com';
}

export function getSenderName() {
  return env.BREVO_SENDER_NAME || 'PRO COLIS';
}

export function getSmsSender() {
  return env.BREVO_SMS_SENDER || 'ProColis';
}

export async function sendEmail({ to, subject, htmlContent, textContent, params }) {
  const brevo = getClient();
  if (!brevo) return null;

  const recipientEmail = cleanEmail(to);
  if (!recipientEmail) return null;

  try {
    const result = await brevo.transactionalEmails.sendTransacEmail({
      sender: { email: getSenderEmail(), name: getSenderName() },
      to: [{ email: recipientEmail }],
      subject,
      htmlContent,
      textContent: textContent || htmlContent?.replace(/<[^>]*>/g, ''),
      params
    });
    return result;
  } catch (err) {
    // Fire-and-forget: log but don't throw
    console.error('[Brevo] Failed to send email:', err.message || err);
    return null;
  }
}

export async function sendSms({ to, content, tag }) {
  const brevo = getClient();
  if (!brevo) return null;

  const recipient = cleanPhone(to);
  if (!recipient) return null;

  try {
    const result = await brevo.transactionalSms.sendTransacSms({
      sender: getSmsSender(),
      recipient,
      content,
      type: 'transactional',
      tag: tag || 'notification'
    });
    return result;
  } catch (err) {
    console.error('[Brevo] Failed to send SMS:', err.message || err);
    return null;
  }
}

export async function sendNotificationSms({ phone, message, tag }) {
  return sendSms({ to: phone, content: message, tag });
}

export async function sendNotificationEmail({ email, subject, message }) {
  return sendEmail({
    to: email,
    subject,
    htmlContent: `<p>${message}</p>`
  });
}

export async function sendOtpSms({ phone, code, purpose }) {
  const content = `[PRO COLIS] Votre code de verification ${purpose ? `(${purpose}) ` : ''}est : ${code}. Ne le partagez avec personne.`;
  return sendSms({ to: phone, content, tag: 'otp' });
}

export async function sendOtpEmail({ email, code, purpose }) {
  const subject = `[PRO COLIS] Votre code de verification`;
  const htmlContent = `<p>Votre code de verification${purpose ? ` (${purpose})` : ''} est :</p><h2>${code}</h2><p>Ne le partagez avec personne.</p>`;
  return sendEmail({ to: email, subject, htmlContent });
}
