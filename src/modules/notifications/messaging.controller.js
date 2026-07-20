import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/api-response.js';
import { ValidationError, normalizeError } from '../../utils/errors.js';
import {
  isBrevoConfigured,
  sendEmail,
  sendSms,
  getSenderEmail,
  getSenderName,
  getSmsSender,
  invalidateBrevoConfigCache
} from '../../utils/brevo.js';

const BREVO_CONFIG_KEY = 'brevo';

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log.error(
        {
          error,
          action,
          userId: req.user?.id,
          role: req.user?.role,
          requestId: req.requestId
        },
        `Messaging endpoint failed: ${action}`
      );

      return fail(res, {
        status: normalized?.statusCode || 500,
        message:
          normalized?.publicMessage ||
          (env.NODE_ENV === 'production' ? 'Operation impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || []
      });
    }
  };
}

function defaultBrevoConfig() {
  return {
    provider: 'brevo',
    apiKey: env.BREVO_API_KEY || '',
    senderEmail: getSenderEmail(),
    senderName: getSenderName(),
    smsSender: getSmsSender()
  };
}

async function storedBrevoConfig() {
  const row = await prisma.systemConfig.findUnique({ where: { key: BREVO_CONFIG_KEY } });
  const stored = row?.value && typeof row.value === 'object' ? row.value : {};
  return { ...defaultBrevoConfig(), ...stored };
}

// ------------------------------------------------------------------
// Envois SMS / email (Brevo)
// ------------------------------------------------------------------

export const sendSmsMessage = handle('notifications.smsSend', async (req, res) => {
  const { to, content } = req.body;
  if (!to || !content) {
    throw new ValidationError([
      { path: 'body.to', message: 'Destinataire (to) et contenu (content) requis' }
    ]);
  }

  if (!isBrevoConfigured()) {
    return fail(res, { status: 503, message: 'Brevo non configure', code: 'BREVO_NOT_CONFIGURED' });
  }

  const result = await sendSms({ to, content, tag: req.body.tag || 'manual', sender: req.body.senderName || req.body.sender });
  if (!result) {
    return fail(res, { status: 502, message: 'Echec de l\'envoi du SMS', code: 'SMS_SEND_FAILED' });
  }

  return ok(res, {
    message: 'SMS envoye',
    data: { messageId: result.messageId ?? result.reference ?? null }
  });
});

export const sendEmailMessage = handle('notifications.emailSend', async (req, res) => {
  const { to, subject, htmlContent, textContent, params } = req.body;
  if (!to || !subject || !htmlContent) {
    throw new ValidationError([
      { path: 'body', message: 'Champs to, subject et htmlContent requis' }
    ]);
  }

  if (!isBrevoConfigured()) {
    return fail(res, { status: 503, message: 'Brevo non configure', code: 'BREVO_NOT_CONFIGURED' });
  }

  const result = await sendEmail({ to, subject, htmlContent, textContent, params });
  if (!result) {
    return fail(res, { status: 502, message: 'Echec de l\'envoi de l\'email', code: 'EMAIL_SEND_FAILED' });
  }

  return ok(res, {
    message: 'Email envoye',
    data: { messageId: result.messageId ?? null }
  });
});

export const sendBulkEmailMessage = handle('notifications.emailSendBulk', async (req, res) => {
  const { recipients, subject, htmlContent } = req.body;
  if (!Array.isArray(recipients) || recipients.length === 0 || !subject || !htmlContent) {
    throw new ValidationError([
      { path: 'body', message: 'Champs recipients (liste), subject et htmlContent requis' }
    ]);
  }

  if (!isBrevoConfigured()) {
    return fail(res, { status: 503, message: 'Brevo non configure', code: 'BREVO_NOT_CONFIGURED' });
  }

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const email = typeof recipient === 'string' ? recipient : recipient?.email;
    if (!email) {
      failed += 1;
      continue;
    }
    const result = await sendEmail({ to: email, subject, htmlContent });
    if (result) sent += 1;
    else failed += 1;
  }

  return ok(res, {
    message: `Emails envoyes : ${sent}/${recipients.length}`,
    data: { sent, failed, total: recipients.length }
  });
});

// ------------------------------------------------------------------
// Configuration Brevo (super admin) — stockee dans SystemConfig (cle "brevo")
// ------------------------------------------------------------------

export const getBrevoConfig = handle('notifications.brevoConfigGet', async (_req, res) => {
  const config = await storedBrevoConfig();
  return ok(res, { message: 'Configuration Brevo', data: { config } });
});

export const updateBrevoConfig = handle('notifications.brevoConfigUpdate', async (req, res) => {
  const allowed = ['apiKey', 'senderEmail', 'senderName', 'smsSender'];
  const patch = Object.fromEntries(
    allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]])
  );

  if (Object.keys(patch).length === 0) {
    throw new ValidationError([{ path: 'body', message: 'Au moins un parametre requis' }]);
  }

  const row = await prisma.systemConfig.findUnique({ where: { key: BREVO_CONFIG_KEY } });
  const previous = row?.value && typeof row.value === 'object' ? row.value : {};
  const value = { provider: 'brevo', ...previous, ...patch };

  await prisma.$transaction([
    prisma.systemConfig.upsert({
      where: { key: BREVO_CONFIG_KEY },
      update: { value, updatedBy: req.user.id, updatedAt: new Date() },
      create: { key: BREVO_CONFIG_KEY, value, updatedBy: req.user.id }
    }),
    prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'notifications.brevoConfigUpdate',
        entityType: 'system_config',
        afterData: { keys: Object.keys(patch) },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      }
    })
  ]);

  // La config en base prime sur l'env : prise en compte immédiate pour les envois.
  invalidateBrevoConfigCache();

  const config = { ...defaultBrevoConfig(), ...value };
  return ok(res, { message: 'Configuration Brevo mise a jour', data: { config } });
});

export const testBrevoConnection = handle('notifications.brevoTest', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    throw new ValidationError([{ path: 'body.email', message: 'Email de test requis' }]);
  }

  if (!isBrevoConfigured()) {
    return fail(res, { status: 503, message: 'Brevo non configure', code: 'BREVO_NOT_CONFIGURED' });
  }

  const result = await sendEmail({
    to: email,
    subject: '[PRO COLIS] Test de configuration Brevo',
    htmlContent:
      '<p>Ceci est un email de test envoye depuis le back-office PRO COLIS pour verifier la configuration Brevo.</p>'
  });

  if (!result) {
    return fail(res, { status: 502, message: 'Echec de l\'envoi de l\'email de test', code: 'EMAIL_SEND_FAILED' });
  }

  return ok(res, { message: 'Email de test envoye', data: { messageId: result.messageId ?? null } });
});

// ------------------------------------------------------------------
// Tokens push des appareils (FCM)
// ------------------------------------------------------------------

export const registerDeviceToken = handle('notifications.deviceToken', async (req, res) => {
  const { token, platform } = req.body;
  if (!token || typeof token !== 'string') {
    throw new ValidationError([{ path: 'body.token', message: 'Token requis' }]);
  }

  const deviceToken = await prisma.deviceToken.upsert({
    where: { token },
    update: { userId: req.user.id, platform: platform || null },
    create: { userId: req.user.id, token, platform: platform || null }
  });

  return ok(res, {
    status: 201,
    message: 'Token appareil enregistre',
    data: {
      deviceToken: {
        id: deviceToken.id,
        platform: deviceToken.platform,
        updatedAt: deviceToken.updatedAt.toISOString()
      }
    }
  });
});
