import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';

// La config Brevo vit dans SystemConfig (cle "brevo"), modifiable par l'admin
// depuis l'interface sans toucher au serveur. Les variables d'env ne servent
// que de valeurs par defaut. Snapshot en memoire (TTL 30s) pour garder les
// accesseurs synchrones ; invalide immediatement apres une mise a jour admin.
const BREVO_CONFIG_KEY = 'brevo';
const CONFIG_TTL_MS = 30_000;

let dbConfig = null;
let loadedAt = 0;
let loading = null;
let client = null;
let clientKey = null;

async function loadDbConfig(force = false) {
  const stale = force || dbConfig === null || Date.now() - loadedAt > CONFIG_TTL_MS;
  if (!stale) return dbConfig;
  if (!loading) {
    loading = prisma.systemConfig
      .findUnique({ where: { key: BREVO_CONFIG_KEY } })
      .then((row) => {
        dbConfig = row?.value && typeof row.value === 'object' ? row.value : {};
        loadedAt = Date.now();
        return dbConfig;
      })
      .catch(() => {
        // DB indisponible : on retombe sur l'env sans casser l'appelant.
        dbConfig = dbConfig ?? {};
        loadedAt = Date.now();
        return dbConfig;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export function invalidateBrevoConfigCache() {
  dbConfig = null;
  loadedAt = 0;
  client = null;
  clientKey = null;
}

function snapshot() {
  void loadDbConfig(); // rafraichissement paresseux en arriere-plan
  return dbConfig ?? {};
}

function currentApiKey() {
  return snapshot().apiKey || env.BREVO_API_KEY || null;
}

async function getClient() {
  await loadDbConfig();
  const key = currentApiKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = new BrevoClient({ apiKey: key, timeoutInSeconds: 15 });
    clientKey = key;
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
  return !!currentApiKey();
}

export function getSenderEmail() {
  return snapshot().senderEmail || env.BREVO_SENDER_EMAIL || 'noreply@sendprocolis.com';
}

export function getSenderName() {
  return snapshot().senderName || env.BREVO_SENDER_NAME || 'PRO COLIS';
}

export function getSmsSender() {
  return snapshot().smsSender || env.BREVO_SMS_SENDER || 'ProColis';
}

export async function sendEmail({ to, subject, htmlContent, textContent, params }) {
  const brevo = await getClient();
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

export async function sendSms({ to, content, tag, sender }) {
  const brevo = await getClient();
  if (!brevo) return null;

  const recipient = cleanPhone(to);
  if (!recipient) return null;

  try {
    const result = await brevo.transactionalSms.sendTransacSms({
      sender: sender || getSmsSender(),
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

export async function sendNotificationSms({ phone, message, tag, sender }) {
  return sendSms({ to: phone, content: message, tag, sender });
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
