import { z } from 'zod';

const versionCode = z.coerce.number().int().min(0).max(2100000000);
const boolean = z.enum(['true', 'false']).transform(value => value === 'true');

export const appUpdateEnvShape = {
  MOBILE_ANDROID_UPDATE_ENABLED: boolean.default('false'),
  // La version lisible sert uniquement a l'affichage. Seul versionCode ordonne
  // les APK Android, meme si le nom commercial change de format.
  MOBILE_ANDROID_LATEST_VERSION: z.string().trim().min(1).max(64).default('1.0.0'),
  MOBILE_ANDROID_LATEST_VERSION_CODE: versionCode.default(6),
  MOBILE_ANDROID_MIN_VERSION_CODE: versionCode.default(0),
  MOBILE_ANDROID_RELEASE_NOTES_FR: z.string().trim().max(4000).default(''),
  MOBILE_ANDROID_RELEASE_NOTES_EN: z.string().trim().max(4000).default(''),
  MOBILE_ANDROID_REMIND_AFTER_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  MOBILE_ANDROID_UPDATE_URL: z.string().url().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Lien de mise a jour HTTPS sans identifiants requis')
    .default('https://play.google.com/store/apps/details?id=com.sendprocolis.app')
};

export function validateAppUpdateEnv(value, context) {
  if (value.MOBILE_ANDROID_MIN_VERSION_CODE > value.MOBILE_ANDROID_LATEST_VERSION_CODE) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MOBILE_ANDROID_MIN_VERSION_CODE'],
      message: 'Le code minimal ne doit pas depasser le dernier code disponible'
    });
  }
  if (value.MOBILE_ANDROID_UPDATE_ENABLED && value.MOBILE_ANDROID_LATEST_VERSION_CODE === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MOBILE_ANDROID_LATEST_VERSION_CODE'],
      message: 'Un code de version positif est requis pour activer les mises a jour'
    });
  }
}

export const appUpdateEnvSchema = z.object(appUpdateEnvShape).superRefine(validateAppUpdateEnv);

// Liste explicite : ne jamais exposer l'objet env complet sur une route publique.
export function publicAndroidUpdatePolicy(env) {
  return {
    enabled: env.MOBILE_ANDROID_UPDATE_ENABLED,
    latestVersion: env.MOBILE_ANDROID_LATEST_VERSION,
    latestVersionCode: env.MOBILE_ANDROID_LATEST_VERSION_CODE,
    minVersionCode: env.MOBILE_ANDROID_MIN_VERSION_CODE,
    releaseNotes: {
      fr: env.MOBILE_ANDROID_RELEASE_NOTES_FR,
      en: env.MOBILE_ANDROID_RELEASE_NOTES_EN
    },
    remindAfterHours: env.MOBILE_ANDROID_REMIND_AFTER_HOURS,
    updateUrl: env.MOBILE_ANDROID_UPDATE_URL
  };
}
