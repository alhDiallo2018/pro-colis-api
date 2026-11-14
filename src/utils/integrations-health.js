/**
 * Health check des intégrations tierces (OPS-3).
 *
 * Service pur : calcule un rapport de configuration (jamais les valeurs des
 * secrets, uniquement leur présence) et un statut global `ok|degraded|fail`.
 *
 * Ne tente AUCUN appel réseau : il interroge uniquement `process.env` et
 * les flags de configuration. Un ping réseau réel appartient à chaque module
 * concerné (ex. Brevo renvoie 401 si la clé est expirée, mesurable côté
 * dispatchs journalisés).
 *
 * Endpoint consommateur : GET /health/integrations.
 */

import { carriersConfigurationReport } from './international-carriers-adapters.js';

function envPresent(key) {
  const v = process.env[key];
  return typeof v === 'string' && v.length > 0;
}

export function buildIntegrationsHealth() {
  const brevoConfigured = envPresent('BREVO_API_KEY');
  const whatsappConfigured = envPresent('META_WHATSAPP_ACCESS_TOKEN') && envPresent('META_WHATSAPP_PHONE_NUMBER_ID');
  const anthropicConfigured = envPresent('ANTHROPIC_API_KEY');
  const paydunyaConfigured = envPresent('PAYDUNYA_MASTER_KEY') &&
    envPresent('PAYDUNYA_PRIVATE_KEY') &&
    envPresent('PAYDUNYA_PUBLIC_KEY') &&
    envPresent('PAYDUNYA_TOKEN');
  const googleAuthConfigured = envPresent('GOOGLE_AUTH_CLIENT_ID');
  const carriersReport = carriersConfigurationReport();

  const integrations = {
    brevo: { configured: brevoConfigured, missing: brevoConfigured ? [] : ['BREVO_API_KEY'] },
    whatsapp: {
      configured: whatsappConfigured,
      missing: [
        !envPresent('META_WHATSAPP_ACCESS_TOKEN') ? 'META_WHATSAPP_ACCESS_TOKEN' : null,
        !envPresent('META_WHATSAPP_PHONE_NUMBER_ID') ? 'META_WHATSAPP_PHONE_NUMBER_ID' : null
      ].filter(Boolean)
    },
    anthropic: { configured: anthropicConfigured, missing: anthropicConfigured ? [] : ['ANTHROPIC_API_KEY'] },
    paydunya: {
      configured: paydunyaConfigured,
      missing: [
        !envPresent('PAYDUNYA_MASTER_KEY') ? 'PAYDUNYA_MASTER_KEY' : null,
        !envPresent('PAYDUNYA_PRIVATE_KEY') ? 'PAYDUNYA_PRIVATE_KEY' : null,
        !envPresent('PAYDUNYA_PUBLIC_KEY') ? 'PAYDUNYA_PUBLIC_KEY' : null,
        !envPresent('PAYDUNYA_TOKEN') ? 'PAYDUNYA_TOKEN' : null
      ].filter(Boolean)
    },
    googleAuth: { configured: googleAuthConfigured, missing: googleAuthConfigured ? [] : ['GOOGLE_AUTH_CLIENT_ID'] },
    carriers: carriersReport
  };

  // Statut global : fail si PayDunya absent (paiements bloqués),
  // degraded si WhatsApp ou Brevo absent, sinon ok.
  let status = 'ok';
  if (!paydunyaConfigured) status = 'fail';
  else if (!whatsappConfigured || !brevoConfigured) status = 'degraded';

  return {
    status,
    integrations,
    checkedAt: new Date().toISOString()
  };
}
