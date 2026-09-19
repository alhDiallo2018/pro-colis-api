import 'dotenv/config';
import { z } from 'zod';

const DURATION = z
  .string()
  .regex(/^\d+[smhd]?$/, 'Duree attendue au format 900, 15m, 12h ou 30d');

// Secrets JWT : longueur minimale exigee en production. En developpement/test,
// le schema de base (min 16) suffit pour autoriser une configuration locale.
const PROD_JWT_SECRET_MIN_LENGTH = 32;

// Placeholders connus a rejeter en production. Un secret de production ne doit
// jamais etre une valeur par defaut recopiable depuis un exemple ou un README.
const JWT_SECRET_PLACEHOLDERS = [
  'change-me',
  'change_me',
  'changeme',
  'change-this',
  'changethis',
  'replace-me',
  'replace_me',
  'replaceme',
  'replace-this',
  'your-secret',
  'your_secret',
  'yoursecret',
  'placeholder',
  'example-secret',
  'dev-secret'
];

function isPlaceholderJwtSecret(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return true;
  return JWT_SECRET_PLACEHOLDERS.some((placeholder) => normalized.includes(placeholder));
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  // Format contraint a `<nombre><s|m|h|d>` (ou un nombre de secondes brut) :
  // `expiresAt` en base doit etre calcule a partir de la meme chaine que le
  // JWT, et une valeur exotique produirait une date invalide au lieu d'une
  // erreur au demarrage.
  JWT_ACCESS_EXPIRES_IN: DURATION.default('15m'),
  JWT_REFRESH_EXPIRES_IN: DURATION.default('30d'),
  // Les comptes staff voient toutes les donnees de la plateforme : leur session
  // se ferme en heures la ou celle d'un client dure des semaines.
  JWT_REFRESH_EXPIRES_IN_STAFF: DURATION.default('12h'),
  // Delai d'inactivite au-dela duquel la session est fermee, independamment de
  // la duree de vie du refresh token. C'est ce delai, et non l'expiration du
  // jeton, qui protege un poste laisse ouvert sans surveillance.
  SESSION_IDLE_TIMEOUT: DURATION.default('1m'),
  OTP_EXPIRES_MINUTES: z.coerce.number().int().positive().default(10),
  UPLOAD_STORAGE: z.enum(['local', 's3']).default('local'),
  UPLOAD_LOCAL_DIR: z.string().default('uploads'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  // Origine du frontend web, utilisée pour les redirections post-paiement
  // (PayDunya return/cancel). Ne doit jamais être une URL locale en production.
  WEB_APP_URL: z.string().url().default('https://sendprocolis.com'),
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
  // Numéro de compte marchand PayDunya à débiter lors d'un déboursement compte à
  // compte (`withdraw_mode: paydunya`). Laissé vide, PayDunya débite le compte
  // marchand par défaut du pays du bénéficiaire — qui peut ne pas être celui
  // réellement approvisionné, d'où une erreur 4002 « fonds insuffisants ».
  PAYDUNYA_DEBIT_ACCOUNT_NUMBER: z.string().optional(),
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
  // --- Notifications push (Firebase Cloud Messaging) ---
  // Compte de service Google, fourni soit par chemin de fichier, soit inline
  // (conteneur sans volume montable). Absent, les push sont desactivees sans
  // empecher l'API de demarrer.
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
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

  // En production, les secrets JWT doivent etre forts, non vides et differents
  // des placeholders recopiables. En developpement/test on reste permissif pour
  // ne pas imposer de vrai secret dans le depot ni casser les tests.
  if (value.NODE_ENV === 'production') {
    for (const field of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const secret = value[field];
      if (isPlaceholderJwtSecret(secret)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} ne doit pas etre vide ni utiliser un placeholder en production`
        });
      } else if (secret.length < PROD_JWT_SECRET_MIN_LENGTH) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} doit contenir au moins ${PROD_JWT_SECRET_MIN_LENGTH} caracteres en production`
        });
      }
    }

    if (
      !isPlaceholderJwtSecret(value.JWT_ACCESS_SECRET) &&
      !isPlaceholderJwtSecret(value.JWT_REFRESH_SECRET) &&
      value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent etre differents en production'
      });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a bad runtime configuration is safer to stop than to run partially.
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
