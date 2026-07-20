import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { loadPaydunyaConfig, paydunyaConfigSnapshot } from './paydunya-config.js';

/**
 * Client de l'API de déboursement PayDunya (API PUSH).
 * Documentation officielle : https://developers.paydunya.com/doc/FR/api_deboursement
 *
 * Flux : get-invoice (création du token) → submit-invoice (exécution)
 * → statut final via le callback signé ou check-status.
 */

/** Méthodes de retrait de l'app → withdraw_mode PayDunya (Sénégal). */
const WITHDRAW_MODES = {
  wave: 'wave-senegal',
  orange_money: 'orange-money-senegal',
  freeMoney: 'free-money-senegal',
  paydunya: 'paydunya'
  // 'bank' n'est pas supporté par l'API PUSH : traité manuellement par un admin.
};

export function isPaydunyaConfigured() {
  const cfg = paydunyaConfigSnapshot();
  return Boolean(cfg.masterKey && cfg.privateKey && cfg.token);
}

export function withdrawModeFor(method) {
  return WITHDRAW_MODES[method] ?? null;
}

/**
 * "account_alias" doit être le numéro du bénéficiaire SANS l'indicatif pays
 * (ou l'identifiant de compte PayDunya pour les transferts compte à compte).
 */
export function toAccountAlias(phone) {
  const digits = String(phone ?? '').replace(/[^\d]/g, '');
  // Retire l'indicatif sénégalais (+221) s'il est présent.
  if (digits.length > 9 && digits.startsWith('221')) return digits.slice(3);
  return digits;
}

async function headers() {
  const cfg = await loadPaydunyaConfig();
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': cfg.masterKey,
    'PAYDUNYA-PRIVATE-KEY': cfg.privateKey,
    'PAYDUNYA-TOKEN': cfg.token
  };
}

async function post(path, body) {
  const response = await fetch(`${env.PAYDUNYA_DISBURSE_BASE_URL}${path}`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(body)
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = { response_text: `Réponse PayDunya illisible (HTTP ${response.status})` };
  }
  return { httpStatus: response.status, data };
}

/**
 * Étape 1 — création de la requête de déboursement.
 * Retourne { ok, disburseToken, error }.
 */
export async function getInvoice({ accountAlias, amount, withdrawMode, callbackUrl }) {
  const { data } = await post('/get-invoice', {
    account_alias: accountAlias,
    // "amount" ne doit pas être une valeur décimale, devise XOF.
    amount: Math.trunc(amount),
    withdraw_mode: withdrawMode,
    callback_url: callbackUrl
  });
  if (data?.response_code === '00' && data?.disburse_token) {
    return { ok: true, disburseToken: String(data.disburse_token).trim() };
  }
  return { ok: false, error: describeError(data) };
}

/**
 * Étape 2 — soumission du déboursement à l'opérateur.
 * `disburseId` est notre référence interne (facultative côté PayDunya).
 * Retourne { ok, status: 'success'|'pending'|'failed', transactionId, providerRef, error }.
 */
export async function submitInvoice({ disburseToken, disburseId }) {
  const body = { disburse_invoice: disburseToken };
  if (disburseId) body.disburse_id = disburseId;
  const { data } = await post('/submit-invoice', body);
  if (data?.response_code === '00') {
    // Certains wallets ne renvoient pas "status" en cas de succès immédiat.
    const status = (data.status ?? 'success').toLowerCase();
    return {
      ok: true,
      status: status === 'pending' ? 'pending' : status === 'failed' ? 'failed' : 'success',
      transactionId: data.transaction_id ?? null,
      providerRef: data.provider_ref ?? null
    };
  }
  return { ok: false, error: describeError(data) };
}

/**
 * Étape 3 — vérification du statut (created | pending | success | failed).
 */
export async function checkStatus(disburseToken) {
  const { data } = await post('/check-status', { disburse_invoice: disburseToken });
  if (data?.response_code === '00' || data?.status) {
    return {
      ok: true,
      status: String(data.status ?? '').toLowerCase(),
      transactionId: data.transaction_id ?? null,
      providerRef: data.disburse_tx_id ?? data.provider_ref ?? null
    };
  }
  return { ok: false, error: describeError(data) };
}

/**
 * Le callback PayDunya inclut `hash` = SHA-512 de la MasterKey — garantit
 * que la notification provient bien de leurs serveurs.
 */
export function verifyCallbackHash(hash) {
  const { masterKey } = paydunyaConfigSnapshot();
  if (!masterKey || !hash) return false;
  const expected = createHash('sha512').update(masterKey).digest('hex');
  return String(hash).toLowerCase() === expected;
}

/** Traduit les codes d'erreur documentés en message actionnable. */
function describeError(data) {
  const code = Array.isArray(data?.response_code) ? data.response_code.join(',') : data?.response_code;
  const text = data?.response_text ?? 'Erreur PayDunya inconnue';
  const KNOWN = {
    1001: 'Mode de retrait non pris en charge',
    401: 'Initiation non autorisée (API de déboursement inactive sur le compte PayDunya)',
    4002: 'Fonds insuffisants sur le compte marchand PayDunya, ou callback inaccessible',
    5000: 'Service PayDunya en maintenance, réessayer plus tard'
  };
  return { code: code ?? null, message: KNOWN[code] ?? String(text) };
}
