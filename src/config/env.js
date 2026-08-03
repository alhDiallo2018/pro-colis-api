import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  OTP_EXPIRES_MINUTES: z.coerce.number().int().positive().default(10),
  UPLOAD_STORAGE: z.enum(['local', 's3']).default('local'),
  UPLOAD_LOCAL_DIR: z.string().default('uploads'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  LOG_LEVEL: z.string().default('info'),
  APP_RELEASE: z.string().min(1).default('development'),
  LOKI_BASE_URL: z.string().url().default('http://loki:3100'),
  PROMETHEUS_BASE_URL: z.string().url().default('http://prometheus:9090'),
  OBSERVABILITY_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  METRICS_TOKEN: z.string().optional(),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  PAYDUNYA_MASTER_KEY: z.string().optional(),
  PAYDUNYA_PRIVATE_KEY: z.string().optional(),
  PAYDUNYA_TOKEN: z.string().optional(),
  PAYDUNYA_MODE: z.enum(['test', 'live']).default('test'),
  PAYDUNYA_STORE_NAME: z.string().default('ProColis'),
  PAYDUNYA_DISBURSE_BASE_URL: z.string().url().default('https://app.paydunya.com/api/v2/disburse'),
  // Montant minimum accepté par les canaux PayDunya (XOF). Encaissement (pay-in)
  // et déboursement (pay-out) refusent en dessous de ce seuil.
  PAYDUNYA_MIN_AMOUNT: z.coerce.number().int().positive().default(200),
  PAYDUNYA_MIN_WITHDRAWAL: z.coerce.number().int().positive().default(500),
  // Si "true", un chauffeur doit avoir son identité vérifiée (isVerified) pour
  // enchérir / publier une annonce. Mettre à "true" quand la revue KYC est prête.
  REQUIRE_DRIVER_VERIFICATION: z.string().default('false').transform((v) => v === 'true'),
  // --- Sauvegardes PostgreSQL ---
  // Répertoire des dumps. Doit pointer sur un volume persistant, sinon les
  // sauvegardes disparaissent avec le conteneur.
  BACKUP_DIR: z.string().default('backups'),
  // Nombre de dumps conservés : au-delà, les plus anciens sont purgés après
  // chaque sauvegarde réussie.
  BACKUP_RETENTION: z.coerce.number().int().min(1).max(365).default(7),
  // Une restauration écrase la base entière : elle exige un opt-in explicite du
  // déploiement, en plus de la confirmation envoyée par l'appelant.
  BACKUP_ALLOW_RESTORE: z.string().default('false').transform((v) => v === 'true'),
  // Chemins des binaires clients PostgreSQL, surchargeables quand ils ne sont
  // pas dans le PATH (poste de développement, image sans postgresql-client).
  PG_DUMP_BIN: z.string().default('pg_dump'),
  PG_RESTORE_BIN: z.string().default('pg_restore'),
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().optional(),
  BREVO_SENDER_NAME: z.string().optional(),
  BREVO_SMS_SENDER: z.string().optional()
}).superRefine((value, context) => {
  // La route de metriques reste hors de Caddy, mais un token fort limite aussi
  // les acces accidentels depuis un autre conteneur du reseau de production.
  if (value.NODE_ENV === 'production' && (!value.METRICS_TOKEN || value.METRICS_TOKEN.length < 32)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['METRICS_TOKEN'],
      message: 'METRICS_TOKEN doit contenir au moins 32 caracteres en production'
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a bad runtime configuration is safer to stop than to run partially.
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
