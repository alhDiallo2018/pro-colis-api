#!/usr/bin/env node
/**
 * Soumission reproductible des 5 templates WhatsApp à Meta (OPS-5).
 *
 * Usage :
 *   META_WHATSAPP_BUSINESS_ID=xxx \
 *   META_WHATSAPP_ACCESS_TOKEN=yyy \
 *   node scripts/whatsapp-submit-templates.mjs
 *
 * Idempotent : si un template du même nom existe déjà côté Meta, l'appel
 * retournera une erreur 400 que le script journalise et ignore (continue
 * avec les suivants). Pour forcer une mise à jour, supprimer le template
 * côté Meta Business Manager d'abord.
 */

const API_VERSION = process.env.META_WHATSAPP_API_VERSION || 'v21.0';
const BUSINESS_ID = process.env.META_WHATSAPP_BUSINESS_ID;
const ACCESS_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN;
const LANGUAGE = 'fr';

const TEMPLATES = [
  {
    name: 'procolis_parcel_picked_up',
    category: 'UTILITY',
    body: `Bonjour {{1}} 👋\nVotre colis SendProColis n° {{2}} vient d'être pris en charge par le chauffeur.\nSuivez sa progression sur l'application.`
  },
  {
    name: 'procolis_parcel_in_transit',
    category: 'UTILITY',
    body: `Bonjour {{1}},\nVotre colis SendProColis n° {{2}} est en route.\nVous recevrez une notification dès qu'il approchera du point de livraison.`
  },
  {
    name: 'procolis_parcel_out_for_delivery',
    category: 'UTILITY',
    body: `Bonjour {{1}},\nVotre colis SendProColis n° {{2}} est en livraison finale aujourd'hui.\nVérifiez votre SMS pour le code de remise à communiquer au chauffeur.`
  },
  {
    name: 'procolis_parcel_delivered',
    category: 'UTILITY',
    body: `Merci {{1}} 🎉\nVotre colis SendProColis n° {{2}} a bien été livré.\nPensez à noter votre chauffeur dans l'application.`
  },
  {
    name: 'procolis_parcel_anomaly',
    category: 'UTILITY',
    body: `Attention {{1}},\nUne anomalie a été détectée sur le trajet de votre colis n° {{2}} : {{3}}.\nNotre équipe support vous recontactera si nécessaire.`
  }
];

async function submitOne(template) {
  const url = `https://graph.facebook.com/${API_VERSION}/${BUSINESS_ID}/message_templates`;
  const body = {
    name: template.name,
    language: LANGUAGE,
    category: template.category,
    components: [
      {
        type: 'BODY',
        text: template.body,
        example: {
          body_text: [
            template.name === 'procolis_parcel_anomaly'
              ? ['Fatou', 'TRK123', 'arrêt prolongé']
              : ['Fatou', 'TRK123']
          ]
        }
      }
    ]
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error(`[whatsapp-submit] ❌ ${template.name} (${res.status}) : ${JSON.stringify(data?.error ?? data)}`);
      return { template: template.name, ok: false, status: res.status, error: data?.error };
    }
    console.log(`[whatsapp-submit] ✅ ${template.name} → id=${data?.id} status=${data?.status}`);
    return { template: template.name, ok: true, id: data?.id, status: data?.status };
  } catch (err) {
    console.error(`[whatsapp-submit] ❌ ${template.name} : ${err?.message ?? err}`);
    return { template: template.name, ok: false, error: err?.message };
  }
}

async function main() {
  if (!BUSINESS_ID || !ACCESS_TOKEN) {
    console.error('[whatsapp-submit] Env manquant : META_WHATSAPP_BUSINESS_ID et META_WHATSAPP_ACCESS_TOKEN requis');
    process.exit(1);
  }
  console.log(`[whatsapp-submit] Soumission de ${TEMPLATES.length} templates (lang=${LANGUAGE})...\n`);
  const results = [];
  for (const t of TEMPLATES) {
    results.push(await submitOne(t));
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n[whatsapp-submit] Fini : ${okCount}/${TEMPLATES.length} soumis avec succès.`);
  if (okCount < TEMPLATES.length) process.exit(2);
}

main().catch((err) => {
  console.error('[whatsapp-submit] Erreur fatale :', err?.message ?? err);
  process.exit(10);
});
