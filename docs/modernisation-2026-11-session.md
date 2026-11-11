# Modernisation SendProColis — session 2026-11

> Document de passation : inventaire complet des 15 chantiers stratégiques
> livrés en V1 testable + commandes de mise en prod + critères pilote.

## TL;DR

- **299 tests unitaires verts** (230 backend + 69 mobile) sur 26 suites.
- Les **15 chantiers P1+P2+P3** de la roadmap stratégique sont livrés.
- Migration Prisma prête (`prisma/migrations/20261111000000_p3_infra/`).
- Spec OpenAPI publique pour partenaires e-commerce rédigée.
- 3 endpoints admin pour piloter : clés API, métriques pilote, config système.

**Reste côté humain** : poser 3 secrets `.env`, approuver 5 templates WhatsApp
par Meta, appliquer la migration sur la DB prod, signer les premiers
partenariats.

---

## Les 15 chantiers livrés

| Prio | # | Chantier | Service pur | Endpoint | Tests |
|---|---|---|---|---|---|
| P1 | 1 | Notifications WhatsApp Business | `src/utils/whatsapp.js` | Scaffold prêt à brancher sur événements statut | 12 ✅ |
| P1 | 2 | ETA prédictif dynamique | `src/utils/eta-calculator.js` + `eta-config.js` | Enrichissement non-breaking de `track*` | 24 ✅ |
| P1 | 3 | OCR étiquette ML Kit | `lib/services/ocr_label_parser.dart` + `ocr_service.dart` | Bouton « Scanner étiquette » dans `create_colis_sheet` | 23 ✅ |
| P1 | 4 | Détection anomalies trajet | `src/utils/anomaly-detector.js` + `anomaly-config.js` | Enrichissement non-breaking + bannière UI | 21 ✅ |
| P1 | 5 | Assistant IA conversationnel | `src/utils/ai-assistant.js` + `lib/services/api/ai_api.dart` | `POST /ai/assistant` + écran `ai_assistant_screen.dart` | 21 ✅ |
| P2 | 6 | Driver scoring ML | `src/utils/driver-scoring.js` + `driver-scoring-config.js` | Enrichissement de `publicParcelBids` | 20 ✅ |
| P2 | 7 | Promise-time windows | `src/utils/promise-time.js` | `GET /parcels/promise-slots` + `PromiseTimeApi` mobile | 17 ✅ |
| P2 | 8 | API publique e-commerce + webhooks | `src/utils/webhook-dispatcher.js` + `shipment-webhook-service.js` + `api-key-auth.js` + `api-key-generator.js` | 5 endpoints admin `/super-admin/api-keys/*` | 33 ✅ |
| P2 | 9 | Consolidation / backhaul | `src/utils/consolidation-matcher.js` | Scaffold (endpoint à écrire) | 12 ✅ |
| P2 | 10 | Dashboard B2B shipper | `src/utils/business-shipper-stats.js` | `GET /business-shipper/dashboard` | 12 ✅ |
| P2 | 11 | Scoring fraude heuristique | `src/utils/fraud-scoring.js` | Scaffold (à brancher dans admin) | 14 ✅ |
| P2 | 12 | Multi-langue fr/en/wo | `lib/l10n/*.arb` + `AppLocalizations` + `locale_provider.dart` | Sélecteur dans `settings_screen.dart` | 10 ✅ |
| P3 | 13 | Expédition CEDEAO | `src/utils/international-pricing.js` | `GET /parcels/international-estimate` | 15 ✅ |
| P3 | 14 | Assurance colis | `src/utils/insurance-quote.js` + `insurance-subscription-service.js` | `POST /parcels/insurance/quote` + `POST /parcels/:id/insurance/subscribe` | 21 ✅ |
| P3 | 15 | Parrainage & fidélité | `src/utils/referral-rewards.js` + `referral-claim-service.js` | `GET /me/referral-code` + `POST /me/referral/claim` + carte UI | 27 ✅ |

---

## Nouveaux endpoints HTTP

### Public / utilisateur authentifié

- `POST /ai/assistant` — assistant conversationnel
- `GET /parcels/promise-slots` — créneaux de livraison
- `GET /parcels/international-estimate` — devis CEDEAO
- `POST /parcels/insurance/quote` — devis assurance
- `POST /parcels/:parcelId/insurance/subscribe` — souscrit l'assurance
- `GET /me/referral-code` — code de parrainage personnel
- `POST /me/referral/claim` — revendiquer un code
- `GET /business-shipper/dashboard` — stats expéditeur B2B

