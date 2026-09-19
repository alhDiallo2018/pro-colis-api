import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
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

/**
 * Masque un numéro de compte/téléphone pour les logs : conserve les 3 premiers
 * et 3 derniers caractères (ex. 771234567 → 771****567, BSN0349122881 → BSN****881).
 * Ne jamais journaliser ces valeurs en clair.
 */
function maskAccount(value) {
  const v = String(value ?? '');
  if (!v) return '';
  if (v.length <= 6) return '****';
  return `${v.slice(0, 3)}****${v.slice(-3)}`;
}

/** Masque toute suite de 7 chiffres ou plus dans un texte libre (description). */
function maskSensitiveText(value) {
  return String(value ?? '').replace(/\d{7,}/g, (run) => maskAccount(run));
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
  // Log sécurisé de la réponse PayDunya : jamais les clés ni le token disburse,
  // et les comptes/numéros sont masqués avant écriture. Les références de
  // transaction (non secrètes) permettent de tracer le flux de bout en bout.
  logger.info(
    {
      type: 'PAYDUNYA_RESPONSE',
      endpoint: path,
      http_status: response.status,
      response_code: data?.response_code ?? null,
      response_text: data?.response_text ?? null,
      description: maskSensitiveText(data?.description),
      status: data?.status ?? null,
      transaction_id: data?.transaction_id ?? null,
      provider_ref: data?.disburse_tx_id ?? data?.provider_ref ?? null,
      disburse_id: data?.disburse_id ?? null,
      environment: env.NODE_ENV
    },
    'PayDunya disbursement response'
  );
  return { httpStatus: response.status, data };
}

/**
 * Étape 1 — création de la requête de déboursement.
 * Retourne { ok, disburseToken, error }.
 */
export async function getInvoice({ accountAlias, amount, withdrawMode, callbackUrl, debitAccountNumber }) {
  const cfg = await loadPaydunyaConfig();
  // Numéro de compte marchand à débiter. Uniquement pertinent pour les
  // transferts compte à compte (`withdraw_mode: paydunya`) : sans lui, PayDunya
  // débite le compte par défaut du pays du bénéficiaire, qui peut ne pas être
  // celui approvisionné (→ 4002 « fonds insuffisants »).
  const debitAccount = debitAccountNumber ?? cfg.debitAccountNumber;
  const body = {
    account_alias: accountAlias,
    // "amount" ne doit pas être une valeur décimale, devise XOF.
    amount: Math.trunc(amount),
    withdraw_mode: withdrawMode,
    callback_url: callbackUrl
  };
  if (withdrawMode === 'paydunya' && debitAccount) {
    body.debit_account_number = debitAccount;
  }

  // Log sécurisé de la requête de déboursement : comptes masqués, jamais de clés.
  logger.info(
    {
      type: 'PAYOUT_REQUEST',
      amount: body.amount,
      withdraw_mode: body.withdraw_mode,
      account_alias: maskAccount(body.account_alias),
      callback_url: body.callback_url,
      debit_account_number: body.debit_account_number ? maskAccount(body.debit_account_number) : null,
      environment: env.NODE_ENV
    },
    'PayDunya payout request'
  );

  const { data } = await post('/get-invoice', body);
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
  const { httpStatus, data } = await post('/submit-invoice', body);
  if (httpStatus >= 200 && httpStatus < 300 && data?.response_code === '00') {
    // Les exemples officiels Wave/Orange Money omettent "status" lors d'un
    // succès immédiat. Un statut explicitement inconnu ne vaut pas succès :
    // l'orchestrateur devra alors consulter check-status.
    const status = String(data.status ?? 'success').toLowerCase();
    if (!['success', 'pending', 'failed'].includes(status)) {
      return { ok: false, error: { code: '00', kind: 'UNKNOWN_PAYDUNYA_STATUS', message: 'Statut de soumission PayDunya inconnu' } };
    }
    return {
      ok: true,
      status,
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
  const { httpStatus, data } = await post('/check-status', { disburse_invoice: disburseToken });
  const status = String(data?.status ?? '').toLowerCase();
  // Une réponse d'erreur, même accompagnée d'un champ "status", ne confirme
  // aucun mouvement d'argent. Seuls les quatre états documentés sont fiables.
  if (httpStatus >= 200 && httpStatus < 300 && data?.response_code === '00' && ['created', 'pending', 'success', 'failed'].includes(status)) {
    return {
      ok: true,
      status,
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
export function verifyCallbackHash(hash, masterKey) {
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
    5000: 'Service PayDunya en maintenance, réessayer plus tard'
  };

  // Le code 4002 recouvre deux causes distinctes documentées par PayDunya :
  //  - fonds insuffisants sur le compte marchand ;
  //  - callback inaccessible.
  // Le `response_text` renvoyé permet de les distinguer ; sans lui on reste
  // explicite sur l'ambiguïté plutôt que d'accuser à tort l'un des deux.
  if (code === '4002' || String(code).split(',').includes('4002')) {
    const t = String(text).toLowerCase();
    if (t.includes('callback')) {
      return {
        code: code ?? null,
        kind: 'CALLBACK_UNREACHABLE',
        message: 'PayDunya signale que callback_url est inaccessible ; vérifier l’URL envoyée et les logs du callback'
      };
    }
    if (t.includes('fund') || t.includes('enough') || t.includes('fonds')) {
      return {
        code: code ?? null,
        kind: 'MERCHANT_INSUFFICIENT_FUNDS',
        message: 'Fonds insuffisants sur le compte marchand PayDunya'
      };
    }
    return {
      code: code ?? null,
      kind: 'UNKNOWN_PAYDUNYA_ERROR',
      message: 'Fonds insuffisants sur le compte marchand PayDunya, ou callback inaccessible'
    };
  }

  return {
    code: code ?? null,
    kind:
      code === '401'
        ? 'PAYDUNYA_CONFIGURATION_ERROR'
        : code === '5000'
          ? 'PAYDUNYA_API_ERROR'
          : KNOWN[code]
            ? 'PAYDUNYA_API_ERROR'
            : 'UNKNOWN_PAYDUNYA_ERROR',
    message: KNOWN[code] ?? String(text)
  };
}
