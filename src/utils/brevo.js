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
let configGeneration = 0;
let client = null;
let clientKey = null;

async function loadDbConfig(force = false) {
  const stale = force || dbConfig === null || Date.now() - loadedAt > CONFIG_TTL_MS;
  if (!stale) return dbConfig;
  const generation = configGeneration;
  if (!loading) {
    const request = prisma.systemConfig
      .findUnique({ where: { key: BREVO_CONFIG_KEY } })
      .then((row) => {
        const value = row?.value && typeof row.value === 'object' ? row.value : {};
        if (generation === configGeneration) {
          dbConfig = value;
          loadedAt = Date.now();
        }
        return value;
      })
      .catch(() => {
        // Une panne de lecture conserve le dernier snapshot de cette generation,
        // ou utilise l'environnement si aucune configuration n'a ete chargee.
        if (generation === configGeneration) {
          dbConfig = dbConfig ?? {};
          loadedAt = Date.now();
        }
        return dbConfig ?? {};
      })
      .finally(() => {
        if (loading === request) loading = null;
      });
    loading = request;
  }
  const value = await loading;
  // Une lecture demarree avant un enregistrement admin ne doit pas restaurer
  // l'ancienne cle ni determiner la disponibilite avec un snapshot obsolete.
  return generation === configGeneration ? value : loadDbConfig();
}

export function invalidateBrevoConfigCache() {
  configGeneration += 1;
  loading = null;
  dbConfig = null;
  loadedAt = 0;
  client = null;
  clientKey = null;
}

function snapshot() {
  void loadDbConfig(); // rafraichissement paresseux en arriere-plan
  return dbConfig ?? {};
}

const setting = value => typeof value === 'string' ? value.trim() : '';

// Les valeurs non vides en base priment, champ par champ. Une valeur vide
// retire la surcharge admin et retrouve la configuration de l'environnement.
export function resolveBrevoConfig(stored = {}) {
  return {
    provider: 'brevo',
    apiKey: setting(stored.apiKey) || setting(env.BREVO_API_KEY),
    senderEmail: setting(stored.senderEmail) || setting(env.BREVO_SENDER_EMAIL) || 'noreply@sendprocolis.com',
    senderName: setting(stored.senderName) || setting(env.BREVO_SENDER_NAME) || 'PRO COLIS',
    smsSender: setting(stored.smsSender) || setting(env.BREVO_SMS_SENDER) || 'ProColis'
  };
}

export function describeBrevoConfig(stored = {}) {
  const effective = resolveBrevoConfig(stored);
  const databaseKey = Boolean(setting(stored.apiKey));
  const environmentKey = Boolean(setting(env.BREVO_API_KEY));
  // Conserver le champ apiKey pour les clients existants, mais jamais sa valeur.
  return { ...effective, apiKey: effective.apiKey ? '********' : '',
    apiKeyConfigured: Boolean(effective.apiKey),
    apiKeySource: databaseKey ? 'database' : environmentKey ? 'environment' : 'none',
    environmentApiKeyConfigured: environmentKey };
}

function currentApiKey() {
  return resolveBrevoConfig(snapshot()).apiKey || null;
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

/** Les decisions d'envoi doivent attendre la configuration en base : le
 * snapshot synchrone peut etre vide juste apres un redemarrage de l'API.
 */
export async function isBrevoConfiguredAsync() {
  await loadDbConfig();
  return !!currentApiKey();
}

export function getSenderEmail() {
  return resolveBrevoConfig(snapshot()).senderEmail;
}

export function getSenderName() {
  return resolveBrevoConfig(snapshot()).senderName;
}

export function getSmsSender() {
  return resolveBrevoConfig(snapshot()).smsSender;
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
