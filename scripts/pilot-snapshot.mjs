#!/usr/bin/env node
/**
 * Snapshot des métriques pilote — exécuté par cron (ex. toutes les heures).
 *
 * Usage :
 *   node scripts/pilot-snapshot.mjs
 *
 * Sortie : une ligne JSON Pino sur stdout, consommable par n'importe quelle
 * infra d'agrégation (Loki, Datadog, ELK). Exemple de cron :
 *   0 * * * * cd /app && node scripts/pilot-snapshot.mjs >> /var/log/procolis/pilot.log
 *
 * Jamais d'exception : en cas d'erreur DB, on écrit un log d'erreur et on
 * sort avec le code 1. Pas de blocage du cron.
 */

import 'dotenv/config';
import { prisma } from '../src/config/prisma.js';
import { logger } from '../src/config/logger.js';
import { buildPilotMetrics } from '../src/utils/pilot-metrics.js';

async function main() {
  const [
    referralsTotal,
    referralsPending,
    referralsTriggered,
    insuranceActive,
    insuranceClaimed,
    insuranceCancelled,
    apiKeysActive,
    apiKeysTotal
  ] = await Promise.all([
    prisma.referral.count(),
    prisma.referral.count({ where: { status: 'pending' } }),
    prisma.referral.count({ where: { status: 'triggered' } }),
    prisma.insuranceSubscription.count({ where: { status: 'active' } }),
    prisma.insuranceSubscription.count({ where: { status: 'claimed' } }),
    prisma.insuranceSubscription.count({ where: { status: 'cancelled' } }),
    prisma.apiKey.count({ where: { active: true } }),
    prisma.apiKey.count()
  ]);

  const metrics = buildPilotMetrics({
    referrals: { total: referralsTotal, pending: referralsPending, triggered: referralsTriggered },
    insurance: { active: insuranceActive, claimed: insuranceClaimed, cancelled: insuranceCancelled },
    apiKeys: { active: apiKeysActive, total: apiKeysTotal }
  });

  logger.info({ component: 'pilot-snapshot', metrics }, 'Pilot metrics snapshot');
}

main()
  .catch((error) => {
    logger.error(
      { component: 'pilot-snapshot', error: error.message, stack: error.stack },
      'Pilot snapshot failed'
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
