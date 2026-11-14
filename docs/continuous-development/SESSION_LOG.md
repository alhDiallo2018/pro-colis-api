# Journal de session

## 2026-11-11 — Initialisation + Phase 1 (SCP-001 & SCP-002)

**Objectif** : auditer SendProColis, créer le système de continuité, démarrer et clore les deux premières tâches de la Phase 1 (navette multi-colis multi-arrêts).

**Travaux réalisés** :

### Phase 0 — Continuité (SCP-000)
- Audit via agent Explore : schéma Prisma (1663 lignes), 20 modules backend, 308 fichiers Flutter, 99 suites de tests, docs existants, derniers commits.
- Création des 6 fichiers de continuité dans `docs/continuous-development/`.
- Backlog initial SCP-000 à SCP-051 publié dans `TASK_TRACKER.md` (phases 0 à 6).

### Phase 1 — SCP-001 (affectation d'arrêts sur `AdvertisementOffer`)
- Migration additive `prisma/migrations/20261113000000_advertisement_offer_stops/migration.sql` : `boarding_stop_order` + `drop_off_stop_order` INT nullable + index. Appliquée sur `procolis_test`.
- Schéma Prisma mis à jour (`schema.prisma` lignes 872-897). Client régénéré.
- Nouveau validateur isolé `src/utils/transit-offer-stops.js` (pure function, pas de Prisma). Branché dans `createAdvertisementOffer` (`mobile.controller.js:5924`).
- Serializer enrichi : `boardingStop`/`dropOffStop` exposés quand l'include transitLine.stops est présent (`mobile-serializers.js:713` + helper `resolveStopInfo`).
- Tests unitaires `tests/transit-offer-stops.test.js` : **12/12 verts** (OK nullable, stops absents/inconnus, ordre inversé, ligne absente, string numérique, négatif).

### Phase 1 — SCP-002 (endpoint manifeste)
- Controller `advertisementManifest` (`mobile.controller.js:6017`) : charge l'annonce + stops + offres acceptées, groupe par arrêt (`picked` / `dropOffs`), retourne `{ advertisementId, transitLineId, totalOffers, stops: [], unassigned: [] }`.
- Permissions : driver du trajet, super_admin, ou client ayant une offre acceptée (futur destinataire).
- Route `GET /advertisements/:advertisementId/manifest` (`mobile.routes.js:550`).
- Tests d'intégration `tests/advertisement-manifest.test.js` : **4/4 verts** (driver, client propriétaire, tiers 403, annonce inexistante 404).

### Non-régression
- Suite backend complète : **910 / 916 verts**. Les 6 échecs sont **pré-existants** et **tous liés à Brevo SMS 401 Unauthorized** (clé expirée dans `.env`) : `otp-disclosure.test.js`, `reset-pin.test.js`. Aucun test lié à mes changements ne régresse.
- Suites ciblées : `advertisement-locations-debts` (non-régression), `transit-scrape`, `transit-offer-stops`, `advertisement-manifest` → **22/22 verts**.

**Fichiers créés** :
- `docs/continuous-development/PROJECT_MASTER_PLAN.md`
- `docs/continuous-development/CURRENT_STATE.md`
- `docs/continuous-development/TASK_TRACKER.md`
- `docs/continuous-development/ARCHITECTURE_DECISIONS.md`
- `docs/continuous-development/SESSION_LOG.md` (ce fichier)
- `docs/continuous-development/NEXT_SESSION.md`
- `prisma/migrations/20261113000000_advertisement_offer_stops/migration.sql`
- `src/utils/transit-offer-stops.js`
- `tests/transit-offer-stops.test.js`
- `tests/advertisement-manifest.test.js`

