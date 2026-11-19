/**
 * Reader de configuration Assistant IA (clés `ai.*` dans SystemConfig).
 * Même pattern que eta-config / anomaly-config : cache 10 s, defaults
 * depuis `AI_ASSISTANT_CONSTANTS` + système prompt par défaut, valeurs
 * invalides ignorées silencieusement au profit du défaut.
 *
 * Permet à un super-admin d'ajuster sans redéploiement :
 *  - `ai.enabled` (bool) — kill-switch global ; si false, askAssistant
 *    retourne immédiatement le fallback.
 *  - `ai.maxPromptChars` (number) — cap sur le prompt utilisateur.
 *  - `ai.maxOutputTokens` (number) — cap de réponse Claude.
 *  - `ai.systemPrompt` (string) — override complet du system prompt.
 *  - `ai.model` (string) — override du modèle Claude utilisé.
 */

import { prisma } from '../config/prisma.js';
import { AI_ASSISTANT_CONSTANTS } from './ai-assistant.js';

const CACHE_TTL_MS = 10_000;
const CONFIG_KEY_PREFIX = 'ai.';
const FLAG_KEY = 'ai.enabled';
const DEFAULT_ENABLED = true;

let cachedConfig = null;
let cachedAt = 0;

const NUMBER_KEYS = Object.freeze({
  'ai.maxPromptChars': 'maxPromptChars',
  'ai.maxOutputTokens': 'maxOutputTokens'
});

const STRING_KEYS = Object.freeze({
  'ai.systemPrompt': 'systemPrompt',
  'ai.model': 'model'
});

function coerceNumber(value) {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function coerceBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  return null;
}

function coerceString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function readAiAssistantConfig() {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) return cachedConfig;

  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: CONFIG_KEY_PREFIX } }
  });

  const overrides = {};
  let enabled = DEFAULT_ENABLED;
  for (const row of rows) {
    if (row.key === FLAG_KEY) {
      const b = coerceBool(row.value);
      if (b != null) enabled = b;
      continue;
    }
    if (NUMBER_KEYS[row.key]) {
      const n = coerceNumber(row.value);
      if (n != null) overrides[NUMBER_KEYS[row.key]] = n;
      continue;
    }
    if (STRING_KEYS[row.key]) {
      const s = coerceString(row.value);
      if (s != null) overrides[STRING_KEYS[row.key]] = s;
    }
  }

  cachedConfig = {
    enabled,
    maxPromptChars: overrides.maxPromptChars ?? AI_ASSISTANT_CONSTANTS.MAX_PROMPT_CHARS,
    maxOutputTokens: overrides.maxOutputTokens ?? AI_ASSISTANT_CONSTANTS.MAX_OUTPUT_TOKENS,
    systemPrompt: overrides.systemPrompt ?? null,
    model: overrides.model ?? null
  };
  cachedAt = now;
  return cachedConfig;
}

export function invalidateAiAssistantConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}
