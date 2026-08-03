import pino from 'pino';
import { env } from './env.js';

const sensitiveKeys = [
  'password',
  'currentPassword',
  'newPassword',
  'pin',
  'currentPin',
  'newPin',
  'otpCode',
  'code',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'privateKey',
  'masterKey',
  'file',
  'base64',
  'phone',
  'senderPhone',
  'receiverPhone',
  'email',
  'senderEmail',
  'receiverEmail',
  'address',
  'senderAddress',
  'receiverAddress',
  'fullName',
  'firstName',
  'lastName',
  'vehiclePlate',
  'latitude',
  'longitude'
];

const normalizedSensitiveKeys = new Set(
  sensitiveKeys.map((key) => key.replace(/[^a-z0-9]/gi, '').toLowerCase())
);

function isSensitiveKey(key) {
  return normalizedSensitiveKeys.has(String(key).replace(/[^a-z0-9]/gi, '').toLowerCase());
}

function sanitizeValue(value, seen, parentKey = '') {
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
      .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
      .replace(/\+\d(?:[\s().-]?\d){7,14}\b/g, '[REDACTED_PHONE]');
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  // Les proprietes utiles d'Error ne sont pas enumerables. Les copier
  // explicitement evite les objets `{}` dans Loki tout en preservant la stack.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeValue(value.message, seen, 'message'),
      ...(value.code !== undefined ? { code: value.code } : {}),
      ...(value.stack ? { stack: sanitizeValue(value.stack, seen, 'stack') } : {})
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, parentKey));
  }

  return Object.entries(value).reduce((safe, [key, item]) => {
    const normalizedKey = String(key).toLowerCase();
    const normalizedParent = String(parentKey).toLowerCase();
    const isDiagnosticCode = normalizedKey === 'code' && ['error', 'err'].includes(normalizedParent);
    safe[key] = isSensitiveKey(key) && !isDiagnosticCode
      ? '[REDACTED]'
      : sanitizeValue(item, seen, key);
    return safe;
  }, {});
}

export function sanitizeForLog(value) {
  return sanitizeValue(value, new WeakSet());
}

const severityByPinoLevel = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'critical'
};

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'api',
    environment: env.NODE_ENV,
    release: env.APP_RELEASE
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label, number) {
      return { level: number, severity: severityByPinoLevel[label] || label };
    }
  },
  serializers: {
    err(value) {
      return sanitizeForLog({ err: pino.stdSerializers.err(value) }).err;
    },
    error(value) {
      return sanitizeForLog({ error: pino.stdSerializers.err(value) }).error;
    }
  },
  redact: {
    paths: sensitiveKeys.filter((key) => key !== 'code').flatMap((key) => [
      key,
      `*.${key}`,
      `*.*.${key}`,
      `*.*.*.${key}`
    ]),
    censor: '[REDACTED]'
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard'
          }
        }
      : undefined
});