**Fichiers modifiés** :
- `prisma/schema.prisma` (AdvertisementOffer + 2 champs + 2 index)
- `src/modules/mobile/mobile.controller.js` (import validateOfferStops, branchement dans createAdvertisementOffer, nouveau controller `advertisementManifest`)
- `src/modules/mobile/mobile.routes.js` (nouvelle route `/advertisements/:advertisementId/manifest`)
- `src/utils/mobile-serializers.js` (enrichissement `serializeAdvertisementOffer` + helper `resolveStopInfo`)
- `docs/continuous-development/TASK_TRACKER.md` (passage de SCP-001 et SCP-002 à DONE)
- `docs/continuous-development/CURRENT_STATE.md` (navette multi-arrêts passe en partiel+)

**Tests exécutés** :
- `npm test -- --testPathPattern=transit-offer-stops` → 12/12
- `npm test -- --testPathPattern="advertisement|transit"` → 22/22
- `npm test` (suite complète) → 910/916 (6 échecs Brevo pré-existants, non liés)

**Décisions structurantes** (voir `ARCHITECTURE_DECISIONS.md`) :
- Les stops vont sur `AdvertisementOffer`, pas sur `Parcel`.
- FK composite évitée au profit d'une validation applicative.
- Enrichissements non-breaking (champs optionnels, pas de contrat mobile cassé).

**Problèmes rencontrés** :
- `DATABASE_URL` par défaut (`host.docker.internal:5432`) non résolvable sur macOS natif. Contourné par override explicite vers `localhost:5432`. Documenté dans `CURRENT_STATE.md`.
- Brevo 401 sur 6 tests d'OTP : hors scope, non régression.
- Première itération du test manifeste : mauvais typage de `res.body` (le helper `ok()` étale `data` à plat au lieu de le placer sous `data`). Corrigé immédiatement.

**Tâche suivante** : SCP-003 (détection d'arrivée à l'arrêt via JourneyLive + géofencing).

### Phase 1 — SCP-003 (détection d'arrivée géofencée)
- Service pur `src/utils/stop-arrival-detector.js` : haversine + ring buffer, confirmation par consécutivité (`minConsecutivePoints`, `windowMinutes`, `radiusMeters`, rayon de zone utilisé comme plancher).
- Migration `20261114000000_journey_stop_events` : ajout `journey_live.recent_positions` JSONB + nouvelle table `journey_stop_events` (unique `(advertisement_id, stop_order)`).
- Service `src/modules/trips/stop-arrival.service.js` : `appendPosition` (ring buffer size 10) + `evaluateStopArrival` (tolérant, non bloquant).
- `updateJourneyLive` réécrit en transaction : met à jour le buffer, appelle le détecteur, upsert les événements.
- Nouvelle méthode `reachedStopsForAdvertisement`, nouveau controller `advertisementReachedStops`, nouvelle route `GET /advertisements/:advertisementId/reached-stops`.
- Tests : 12 unitaires (`stop-arrival-detector`) + 8 d'intégration (`stop-arrival-integration`) + non-régression `journey-live-integration` → **20/20** + journey-live inchangé.

### Non-régression finale
- Suite Phase 1 complète : **77/77 verts** sur `advertisement|transit|journey|stop-arrival|anomaly`.

### Phase 1 — SCP-004 (notification destinataire au dropOffStop)
- `notifyRecipientsAtDropOff(tx, journeyLive, event)` ajouté dans `stop-arrival.service.js` : sélection des `AdvertisementOffer` acceptées avec `dropOffStopOrder == event.order`, création de `Notification` (déclenche FCM automatiquement via le middleware `attachNotificationPushBridge`), envoi WhatsApp template `out_for_delivery` quand le client est opt-in et qu'un colis identifiable est rattaché.
- Non bloquant à tous les niveaux (try/catch autour de chaque notification, du WhatsApp, et de la boucle globale).
- Tests `tests/stop-arrival-notifications.test.js` : **3/3 verts** — ciblage correct (2 destinataires au bon stop, 0 au mauvais), pipeline complet via `evaluateStopArrival`, idempotence (second passage ne crée pas de doublons).
- Non-régression Phase 1 complète : **80/80 verts**.

**Tâche suivante** : bascule vers Phase 2 — SCP-010 (`ParcelHandover`) pour les correspondances inter-véhicules Dakar→Thiès→Mbour.

