/**
 * Proxy IA pour l'assistant conversationnel SendProColis.
 *
 * Scaffold prêt-à-brancher sur Claude API (Anthropic Messages API). La clé
 * n'est jamais exposée au mobile : toute requête passe par ce service.
 *
 * Fonctionnalité V1 : extraction d'un « draft de colis » depuis une phrase
 * en langage naturel (ex. « J'envoie un carton 5 kg de Dakar à Thiès
 * demain »). Le modèle est contraint par un prompt système et retourne un
 * JSON structuré. Le mobile ouvre ensuite `create_colis_sheet` pré-rempli
 * — l'utilisateur confirme toujours, jamais de création automatique.
 *
 * Variables d'env :
 *  - ANTHROPIC_API_KEY
 *  - ANTHROPIC_MODEL  (optionnel, défaut claude-sonnet-4-6)
 *  - ANTHROPIC_API_VERSION  (optionnel, défaut 2023-06-01)
 */

import { logger } from '../config/logger.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_API_VERSION = '2023-06-01';
const MAX_PROMPT_CHARS = 2000;
const MAX_OUTPUT_TOKENS = 600;

const SYSTEM_PROMPT = `Tu es l'assistant de la plateforme sénégalaise SendProColis.
Ton rôle : extraire une intention d'expédition de colis à partir du message utilisateur
et retourner UNIQUEMENT un objet JSON strict, sans aucun texte autour.

Contraintes :
- Devise : XOF (FCFA) uniquement.
- Pays : Sénégal uniquement en V1.
- Si l'utilisateur ne fournit pas une info, laisse le champ à null — JAMAIS d'invention.
- Les numéros de téléphone doivent être au format +221XXXXXXXXX.

Format de sortie attendu (schéma strict) :
{
  "intent": "create_parcel" | "track_parcel" | "faq" | "unknown",
  "draft": {
    "senderCity": string|null,
    "receiverCity": string|null,
    "receiverName": string|null,
    "receiverPhone": string|null,
    "weightKg": number|null,
    "type": "document"|"package"|"fragile"|"perishable"|"valuable"|null,
    "isUrgent": boolean,
    "notes": string|null
  },
  "trackingNumber": string|null,
  "answerText": string
}

Si intent = "create_parcel", draft doit être rempli au mieux.
Si intent = "track_parcel", trackingNumber doit être renseigné.
Sinon, answerText répond en français courtois.`;

export function isAiAssistantConfigured() {
  return (
    typeof process.env.ANTHROPIC_API_KEY === 'string' &&
    process.env.ANTHROPIC_API_KEY.length > 0
  );
}

/**
 * Appelle Claude Messages API avec un prompt utilisateur et retourne
 * l'objet parsé (ou null en cas d'erreur). Jamais d'exception vers
 * l'endpoint HTTP — tout échec devient un `answerText` par défaut.
 */
export async function askAssistant({ userMessage, userContext = {} }) {
  if (!isAiAssistantConfigured()) {
    return {
      intent: 'unknown',
      draft: null,
      trackingNumber: null,
      answerText:
        "L'assistant IA n'est pas disponible pour le moment. Vous pouvez créer un colis depuis l'onglet « Envoyer »."
    };
  }
  if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return {
      intent: 'unknown',
      draft: null,
      trackingNumber: null,
      answerText: 'Tapez votre demande pour que je puisse vous aider.'
    };
  }

  // Tronque les prompts abusifs (prompt-injection volumineux, coût).
  const trimmed = userMessage.trim().slice(0, MAX_PROMPT_CHARS);

  const payload = {
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildUserContent(trimmed, userContext)
      }
    ]
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': process.env.ANTHROPIC_API_VERSION || DEFAULT_API_VERSION,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn(
        {
          component: 'ai-assistant',
          status: response.status,
          body: text.slice(0, 500)
        },
        "Claude API a rejeté la requête"
      );
      return fallbackAnswer();
    }
    const data = await response.json();
    return parseAssistantResponse(data);
  } catch (error) {
    logger.warn(
      { component: 'ai-assistant', error: error.message },
      'Appel Claude API impossible — réseau ou timeout'
    );
    return fallbackAnswer();
  }
}

function buildUserContent(message, context) {
  const contextLines = [];
  if (typeof context.city === 'string' && context.city) {
    contextLines.push(`Ville du client : ${context.city}`);
  }
  if (typeof context.preferredLanguage === 'string') {
    contextLines.push(`Langue préférée : ${context.preferredLanguage}`);
  }
  const prefix = contextLines.length ? `Contexte:\n${contextLines.join('\n')}\n\n` : '';
  return `${prefix}Message utilisateur:\n${message}\n\nRetourne UNIQUEMENT le JSON demandé.`;
}

/**
 * Parsing strict de la réponse Claude. Les messages Claude ont la forme
 * `{ content: [{ type: 'text', text: '...' }, ...] }`. On concatène les
 * blocs texte, on recherche un objet JSON, on valide les champs clés.
 * N'importe quelle anomalie → `fallbackAnswer()`.
 *
 * Exporté pour permettre de tester le parsing sans appeler l'API.
 */
export function parseAssistantResponse(raw) {
  const blocks = Array.isArray(raw?.content) ? raw.content : [];
  const text = blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) return fallbackAnswer();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return fallbackAnswer(text);
  }
  const jsonSlice = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(jsonSlice);
    return {
      intent: typeof parsed.intent === 'string' ? parsed.intent : 'unknown',
      draft: sanitizeDraft(parsed.draft),
      trackingNumber:
        typeof parsed.trackingNumber === 'string' && parsed.trackingNumber.length > 0
          ? parsed.trackingNumber
          : null,
      answerText:
        typeof parsed.answerText === 'string' && parsed.answerText.length > 0
          ? parsed.answerText
          : 'Je prépare votre demande. Vérifiez les informations avant de confirmer.'
    };
  } catch {
    return fallbackAnswer(text);
  }
}

function sanitizeDraft(draft) {
  if (!draft || typeof draft !== 'object') return null;
  const allowedTypes = new Set(['document', 'package', 'fragile', 'perishable', 'valuable']);
  const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
  const num = (v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    senderCity: str(draft.senderCity),
    receiverCity: str(draft.receiverCity),
    receiverName: str(draft.receiverName),
    receiverPhone: str(draft.receiverPhone),
    weightKg: num(draft.weightKg),
    type: allowedTypes.has(draft.type) ? draft.type : null,
    isUrgent: draft.isUrgent === true,
    notes: str(draft.notes)
  };
}

function fallbackAnswer(fallbackText = null) {
  return {
    intent: 'unknown',
    draft: null,
    trackingNumber: null,
    answerText:
      fallbackText ??
      "Je n'ai pas compris, pouvez-vous reformuler ? Précisez la ville de départ, la ville d'arrivée et le poids."
  };
}

export const AI_ASSISTANT_CONSTANTS = Object.freeze({
  MAX_PROMPT_CHARS,
  MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL
});
