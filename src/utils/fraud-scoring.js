/**
 * Scoring de risque fraude — service pur, heuristique V1 (pas de ML).
 *
 * Évalue un utilisateur en combinant six signaux observables côté serveur :
 *
 *  1. **Âge du compte**           : < 7 jours = risque élevé.
 *  2. **Taux d'annulation**       : > 30 % = suspect.
 *  3. **Dette d'annulation**      : impayée = risque.
 *  4. **Tentatives OTP échouées** : > 5 sur 24 h = bot ou piratage.
 *  5. **Appareils multiples**     : plus de 3 devices FCM distincts.
 *  6. **Nombre de colis annulés** sur les 7 derniers jours.
 *
 * Score de 0 (sain) à 100 (à bloquer). Flags humainement interprétables.
 * Destiné au dashboard super-admin — jamais utilisé pour bloquer un flux
 * utilisateur automatiquement. L'humain reste dans la boucle.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  newAccountDays: 7,
  cancellationRatioRiskThreshold: 0.3,
  otpFailures24hRiskThreshold: 5,
  multiDevicesRiskThreshold: 3,
  recentCancellationsRiskThreshold: 3,
  // Pondérations : chaque signal ajoute `points` au score quand il déclenche.
  pointsNewAccount: 15,
  pointsHighCancellationRatio: 25,
  pointsHasCancellationDebt: 20,
  pointsOtpFailures: 20,
  pointsMultiDevices: 10,
  pointsRecentCancellations: 10,
  // Seuils d'étiquette.
  flagThresholds: { low: 20, medium: 50, high: 75 }
});

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Calcule le score de fraude pour un signal set donné.
 *
 * @param {object} signals
 * @param {Date | null} signals.accountCreatedAt
 * @param {number | null} signals.totalParcels       (lifetime)
 * @param {number | null} signals.cancelledParcels   (lifetime)
 * @param {number | null} signals.recentCancellations (sur 7 derniers jours)
 * @param {number | null} signals.hasCancellationDebt (bool/0/1)
 * @param {number | null} signals.otpFailures24h
 * @param {number | null} signals.distinctDevices
 * @param {object} [options.config]
 * @param {Date} [options.now]
 * @returns {{ score: number, flags: string[], level: 'safe'|'low'|'medium'|'high' }}
 */
export function scoreFraud(signals = {}, { config = {}, now = new Date() } = {}) {
  const cfg = { ...DEFAULTS, ...config, flagThresholds: { ...DEFAULTS.flagThresholds, ...(config.flagThresholds || {}) } };
  if (cfg.enabled === false) {
    return { score: 0, flags: [], level: 'safe' };
  }

  let score = 0;
  const flags = [];

  // 1. Âge du compte
  if (signals.accountCreatedAt instanceof Date) {
    const ageDays = (now.getTime() - signals.accountCreatedAt.getTime()) / (24 * 3600 * 1000);
    if (ageDays < cfg.newAccountDays) {
      score += cfg.pointsNewAccount;
      flags.push('new_account');
    }
  }

  // 2. Taux d'annulation
  if (isFiniteNumber(signals.totalParcels) && signals.totalParcels > 0 && isFiniteNumber(signals.cancelledParcels)) {
    const ratio = signals.cancelledParcels / signals.totalParcels;
    if (ratio > cfg.cancellationRatioRiskThreshold) {
      score += cfg.pointsHighCancellationRatio;
      flags.push('high_cancellation_ratio');
    }
  }

  // 3. Dette d'annulation
  if (signals.hasCancellationDebt) {
    score += cfg.pointsHasCancellationDebt;
    flags.push('cancellation_debt_unpaid');
  }

  // 4. OTP échouées
  if (isFiniteNumber(signals.otpFailures24h) && signals.otpFailures24h > cfg.otpFailures24hRiskThreshold) {
    score += cfg.pointsOtpFailures;
    flags.push('otp_abuse');
  }

  // 5. Multiples appareils
  if (isFiniteNumber(signals.distinctDevices) && signals.distinctDevices > cfg.multiDevicesRiskThreshold) {
    score += cfg.pointsMultiDevices;
    flags.push('multi_devices');
  }

  // 6. Annulations récentes
  if (isFiniteNumber(signals.recentCancellations) && signals.recentCancellations > cfg.recentCancellationsRiskThreshold) {
    score += cfg.pointsRecentCancellations;
    flags.push('recent_cancellations_burst');
  }

  const finalScore = Math.min(100, score);
  const level = levelForScore(finalScore, cfg.flagThresholds);

  return { score: finalScore, flags, level };
}

function levelForScore(score, thresholds) {
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  if (score >= thresholds.low) return 'low';
  return 'safe';
}

export const FRAUD_SCORING_DEFAULTS = DEFAULTS;