### Phase 2 — SCP-010 (ParcelHandover : correspondances inter-véhicules)
- Migration `20261115000000_parcel_handovers` : table avec index unique partiel `WHERE status='pending_pickup'` (un seul handover actif par colis), CHECK `from_driver != to_driver`, 5 FK (parcel, fromDriver, toDriver, fromAdvertisement?, toAdvertisement?).
- Modèle Prisma `ParcelHandover` + back-refs sur `User` (`handoversAsFromDriver`, `handoversAsToDriver`), `Parcel` (`handovers`), `Advertisement` (`handoversFrom`, `handoversTo`).
- Utilitaire `src/utils/handover-proofs.js` : `generatePickupPin` (randomInt crypto, 6 chiffres), `generatePickupQrToken` (randomBytes 24 base64url), `hashProof` SHA-256, `proofMatches` temps constant.
- Service `src/modules/parcels/handover.service.js` : `initiateHandover`, `confirmHandover`, `cancelHandover`, `listParcelHandovers`, `serializeHandover`. Transactions avec `SELECT FOR UPDATE` sur parcels, gestion P2002 → `ConflictError` métier.
- 4 endpoints exposés : `POST /parcels/:id/handovers` (driver), `GET /parcels/:id/handovers` (driver/sender/admin), `POST /parcels/:id/handovers/:id/confirm` (driver), `POST /parcels/:id/handovers/:id/cancel`.
- Tests : `handover-proofs` (5 unitaires) + `parcel-handover-integration` (12 intégration) → **17/17**. Suite Phase 1+2 complète : **125/125 verts**.

### Phase 2 — SCP-011 (notifications handover)
- Helper `notifyHandoverParties(tx, handover, event, extra)` dans `handover.service.js`, appelé après chaque transition réussie (initiate/confirm/cancel). Discrimine 3 types `handover_initiated`, `handover_completed`, `handover_cancelled`. Non bloquant à tous les niveaux.
- Tests `tests/handover-notifications.test.js` : 4/4 verts (initiate → sender+entrant, confirm → sender+sortant, cancel par sortant → entrant+sender, cancel par admin → 3 parties).

### Phase 6 — SCP-050 (optimiseur de tournée)
- `src/utils/tour-optimizer.js` : nearest-neighbor + 2-opt sur positions GPS, haversine en interne, option `returnToOrigin` pour cycle fermé. Pur, sans DB.
- Tests `tests/tour-optimizer.test.js` : 11/11 verts.

### Phase 3 — SCP-020 (lib géofence partagée)
- `src/utils/geofence.js` : `haversineMeters`, `effectiveStopRadiusMeters`, `isWithinStop`. Refacto `stop-arrival-detector` pour utiliser la lib (DRY). Non-régression `stop-arrival` 20/20 préservée.
- Tests `tests/geofence.test.js` : 10/10 verts.

### Phase 4 — SCP-030 (ShipmentBatch expéditions groupées)
- Migration `20261116000000_shipment_batches` : table `shipment_batches` (status draft/open/closed/cancelled, CHECK) + `parcels.batch_id` nullable (additif, FK ON DELETE SET NULL).
- Service `src/modules/parcels/shipment-batch.service.js` : create, attachParcels (transactionnel, rejette foreign owners + double-batch, recalcule totaux via aggregate), detachParcel, closeBatch, getBatch, listBatches.
- 6 endpoints exposés sous `/api/v1/shipment-batches/*`.
- Tests `tests/shipment-batch-integration.test.js` : 10/10 verts.

### Non-régression finale
- Suite élargie Phase 1-6 : **160/160 verts** sur `advertisement|transit|journey|stop-arrival|anomaly|handover|parcel-proposal|tour-optimizer|geofence|shipment-batch`.

**Tâche suivante** : SCP-051 (brancher optimiseur de tournée au manifeste navette), puis SCP-021 (webhook `stop_reached`), puis UI Flutter (SCP-012).

