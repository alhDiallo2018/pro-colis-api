import { prisma } from '../../config/prisma.js';
import { z } from 'zod';
import { dispatchManualMessage, getManualMessage } from './manual-message.service.js';
import { recipientScope } from './recipient-scope.js';
import { userSearchWhere } from '../../utils/user-search.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/api-response.js';
import { ValidationError, normalizeError } from '../../utils/errors.js';
import {
  isBrevoConfiguredAsync,
  describeBrevoConfig,
  sendEmail,
  sendSms,
  invalidateBrevoConfigCache
} from '../../utils/brevo.js';

const BREVO_CONFIG_KEY = 'brevo';

const manualMessageSchema = z.object({
  requestId: z.string().uuid(),
  userId: z.string().uuid(),
  channel: z.enum(['email', 'sms', 'in_app', 'chat']),
  kind: z.enum(['message', 'account_summary']).default('message'),
  subject: z.string().trim().min(1).max(160),
  content: z.string().trim().max(5000).default('')
}).superRefine((value, context) => {
  if (value.kind === 'message' && !value.content) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'Message requis' });
  }
  if (value.channel === 'sms' && value.content.length > 1600) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'SMS limité à 1600 caractères' });
  }
});

// Recherche et pagination précèdent la sélection : les destinataires ne sont
// jamais limités à la première page du répertoire ni fournis avec leurs secrets.
export const listMessageRecipients = handle('notifications.recipients', async (req, res) => {
  const parsed = z.object({ search: z.string().max(200).optional(),
    role: z.enum(['client', 'driver', 'admin', 'super_admin', 'support', 'support_technique', 'support_commercial']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  }).safeParse(req.query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  const { search, role, page, limit } = parsed.data;
  const where = { AND: [recipientScope(req.user), { deletedAt: null, status: { not: 'deleted' } },
    role ? { role } : {}, userSearchWhere(search)] };
  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select: { id: true, fullName: true, email: true, phone: true,
      role: true, city: true, status: true, driverStatus: true, profilePhoto: true, rating: true, completedDeliveries: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit })
  ]);
  return ok(res, { data: { users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
});

export const sendManualMessage = handle('notifications.manualSend', async (req, res) => {
  const parsed = manualMessageSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  const result = await dispatchManualMessage(req.user, parsed.data, req.log);
  return ok(res, { data: { result } });
});

export const manualMessageResult = handle('notifications.manualResult', async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.requestId).success) {
    throw new ValidationError([{ path: 'requestId', message: 'Référence invalide' }]);
  }
  const result = await getManualMessage(req.user.id, req.params.requestId);
  if (!result) return fail(res, { status: 404, message: 'Envoi introuvable', code: 'NOT_FOUND' });
  return ok(res, { data: { result } });
});

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log.error(
        {
          errorType: error.name,
          errorCode: normalized?.code || 'INTERNAL_ERROR',
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

const brevoConfigSchema = z.object({
  apiKey: z.string().trim().max(4096).optional(),
  senderEmail: z.union([z.literal(''), z.string().email()]).optional(),
  senderName: z.string().trim().max(100).optional(),
  smsSender: z.string().trim().max(11).optional()
});

async function storedBrevoConfig() {
  const row = await prisma.systemConfig.findUnique({ where: { key: BREVO_CONFIG_KEY } });
  const stored = row?.value && typeof row.value === 'object' ? row.value : {};
  return describeBrevoConfig(stored);
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

  if (!(await isBrevoConfiguredAsync())) {
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

  if (!(await isBrevoConfiguredAsync())) {
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

  if (!(await isBrevoConfiguredAsync())) {
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
  const parsed = brevoConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  }
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
  // Les anciennes interfaces peuvent renvoyer une cle masquee apres lecture.
  // Ignorer ce masque conserve la vraie cle ; une chaine vide retire la surcharge.
  if (patch.apiKey?.includes('****')) delete patch.apiKey;

  // Une chaine vide demande le repli vers l'environnement. Sans cle serveur,
  // ce choix couperait les emails/OTP : refuser avant toute ecriture en base.
  if (patch.apiKey === '' && !describeBrevoConfig({}).environmentApiKeyConfigured) {
    throw new ValidationError([{ path: 'apiKey', message: 'Aucune clé Brevo serveur disponible. Conservez la clé enregistrée ou renseignez une nouvelle clé.' }]);
  }

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

  const config = describeBrevoConfig(value);
  return ok(res, { message: 'Configuration Brevo mise a jour', data: { config } });
});

export const testBrevoConnection = handle('notifications.brevoTest', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    throw new ValidationError([{ path: 'body.email', message: 'Email de test requis' }]);
  }

  if (!(await isBrevoConfiguredAsync())) {
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
