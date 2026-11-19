/**
 * Dispatcher d'invalidation de cache pour les mutations de `SystemConfig`.
 *
 * Chaque reader (`timings-config.js`, `limits-config.js`, …) maintient son
 * propre cache mémoire 30-60 s pour ne pas surcharger la DB. Sans ce
 * dispatcher, une mutation admin (p.ex. `limits.csvMaxLines=60`) resterait
 * invisible pendant jusqu'à 60 s — expérience admin cassée.
 *
 * `invalidateByKey(key)` appelle l'invalidation adéquate en fonction du
 * préfixe de la clé modifiée. `invalidateByKeys(keys)` déduplique les
 * groupes pour une mutation batch (une seule invalidation par cache).
 *
 * Note design : l'invalidation est tolérante aux erreurs (chaque appel est
 * wrappé) pour qu'une seule fonction cassée ne fasse pas échouer la mutation
 * admin dans son ensemble — les erreurs sont loggées mais non remontées.
 */

import { invalidateTimingsCache } from './timings-config.js';
import { invalidateLimitsCache } from './limits-config.js';
import { invalidateBrandingCache } from './branding-config.js';
import { invalidateAuthConfigCache } from './auth-config.js';
import { invalidatePaydunyaConfigCache } from './paydunya-config.js';
import { invalidateAnomalyConfigCache } from './anomaly-config.js';
import { invalidateFraudConfigCache } from './fraud-config.js';
import { invalidateDriverScoringCache } from './driver-scoring-config.js';
import { invalidateEtaConfigCache } from './eta-config.js';
import { invalidateConsolidationConfigCache } from './consolidation-config.js';
import { invalidateAiAssistantConfigCache } from './ai-assistant-config.js';
import { invalidateBrevoConfigCache } from './brevo.js';

/**
 * Mapping préfixe de clé → nom de "groupe" de cache. Deux clés partageant le
 * même groupe n'entraînent qu'un seul appel d'invalidation (déduplication
 * importante pour les mutations batch sur 10+ clés `limits.*`).
 */
export const CONFIG_KEY_GROUPS = Object.freeze({
  'timings.': 'timings',
  'limits.': 'limits',
  'branding.': 'branding',
  // `notifications.*` partage le même cache mémoire que `branding.*`
  // (cf. `branding-config.js`). Une invalidation suffit pour les deux.
  'notifications.': 'branding',
  'auth.': 'auth',
  'paydunya.': 'paydunya',
  'anomaly.': 'anomaly',
  'fraud.': 'fraud',
  'driverScoring.': 'driverScoring',
  'eta.': 'eta',
  'consolidation.': 'consolidation',
  'ai.': 'aiAssistant',
  'brevo.': 'brevo'
  // Clés sans cache dédié (international.*, commission.*, support.*, legal.*,
  // help.*, cancellation.*, points.*, withdrawal.*, score.*, finance.*,
  // referral.*, currency.*, insufficientPolicy, debtLimit, apiKeys.*) : lues
  // sans mise en cache mémoire, donc les mutations prennent effet au prochain
  // appel sans invalidation explicite.
});

/**
 * Invalidateurs indexés par groupe. Chaque entrée est tolérante aux erreurs :
 * un cache cassé ne doit pas empêcher d'invalider les autres.
 */
const INVALIDATORS = Object.freeze({
  timings: () => invalidateTimingsCache(),
  limits: () => invalidateLimitsCache(),
  branding: () => invalidateBrandingCache(),
  auth: () => invalidateAuthConfigCache(),
  paydunya: () => invalidatePaydunyaConfigCache(),
  anomaly: () => invalidateAnomalyConfigCache(),
  fraud: () => invalidateFraudConfigCache(),
  driverScoring: () => invalidateDriverScoringCache(),
  eta: () => invalidateEtaConfigCache(),
  consolidation: () => invalidateConsolidationConfigCache(),
  aiAssistant: () => invalidateAiAssistantConfigCache(),
  brevo: () => invalidateBrevoConfigCache()
});

/**
 * Retourne le groupe de cache correspondant à une clé, ou `null` si la clé
 * n'a pas de cache dédié (lecture directe à chaque appel).
 */
export function groupForKey(key) {
  if (typeof key !== 'string') return null;
  for (const prefix of Object.keys(CONFIG_KEY_GROUPS)) {
    if (key.startsWith(prefix)) return CONFIG_KEY_GROUPS[prefix];
  }
  return null;
}

/**
 * Invalide le cache associé à la clé fournie, le cas échéant. No-op si la
 * clé n'a pas de cache dédié.
 */
export function invalidateByKey(key) {
  const group = groupForKey(key);
  if (!group) return false;
  const fn = INVALIDATORS[group];
  if (!fn) return false;
  try {
    fn();
    return true;
  } catch (error) {
    // Un cache cassé ne doit jamais faire échouer la mutation admin : on log
    // via console pour qu'un dev voie le problème, sans propager l'erreur.
    console.warn(`[system-config] invalidateByKey('${key}') a échoué:`, error?.message || error);
    return false;
  }
}

/**
 * Invalide tous les caches concernés par un ensemble de clés mutées, en
 * déduplant par groupe. Retourne la liste des groupes invalidés (utile pour
 * les logs d'audit).
 */
export function invalidateByKeys(keys) {
  if (!Array.isArray(keys)) return [];
  const groups = new Set();
  for (const key of keys) {
    const group = groupForKey(key);
    if (group) groups.add(group);
  }
  const invalidated = [];
  for (const group of groups) {
    const fn = INVALIDATORS[group];
    if (!fn) continue;
    try {
      fn();
      invalidated.push(group);
    } catch (error) {
      console.warn(`[system-config] invalidation groupe '${group}' a échoué:`, error?.message || error);
    }
  }
  return invalidated;
}