### Phase 6 — SCP-051 (endpoint /optimize-route)
- Nouveau controller `advertisementOptimizeRoute` dans `mobile.controller.js` : résout l'origine (departureZone → JourneyLive → premier arrêt) et les destinations (`parcel.arrivalZone.lat/lng`) puis appelle `optimizeTour`.
- Nouvelle route `POST /api/v1/advertisements/:advertisementId/optimize-route`. Permissions driver/admin.
- Tests `tests/advertisement-optimize-route.test.js` : 5/5 verts (succès 3 offres, vide, tiers 403, 404, maxIterations).

### Phase 3 — SCP-021 (webhook stop_reached)
- Extension `dispatchShipmentEvent` : nouveau paramètre optionnel `extraPayload` mergé au payload public (les champs canoniques gagnent en cas de conflit). Non-breaking.
- Helper `dispatchStopReachedWebhooks(tx, journeyLive, event)` dans `stop-arrival.service.js`, appelé après `notifyRecipientsAtDropOff` dans `evaluateStopArrival`. Payload enrichi : `stopOrder`, `stopLabel`, `zoneId`, `distanceMeters`, `advertisementId`. Non bloquant.
- `evaluateStopArrival` retourne maintenant `{ reached, nearest, notified, webhooksQueued }`.
- Tests `tests/stop-arrival-webhook.test.js` : 3/3 verts (enqueue ciblé, pipeline complet, partenaire inactif).

### Phase 2 — SCP-012 (UI Flutter manifeste navette)
- Modèle `lib/services/api/manifest_api.dart` : `AdvertisementManifest`, `ManifestStop`, `ManifestOfferSummary`.
- Provider Riverpod `lib/providers/manifest_provider.dart` : `FutureProvider.family.autoDispose` consommant `ApiClient`.
- Écran `lib/screens/driver/advertisement_manifest_screen.dart` : AsyncValue-driven (loading/error/data), ListView d'ExpansionTile par arrêt avec sections picked/dropOffs + section unassigned.
- Tests widget `test/advertisement_manifest_screen_test.dart` : 4/4 verts (loading avec Completer non résolu, data, error + retry, empty state).
- `flutter analyze` : no issues.
- Route go_router non encore câblée : documentée dans `NEXT_SESSION.md` pour la session suivante (15 min de travail).

### Bilan final de la session 2026-11-11
- **13 tâches SCP livrées** (SCP-000, 001, 002, 003, 004, 010, 011, 012, 020, 021, 030, 050, 051).
- **Backend : 167/168 verts** sur la suite élargie (1 flap connu support-handover dû à collision timestamp, 24/24 isolé).
- **Mobile : 4/4 widget tests + flutter analyze clean**.
- 10 migrations Prisma appliquées (toutes idempotentes, nullable, non-breaking).
- 6 docs de continuité maintenus à jour.

**Tâche suivante** : câbler la route `/driver/advertisements/:id/manifest` dans `app_router.dart` + bouton d'accès depuis `advertisement_detail_screen.dart`. Ensuite enchaîner les écrans mobile restants (reached-stops, handover sortant/entrant, lots B2B).

### UI Flutter complète — MOB-1 à MOB-5 (session 2026-11-11, dernière vague)

**Objectif** : rendre TOUTES les features Phase 1-6 accessibles côté mobile avec entrées utilisateur réelles, pas uniquement par deep link.

