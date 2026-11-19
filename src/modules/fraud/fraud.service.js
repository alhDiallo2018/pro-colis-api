/**
 * Fraud module — service layer.
 *
 * Deux responsabilités :
 *
 *  1. Agréger pour un utilisateur donné les six signaux attendus par
 *     `scoreFraud` (service pur, voir `src/utils/fraud-scoring.js`) à partir
 *     des tables Prisma.
 *
 *  2. Rafraîchir le journal `FraudAlert` : pour chaque utilisateur avec
 *     activité récente, recalculer le score et créer une alerte si le niveau
 *     est actionnable (medium|high) et qu'il n'existe pas déjà une alerte
 *     ouverte. Aucune suppression — les alertes sont clôturées par un
 *     super-admin via l'API dédiée.
 *
 * Pas de FK depuis `Parcel` → `FraudAlert` : on garde l'historique même si un
 * colis est purgé. Les relations définies sont strictement utilisateur→
 * alertes (owner) et utilisateur→alertes résolues (resolver).
 *
 * Fallbacks : certains modèles optionnels (dette d'annulation, colonne `failed`
 * sur OtpCode, table `FcmToken`) peuvent ne pas exister selon la version du
 * schéma. Chaque signal essaye son chemin canonique, puis retombe à 0 en cas
 * d'absence (plutôt que de lever). Voir le commentaire au-dessus de chaque
 * bloc.
 */
import { scoreFraud } from '../../utils/fraud-scoring.js';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Charge l'utilisateur et agrège les six signaux de fraude, puis renvoie
 * le résultat de `scoreFraud`.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @returns {Promise<{ user: object, result: { score:number, level:string, flags:string[] } }>}
 */
export async function buildSignalsForUser(prisma, userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
    },
  });
  if (!user) return null;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twentyFourHoursAgo = new Date(now.getTime() - DAY_MS);

  // 2. & 6. Volume + annulations : un seul utilisateur peut avoir des milliers
  // de colis ; on reste en `count()` pour ne pas charger les rangs complets.
  const [totalParcels, cancelledParcels, recentCancellations] = await Promise.all([
    prisma.parcel.count({ where: { senderId: userId } }),
    prisma.parcel.count({ where: { senderId: userId, status: 'cancelled' } }),
    prisma.parcel.count({
      where: {
        senderId: userId,
        status: 'cancelled',
        updatedAt: { gt: sevenDaysAgo },
      },
    }),
  ]);

  // 3. Dette d'annulation : le schéma courant utilise `ClientPenaltyDebt` avec
  // un champ `status` ∈ { pending, partially_paid, paid }. `pending` et
  // `partially_paid` comptent comme « impayé ». Fallback à 0 si le modèle est
  // absent (schémas antérieurs).
  let hasCancellationDebt = 0;
  try {
    if (prisma.clientPenaltyDebt?.count) {
      const n = await prisma.clientPenaltyDebt.count({
        where: { userId, status: { in: ['pending', 'partially_paid'] } },
      });
      hasCancellationDebt = n > 0 ? 1 : 0;
    }
  } catch {
    hasCancellationDebt = 0;
  }

  // 4. OTP échouées : le modèle OtpCode courant stocke `attempts` (int) et
  // `isUsed`. Pas de colonne `failed` explicite — on considère qu'un code
  // ayant `attempts > 0` ET non utilisé est un échec. Fallback à 0 si la
  // relation n'existe pas.
  let otpFailures24h = 0;
  try {
    if (prisma.otpCode?.count) {
      otpFailures24h = await prisma.otpCode.count({
        where: {
          userId,
          isUsed: false,
          attempts: { gt: 0 },
          createdAt: { gt: twentyFourHoursAgo },
        },
      });
    }
  } catch {
    otpFailures24h = 0;
  }

  // 5. Multi-devices : `FcmToken` n'existe pas dans ce schéma — on utilise
  // `DeviceToken` (jetons FCM applicatifs). Les abonnements Web Push vivent
  // dans `PushSubscription` et ne sont PAS comptabilisés : un même humain
  // ouvre souvent plusieurs onglets web.
  let distinctDevices = 0;
  try {
    if (prisma.deviceToken?.count) {
      distinctDevices = await prisma.deviceToken.count({ where: { userId } });
    }
  } catch {
    distinctDevices = 0;
  }

  const signals = {
    accountCreatedAt: user.createdAt,
    totalParcels,
    cancelledParcels,
    recentCancellations,
    hasCancellationDebt,
    otpFailures24h,
    distinctDevices,
  };

  const result = scoreFraud(signals, { now });
  return { user, signals, result };
}

/**
 * Users à scanner : activité récente côté métier (dernière connexion ou colis
 * crée dans les 30 derniers jours). On exclut les comptes `deletedAt` et
 * les rôles staff (super_admin / support) qui ne font pas sens côté fraude
 * expéditeur.
 */
async function findActiveUserIds(prisma, since) {
  const activityOrUpdated = {
    deletedAt: null,
    role: { in: ['client', 'driver'] },
    OR: [
      { lastActiveAt: { gt: since } },
      { lastLogin: { gt: since } },
      { createdAt: { gt: since } },
      { sentParcels: { some: { updatedAt: { gt: since } } } },
    ],
  };
  const users = await prisma.user.findMany({
    where: activityOrUpdated,
    select: { id: true },
    take: 500, // garde-fou : on ne scanne pas une base entière en une seule passe.
  });
  return users.map((u) => u.id);
}

/**
 * Pour chaque utilisateur actif récemment, recalcule le score et, s'il est
 * actionnable (medium|high) et qu'aucune alerte ouverte n'existe déjà,
 * insère une nouvelle ligne `FraudAlert`.
 *
 * Idempotent : re-appeler cette fonction sans qu'aucun signal n'ait changé
 * ne crée **jamais** de doublon — la contrainte applicative repose sur
 * `resolvedAt IS NULL` (≤ 1 alerte ouverte par user à tout instant).
 */
export async function refreshFraudAlerts(prisma, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const userIds = await findActiveUserIds(prisma, since);

  let scanned = 0;
  let created = 0;
  let skipped = 0;

  for (const userId of userIds) {
    scanned += 1;
    const built = await buildSignalsForUser(prisma, userId);
    if (!built) {
      skipped += 1;
      continue;
    }
    const { result } = built;
    if (result.level !== 'medium' && result.level !== 'high') {
      skipped += 1;
      continue;
    }
    // Déjà une alerte ouverte ? → on n'écrase pas, on ne duplique pas.
    const existing = await prisma.fraudAlert.findFirst({
      where: { userId, resolvedAt: null },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.fraudAlert.create({
      data: {
        userId,
        score: result.score,
        level: result.level,
        flags: result.flags,
      },
    });
    created += 1;
  }

  return { scanned, created, skipped };
}