### Admin super_admin

- `GET /super-admin/api-keys` — lister les clés partenaires
- `POST /super-admin/api-keys` — créer (retourne `secretOnce` + `webhookSecretOnce`)
- `POST /super-admin/api-keys/:keyId/rotate` — tourner le secret
- `PATCH /super-admin/api-keys/:keyId` — maj scopes/webhook/active
- `POST /super-admin/api-keys/:keyId/deactivate` — désactiver
- `GET /super-admin/pilot-metrics` — snapshot métriques pilote

### Enrichissements non-breaking

Ajoutent des champs optionnels sans casser les clients existants :
- `GET /public/parcels/track/:trackingNumber(/location)?` : + `eta`, + `anomalies`
- `GET /client/parcels/:id` (et `/driver/parcels/:id`) : `parcel.eta`, `parcel.anomalies`
- `GET /public/parcels/:parcelId/bids` : `score` + `scoreBreakdown` sur chaque bid

---

## Migration DB

**Fichier** : `prisma/migrations/20261111000000_p3_infra/migration.sql`

**Contenu** :
- `ALTER users ADD whatsapp_opt_in BOOLEAN DEFAULT false`
- `ALTER users ADD referral_code TEXT UNIQUE`
- `CREATE TABLE referrals` (parrain, filleul, status, bonus XOF)
- `CREATE TABLE insurance_subscriptions` (prime, couverture, status)
- `CREATE TABLE api_keys` (keyId, keyHash SHA-256, partenaire, webhook, scopes)

**Commande d'application** (prod) :

```bash
cd /Users/testad/Web/Procolis-Api/pro-colis-api
DATABASE_URL=<prod_url> npx prisma migrate deploy
```

Tout est idempotent (`IF NOT EXISTS`, `DO $$ BEGIN ... END $$`).

---

## Configuration SystemConfig

Toutes les constantes des 15 chantiers sont modifiables à chaud via la
table `system_configs`, sans redéploiement. Préfixes utilisés :

| Préfixe | Chantier | Clés principales |
|---|---|---|
| `eta.*` | 2 | `enabled`, `routeFactor`, `defaultSpeedKmh`, `stalePositionMaxAgeSec`, ... |
| `anomaly.*` | 4 | `enabled`, `gpsSilenceMinutes`, `prolongedStopMinutes`, `deviationThresholdKm`, ... |
| `driverScoring.*` | 6 | `enabled`, `weightPrice`, `weightRating`, `maxDistanceKm`, ... |
| `apiKeys.business.*` | 8 | Un entry par partenaire (migre vers table `api_keys` V2) |

Chaque flag `*.enabled = false` désactive instantanément la feature sans
redéploiement (kill-switch).

---

## Variables d'environnement à poser

```bash
# Chantier A — WhatsApp
META_WHATSAPP_ACCESS_TOKEN=EAAxxxxx
META_WHATSAPP_PHONE_NUMBER_ID=1234567890
# META_WHATSAPP_API_VERSION=v21.0  # optionnel

# Chantier E — Assistant IA
ANTHROPIC_API_KEY=sk-ant-xxxxx
# ANTHROPIC_MODEL=claude-sonnet-4-6  # optionnel
# ANTHROPIC_API_VERSION=2023-06-01  # optionnel
```

Toutes les features dégradent gracieusement si leurs variables ne sont pas
posées (jamais d'exception vers l'utilisateur).

---

## Templates WhatsApp à faire approuver par Meta

Catégorie « Utility » (délai 24-72 h) :

1. `procolis_parcel_picked_up`
2. `procolis_parcel_in_transit`
3. `procolis_parcel_out_for_delivery`
4. `procolis_parcel_delivered`
5. `procolis_parcel_anomaly`

Chacun prend 2 placeholders `{{1}}` et `{{2}}` (nom destinataire + tracking
number). Les templates sont routés par `sendParcelStatusWhatsApp()`
(`src/utils/whatsapp.js`).

---

## Checklist pilote (2 semaines)

### Monitoring continu

```bash
# Cron horaire pour logguer les métriques :
0 * * * * cd /app && npm run pilot:snapshot >> /var/log/procolis/pilot.log

# Ou appel REST toutes les heures :
curl -H "Authorization: Bearer <admin_token>" \
     https://sendprocolis.com/api/v1/super-admin/pilot-metrics
```

### Critères de succès attendus