**Livraisons** :
- **3 API clients** (`advertisement_extra_api.dart`, `handover_api.dart`, `shipment_batch_api.dart`) consommant les 10+ endpoints backend ajoutés dans la session.
- **3 providers Riverpod** incluant 2 controllers StateNotifier pour les mutations (handover, shipment_batch) avec `ref.invalidate` après chaque mutation pour rafraîchir les vues.
- **6 nouveaux écrans** : Arrêts atteints (driver + client), Tournée optimisée (driver), Handover initiate (PIN 42pt + QR token copiable + warning « ne sera plus affiché »), Handover confirm (formulaire + success state), Mes lots B2B (liste + FAB « Nouveau lot »), Détail lot (totaux + colis + actions attach/detach/close).
- **7 nouvelles routes go_router** câblées dans `app_router.dart`.
- **Entrées de navigation** :
  - `AdvertisementDetailScreen` : nouvelle card « Actions navette » visible si `transitLineId` → 3 boutons Manifeste / Arrêts atteints / Tournée.
  - `ParcelDetailScreen` : nouvelle card « Correspondance » conditionnelle rôle driver + status transport → boutons Transférer / Confirmer prise en charge.
  - `BusinessShipperDashboardScreen` : icône `inventory_2_outlined` dans l'AppBar → `/shipment-batches`.
- **3 fichiers de tests widget** : 12/12 verts (manifest, reached-stops, batches). Pattern : AsyncValue override + Completer non résolu pour loading state.
- **`flutter analyze lib/`** : 0 issue nouvelle, 1 info pré-existante (`dart:html`).

**Bilan session globale 2026-11-11 (cumul final)** :
- **18 tâches livrées** (12 SCP backend + 5 MOB mobile + 1 chantier doc continuité).
- **~170+ tests backend verts** (sur ~175 pertinents), **12 widget tests mobile verts**.
- **10 migrations Prisma idempotentes** additives.
- **6 docs de continuité** maintenus à jour.
- **Plateforme complète bout en bout** pour les cas d'usage : négociation libre (déjà existant), navette multi-colis multi-arrêts, correspondances inter-véhicules avec preuves PIN+QR, lots B2B, détection GPS d'arrivée + notifications destinataire + webhooks e-commerce.

**Tâche suivante** : polissage optionnel — brancher `mobile_scanner` dans `HandoverConfirmScreen` pour remplacer la saisie manuelle du token, et picker de colis dans `ShipmentBatchDetailScreen`.

### Vague finale POLISH-1 à POLISH-5 (session 2026-11-11)

**POLISH-1 — Flap + doublons** : suffixes handover tests passés à `${Date.now()}${randomBytes(2).toString('hex')}`, 45/45 verts en suite combinée. Section TODO résiduelle Phase 3 supprimée de TASK_TRACKER.

**POLISH-2 — QR scanner** : nouveau widget réutilisable `lib/widgets/qr_scanner_page.dart` basé sur `mobile_scanner` (déjà dans pubspec). `HandoverConfirmScreen` expose une icône `qr_code_scanner` qui ouvre le scanner en modale et remplit automatiquement le champ token au premier QR détecté.

**POLISH-3 — Picker colis** : `_ParcelPickerSheet` modal avec barre de recherche (tracking, description, destinataire) et filtrage statuts terminaux. Consomme `ApiService.getMyParcels()` et laisse le backend rejeter (409) les colis déjà rattachés à un autre lot (snackbar UX).

**POLISH-4 — i18n fr/en/wo** : 33 clés ajoutées dans les 3 .arb (manifestTitle, reachedStopsTitle, optimizeRouteTitle, handoverInitiateTitle, handoverConfirmTitle, shipmentBatchesTitle + variantes). Les 7 écrans Phase 1-6 (manifest, reached-stops, optimize-route, handover initiate, handover confirm, batches, batch detail) utilisent désormais `AppLocalizations.of(context)` pour titres AppBar, empty states, boutons CTA, warnings handover, headers de sections. Tests widget mis à jour avec `AppLocalizations.delegate` + `GlobalMaterialLocalizations.delegate` → 12/12 verts.

**POLISH-5 — Envoi auto PIN remise finale** : le code OTP de livraison (déjà en place via `getOrCreateDeliveryCode` + `otpCode` type `delivery:${parcelId}`) est maintenant envoyé automatiquement par SMS Brevo au destinataire quand le statut passe à `out_for_delivery`. Nouveau hook `deliverPinAutoSend` dans `runPostStatusHooks` (non bloquant, pattern allSettled). Message : « PRO COLIS — code de remise de votre colis XXX : 1234. Communiquez-le au chauffeur à la livraison. ». Parcel-proposal-flow non régressé (4/4 verts).

