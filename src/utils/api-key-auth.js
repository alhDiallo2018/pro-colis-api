/**
 * Middleware d'authentification par clé API pour les endpoints
 * `/api/v1/public/business/*`. Les clés partenaires sont stockées dans
 * `SystemConfig` sous `apiKeys.business.<keyId>` en JSON :
 *   { "keyHash": "<sha256 hex>", "partnerName": "...", "webhookUrl": "...",
 *     "webhookSecret": "...", "scopes": ["shipments.read", "shipments.write"] }
 *
 * Le client partenaire envoie `X-Api-Key: <keyId>.<secret>` dans ses headers.
 * On compare `sha256(secret)` au keyHash stocké. Jamais de clé en clair en DB.
 *
 * V1 : service pur de validation (sans DB) + middleware Express à part.
 */

import { createHash } from 'node:crypto';

/**
 * Hash SHA-256 d'une chaîne (clé secrète).
 */
export function hashApiSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Parse un header Authorization/X-Api-Key au format `<keyId>.<secret>`.
 * Retourne `{ keyId, secret }` ou `null` si format invalide.
 */
export function parseApiKey(header) {
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const dot = trimmed.indexOf('.');
  if (dot <= 0 || dot >= trimmed.length - 1) return null;
  const keyId = trimmed.slice(0, dot);
  const secret = trimmed.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(keyId)) return null;
  if (secret.length < 16) return null;
  return { keyId, secret };
}

/**
 * Valide une clé contre un enregistrement stocké.
 * @param {{keyHash: string, scopes?: string[]}} record
 * @param {string} providedSecret
 * @param {string} [requiredScope]
 * @returns {boolean}
 */
export function validateApiKey(record, providedSecret, requiredScope = null) {
  if (!record || typeof record.keyHash !== 'string') return false;
  if (hashApiSecret(providedSecret) !== record.keyHash) return false;
  if (requiredScope) {
    const scopes = Array.isArray(record.scopes) ? record.scopes : [];
    if (!scopes.includes(requiredScope)) return false;
  }
  return true;
}