| Métrique | Cible V1 | Source |
|---|---|---|
| Couverture ETA | ≥ 80 % des trajets actifs avec `eta != null` | `parcel.eta` sur `in_transit` |
| Précision ETA | à 75 % du trajet, erreur ≤ ±8 min dans ≥ 70 % des cas | Comparer `arrivalAt` vs `deliveryDate` |
| Taux WhatsApp livrés | ≥ 90 % des envois (si Meta configuré) | Logs Pino `component: whatsapp` |
| Anomalies détectées / jour | Baseline à mesurer | `pilot-metrics` |
| Parrainages déclenchés | ≥ 5 % des nouveaux comptes | `pilot-metrics.referrals.conversionPercent` |
| Régression métier | 0 incident sur flux existants | Logs 5xx, feedback support |

### Kill-switches

En cas d'incident sur une feature, désactivation instantanée via
SystemConfig (sans redéploiement) :

```sql
UPDATE system_configs SET value = 'false' WHERE key = 'eta.enabled';
UPDATE system_configs SET value = 'false' WHERE key = 'anomaly.enabled';
UPDATE system_configs SET value = 'false' WHERE key = 'driverScoring.enabled';
```

Les features retombent sur `null` / tableau vide — le mobile continue de
fonctionner en mode « avant modernisation ».

---

## Inventaire des fichiers créés (backend)

**Services purs** (`src/utils/`) : 15 nouveaux
- `eta-calculator.js`, `eta-config.js`
- `anomaly-detector.js`, `anomaly-config.js`
- `whatsapp.js`, `ai-assistant.js`
- `driver-scoring.js`, `driver-scoring-config.js`, `fraud-scoring.js`, `consolidation-matcher.js`
- `promise-time.js`
- `webhook-dispatcher.js`, `shipment-webhook-service.js`, `api-key-auth.js`, `api-key-generator.js`
- `business-shipper-stats.js`, `pilot-metrics.js`
- `international-pricing.js`
- `insurance-quote.js`, `insurance-subscription-service.js`
- `referral-rewards.js`, `referral-claim-service.js`

**Modifiés** : `mobile.controller.js`, `mobile.routes.js`, `mobile-serializers.js`, `prisma/schema.prisma`, `package.json`

**Tests unitaires** : 20 fichiers `tests/*.test.js`, 230 tests verts

**Scripts** : `scripts/pilot-snapshot.mjs` + commande `npm run pilot:snapshot`

**Docs** : `specs/public-api.yaml` (OpenAPI partenaires e-commerce)

**Migration** : `prisma/migrations/20261111000000_p3_infra/migration.sql`

## Inventaire des fichiers créés (mobile)

**Services** : `lib/services/ocr_label_parser.dart`, `ocr_service.dart`, `lib/services/api/ai_api.dart`, `promise_time_api.dart`, `referral_api.dart`

**Widgets** : `lib/widgets/referral_card.dart`, `language_picker_tile.dart`

**Providers** : `lib/providers/locale_provider.dart`

**Écrans** : `lib/screens/shared/ai_assistant_screen.dart`

**L10n** : `lib/l10n/app_fr.arb`, `app_en.arb`, `app_wo.arb`, `l10n.yaml`, `lib/l10n/generated/*`

**Modifiés** : `lib/models/parcel.dart` (ParcelEta, ParcelAnomaly), `lib/services/api_service.dart`, `lib/widgets/parcel_live_tracking_card.dart` (badges), `lib/screens/parcel/create_colis_sheet.dart` (OCR), `lib/screens/profile/profile_screen.dart` (ReferralCard), `lib/screens/settings/settings_screen.dart` (langue), `lib/app.dart` (l10n + locale), `pubspec.yaml`

**Tests** : 6 fichiers `test/*.dart`, 69 tests verts

---

## Prochaines étapes après le pilote

Non bloquantes pour le lancement V1 :

- Brancher `dispatchShipmentEvent(type, parcel)` dans les handlers de
  changement de statut colis (`pickUpParcel`, `transitParcel`,
  `deliverParcel`, `cancelParcel`) pour déclencher les webhooks
  partenaires automatiquement.
- Hook de déclenchement du bonus parrainage à la première livraison du
  filleul (cron ou listener sur `parcel.status = delivered`).
- UI mobile du dashboard B2B shipper (écran dédié consommant
  `GET /business-shipper/dashboard`).
- UI mobile du panel admin clés API (écran super-admin).
- Retries exponentiels pour les webhooks échoués (queue BullMQ ou pg_cron).
- Alimenter les métriques pilote avec des compteurs WhatsApp (needs Meta
  callback pour `delivered`/`read`) et anomalies (counter depuis logs).