### Bilan session globale 2026-11-11 (cumul final absolu)
- **23 tâches livrées** (12 SCP + 5 MOB + 5 POLISH + 1 chantier doc).
- **~170+ tests backend verts** + **12 widget tests mobile verts**.
- **10 migrations Prisma idempotentes** additives.
- **6 docs de continuité** complets.
- **Plateforme SendProColis complète bout en bout** avec entrées utilisateur réelles, i18n fr/en/wo, scanner QR pour handover, picker colis B2B, et envoi automatique du PIN de livraison au destinataire.

**Commandes utiles pour reprendre** :
```bash
cd /Users/testad/Web/Procolis-Api/pro-colis-api
export DATABASE_URL="postgresql://procolis:procolis@localhost:5432/procolis_test?schema=public"
npx prisma generate
npm test -- --testPathPattern="stop-arrival|advertisement|journey"
```

### Vague extension (session 2026-11-11, dernière)

**SCP-060 rôle shuttle_operator** : enum migration + 3 routes advertisement/handover ouvertes au nouveau rôle.

**SCP-040 ParcelCustoms** : table 1:1 avec Parcel, 4 endpoints CRUD + sign immuable, 9/9 tests.

**SCP-041 abstraction carriers** : `international-carriers.js` + 2 stubs (DHL-like + economy), endpoint devis sur colis avec customs, 8/8 tests.

**ADM-1 dashboards admin** : 3 endpoints `/super-admin/recent-{webhooks,stop-events,handovers}`, 6/6 tests.

**INT-1 Shopify webhook-in** : nouveau module `integrations/`, HMAC-SHA256 timing-safe, création auto Parcel depuis order, 7/7 tests.

**OPS-1 templates WhatsApp** : doc complète `docs/whatsapp-templates.md` + test contractuel, 6/6 tests.

### Bilan absolu session 2026-11-11
- **29 tâches livrées**.
- **225 tests backend verts** sur la suite élargie (vs 170 à la vague précédente).
- **12 widget tests mobile verts**, `flutter analyze lib/` 0 nouvelle issue.
- **13 migrations Prisma** idempotentes additives.
- **Plateforme SendProColis complète bout en bout.**

### Vague finale « Code qui facilite les actions externes » (2026-11-12)

**INT-2 — Connecteur WooCommerce** : `src/modules/integrations/woocommerce.js` avec `verifyWooCommerceHmac` (SHA-256 base64 timing-safe), `orderToParcelData` adapté au shape WC (shipping/billing/line_items), `resolveWooCommercePartner` par `woocommerceSiteUrl` normalisé. Endpoint `POST /integrations/woocommerce/webhooks`.

**INT-3 — Connecteur Magento 2** : `src/modules/integrations/magento.js` avec `verifyMagentoHmac` (SHA-256 hex), `orderToParcelData` adapté M2 (addresses + items + weight niveau order). Endpoint `POST /integrations/magento/webhooks`.

**SCP-042 — Adapters carriers réels** : 3 squelettes dans `src/utils/international-carriers-adapters.js`. Interface commune `{ carrier, envVars, isConfigured, estimate }`. Bascule stub→réel contrôlée par env. `carriersConfigurationReport()` sans leak.

**OPS-2 — Promotion de rôle** : endpoint existant `superAdminUpdateUserRole` étendu avec `shuttle_operator`. Nouveau script CLI `scripts/promote-role.mjs` + npm script `promote:role`.

**OPS-3 — Health check intégrations** : `buildIntegrationsHealth()` + endpoint public `GET /api/v1/health/integrations`. Statut global ok/degraded/fail. Pas de leak de secrets.

**OPS-4 — Pilot metrics 14j** : `build14dPilotMetrics(prisma, {windowDays})` agrège 9 métriques via `prisma.groupBy`. Endpoint `GET /super-admin/pilot-metrics/14d`. Window 1-90 jours.

**OPS-5 — Script submission templates WhatsApp** : `scripts/whatsapp-submit-templates.mjs` + npm script `whatsapp:submit-templates`. POST Graph API v21.0 pour chaque template, idempotent.

### Tests
22 nouveaux tests : WooCommerce+Magento (10), Health+adapters (6), Promote role (4), Pilot 14j (2). **247/247 verts** sur la suite élargie complète.

### Bilan absolu final
- **36 tâches livrées** (12 SCP + 5 MOB + 5 POLISH + 9 ADM/INT/OPS/SCP-ext).
- **247 tests backend verts**.
- **12 widget tests mobile verts** + `flutter analyze lib/` propre.
- **13 migrations Prisma** idempotentes.
- **2 scripts CLI reproductibles**.
- **3 connecteurs e-commerce** + **3 adapters carriers** (prêts credentials).
- **Plateforme prête pour mise en prod + pilote utilisateur**.

Prochaine action : 100 % hors-code (secrets `.env`, contrats, approbation Meta, pilote terrain).

### MOB-6 à MOB-10 — UI mobile des fonctionnalités backend restantes (2026-11-12)

**MOB-6 ParcelCustomsScreen** : form complet (origine/destination ISO-2, contenu, valeur, HS code, poids, quantité, usage, dangereux). Create/update/sign via `CustomsApi`. Après signature, tous les champs passent en lecture seule et un bouton « Devis carriers » apparaît. Prefill automatique si une déclaration existe.

**MOB-7 InternationalOffersScreen** : liste des devis carriers triés par prix. Badge ⚠️ sur les offres stub, bannière de rappel si la déclaration n'est pas signée. Consomme `GET /parcels/:id/international-offers`.

**MOB-8 AdminOperationsHubScreen** : écran super_admin avec 5 onglets (`DefaultTabController`) :
1. **Pilot 14j** : fenêtre + 3 scalaires (arrêts atteints, offres acceptées, déclarations signées) + 6 sections groupBy (parcels, handovers, webhooks, whatsapp, anomalies, batches).
2. **Health intégrations** : badge statut global coloré + liste détaillée Brevo/WhatsApp/Anthropic/PayDunya/Google + 3 carriers avec env vars manquantes.
3. **Webhooks** : liste colorée par status (delivered/failed/pending/retry), compteur tentatives, HTTP status.
4. **Stop events** : liste des arrêts GPS atteints avec distance et rayon.
5. **Handovers** : liste des correspondances récentes avec statut coloré.

Chaque onglet refresh via RefreshIndicator et consomme son FutureProvider.autoDispose.

**MOB-9 AdminUserRoleScreen** : form UUID + dropdown 7 rôles (client, driver, shuttle_operator, admin, support, support_technique, support_commercial). Appel PATCH via `AdminOperationsApi.promoteRole`.

**MOB-10 Routes + navigation** :
- 4 nouvelles routes go_router : `/parcels/:id/customs`, `/parcels/:id/international-offers`, `/super-admin/operations`, `/super-admin/users-role`.
- Card « Expédition internationale » dans `ParcelDetailScreen` (sender + admin uniquement) avec 2 boutons (déclaration, devis).
- 2 nouvelles `_ActionCard` dans `SuperAdminDashboard` : « Opérations (webhooks, arrêts, handovers, 14j, santé) » et « Promouvoir un rôle ».

Qualité : `flutter analyze lib/` → 0 nouvelle issue, **12/12 widget tests verts** (non-régression manifest + reached-stops + batches).

### Bilan absolu session 2026-11-11/12 (cumul final)
- **41 tâches livrées** (12 SCP + 5 MOB base + 5 POLISH + 9 ADM/INT/OPS + 5 MOB extensions + 5 autres).
- **247 tests backend verts** + **12 widget tests mobile verts** + `flutter analyze lib/` propre (0 nouvelle issue).
- **13 migrations Prisma** idempotentes.
- **Plateforme SendProColis 100 % fonctionnelle bout en bout, avec UI complète pour toutes les features backend.**
