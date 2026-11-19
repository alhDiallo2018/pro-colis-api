# Suivi des tâches

Identifiants `SCP-xxx` stables d'une session à l'autre. Statuts : TODO / IN_PROGRESS / BLOCKED / DONE.

## Phase 0 — Continuité

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-000 | Créer docs de continuité (`docs/continuous-development/*`) | P0 | 0 | DONE | les 6 .md de ce dossier | Les 6 fichiers existent et sont lisibles par un agent froid |

## Phase 1 — Multi-colis multi-arrêts (navette)

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-001 | Ajouter `boardingStopOrder` + `dropOffStopOrder` à `AdvertisementOffer` (nullable) | P0 | 1 | DONE | `prisma/schema.prisma`, migration `20261113000000_advertisement_offer_stops/` | Migration appliquée sur procolis_test, schéma validé, client régénéré |
| SCP-001b | Valider les stops côté `createAdvertisementOffer` | P0 | 1 | DONE | `src/modules/mobile/mobile.controller.js:5924`, `src/utils/transit-offer-stops.js` | Branchement actif, rejet 422 sur stops invalides |
| SCP-001c | Exposer les stops dans `serializeAdvertisementOffer` | P1 | 1 | DONE | `src/utils/mobile-serializers.js:713` + helper `resolveStopInfo` | `boardingStop` / `dropOffStop` sérialisés avec `order`, `label`, `zoneId` quand l'include transitLine.stops est présent |
| SCP-001d | Tests unitaires du validateur | P0 | 1 | DONE | `tests/transit-offer-stops.test.js` | 12 cas verts (OK, stops absents/inconnus, ordre inversé, ligne absente, string numérique, négatif) |
| SCP-002 | Endpoint `GET /advertisements/:id/manifest` (offres acceptées groupées par arrêt) | P0 | 1 | DONE | `src/modules/mobile/mobile.controller.js:6016`, `src/modules/mobile/mobile.routes.js:550`, `tests/advertisement-manifest.test.js` | 4 tests verts : driver OK, client propriétaire d'offre OK, tiers 403, annonce inexistante 404 |
| SCP-003 | Détection d'arrivée à l'arrêt via `JourneyLive` + `TransitLineStop.zoneId` | P1 | 1+3 | DONE | `src/utils/stop-arrival-detector.js`, `src/modules/trips/stop-arrival.service.js`, `src/modules/trips/live.service.js`, migration `20261114000000_journey_stop_events`, endpoint `GET /advertisements/:id/reached-stops`, tests `stop-arrival-detector` (12) + `stop-arrival-integration` (8) | Détecteur pur + ring buffer `recent_positions` + `journey_stop_events` persistant idempotent |

## SCP-004 — Notification destinataire à l'arrivée

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-004 | Notifier le client dont `dropOffStopOrder` est atteint (FCM auto + WhatsApp opt-in) | P1 | 1 | DONE | `src/modules/trips/stop-arrival.service.js` (`notifyRecipientsAtDropOff`), `tests/stop-arrival-notifications.test.js` | 3/3 tests : notification ciblée, pipeline complet, idempotence ; non bloquant ; WhatsApp opt-in only |

## SCP-005 — Confirmations manuelles d'arrêt (Phase 2, chantier 1)

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-005 | Modèle `ShuttleStopConfirmation` + endpoints driver POST/GET + UI Mobile par colis dans l'écran manifeste | P1 | 2 | DONE | migration `20261123000000_shuttle_stop_confirmations/`, `prisma/schema.prisma` (ShuttleStopConfirmation + back-refs Advertisement/AdvertisementOffer/User), `src/modules/mobile/mobile.controller.js` (`confirmAdvertisementStop`, `listAdvertisementStopConfirmations`), `src/modules/mobile/mobile.routes.js`, `tests/shuttle-stop-confirmations.test.js`, Mobile : `lib/services/api/advertisement_extra_api.dart` (ShuttleStopConfirmation + confirmStop + fetchStopConfirmations), `lib/providers/reached_stops_provider.dart` (stopConfirmationsProvider), `lib/screens/driver/advertisement_manifest_screen.dart` (bouton par colis + état) | 11/11 tests API verts : pickup/dropoff 201, idempotence applicative (200 sur re-POST), type invalide 422, offre sans arrêt 422, autre chauffeur 403, rôle client 403, offre inexistante 404, visibilité driver + client acceptant, tiers 403 ; `flutter analyze` propre sur les 3 fichiers Dart modifiés |

## SCP-006 — Dashboard de supervision cross-plateforme (Phase 2, chantier 3)

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-006 | Endpoint `GET /shuttle-operator/live` (trajets actifs scopés à l'opérateur + comptes flotte) + page Web `/shuttle/supervision` avec table auto-refresh 15s | P1 | 2 | DONE | `src/modules/shuttle/shuttle.controller.js` (`live`), `src/modules/shuttle/shuttle.routes.js`, `tests/shuttle-live.test.js`, Web : `src/lib/api/shuttle-operator.ts` (types ShuttleLive* + `getLive`), `src/features/shuttleOperator/ShuttleLivePage.tsx`, routes `screens.tsx` + `index.tsx` (nav `/shuttle/supervision` + route sous le guard `shuttle_operator`) | 5/5 tests API verts : RBAC client 403, aucune JourneyLive active → vide + fleet renseignée, trajet actif → métriques (position, stopsReached, nextStop, confirmations pickup/dropoff), ownership (autre opérateur vide), JourneyLive périmée (>60s) exclue ; `tsc -b --noEmit` clean |

## SCP-007 — Espace opérateur navette côté Mobile Flutter (Phase 2, chantier 2)

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-007 | Rôle `shuttle_operator` géré côté Mobile + dashboard 5 onglets (Accueil, Supervision live, Lignes, Flotte, Horaires) avec parité Web (CRUD complet) | P2 | 2 | DONE | Mobile : `lib/models/user.dart` (enum `UserRole.shuttleOperator` + aliases fromString + apiScope `shuttle-operator`), `lib/services/api/shuttle_operator_api.dart` (ShuttleLine/Stop + ShuttleVehicle + ShuttleSchedule + ShuttleOverview + ShuttleLiveSnapshot + CRUD), `lib/providers/shuttle_operator_provider.dart` (5 FutureProvider.autoDispose), `lib/screens/shuttle_operator/` (overview, live, lines, vehicles, schedules), `lib/screens/dashboard/shuttle_operator_dashboard.dart` (NavigationBar 5 destinations), branchement `dashboard_screen.dart` + `role_identity.dart` + `app_bottom_nav.dart` + `profile_screen.dart` + `role_profile_sections.dart` + `users_management_screen.dart` (cases exhaustifs ajoutés) | `flutter analyze lib/` : 0 erreur ; `flutter analyze` sur fichiers shuttle_operator : No issues found ; dashboard accessible dès que l'API attribue le rôle `shuttle_operator` au compte (compile-enforced via switches exhaustifs) |

## SCP-011 — Notifications handover

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-011 | Notifier sender + fromDriver + toDriver à chaque transition handover (initiate/confirm/cancel) | P1 | 2 | DONE | `src/modules/parcels/handover.service.js` (`notifyHandoverParties`), `tests/handover-notifications.test.js` | 4/4 tests : initiate (sender + entrant), confirm (sender + sortant), cancel par sortant (entrant + sender), cancel par admin (3 parties) ; non bloquant |
| SCP-012 | UI Flutter : écran « Manifeste navette » (driver) | P1 | 2 | DONE | `lib/services/api/manifest_api.dart`, `lib/providers/manifest_provider.dart`, `lib/screens/driver/advertisement_manifest_screen.dart`, `test/advertisement_manifest_screen_test.dart` | 4/4 widget tests : loading, data (stops + offres), error + retry, empty ; `flutter analyze` clean |

## MOB-* — UI Flutter complet Phase 1+2+4+6

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| MOB-1 | API clients : advertisement_extra (reached-stops + optimize-route), handover, shipment_batch | P1 | — | DONE | `lib/services/api/advertisement_extra_api.dart`, `handover_api.dart`, `shipment_batch_api.dart` | Modèles Dart complets, parsing JSON défensif, consomme `ApiClient.handle` |
| MOB-2 | Providers Riverpod : reached_stops, handover (controller avec mutations), shipment_batch (controller) | P1 | — | DONE | `lib/providers/reached_stops_provider.dart`, `handover_provider.dart`, `shipment_batch_provider.dart` | StateNotifier + FutureProvider.family.autoDispose, invalidate après mutation |
| MOB-3 | Écrans : advertisement_reached_stops, advertisement_optimize_route, handover_initiate, handover_confirm, shipment_batches, shipment_batch_detail | P1 | — | DONE | `lib/screens/driver/advertisement_reached_stops_screen.dart`, `advertisement_optimize_route_screen.dart`, `lib/screens/parcel/handover_initiate_screen.dart`, `handover_confirm_screen.dart`, `lib/screens/shipper/shipment_batches_screen.dart`, `shipment_batch_detail_screen.dart` | AsyncValue-driven (loading/error/data/empty) ; handover initiate affiche PIN grand format + QR token copiable (secrets exposés une seule fois) |
| MOB-4 | Routes go_router + entrées de navigation | P1 | — | DONE | `lib/routes/app_router.dart` (7 nouvelles routes), card « Actions navette » dans `advertisement_detail_screen.dart` (visible si transit_line), card « Correspondance » dans `parcel_detail_screen.dart` (visible si driver assigné + status transport), icône « Mes lots » dans `business_shipper_dashboard_screen.dart` AppBar | Toutes les features Phase 1-6 accessibles par un chemin utilisateur réel, pas de deep link requis |
| MOB-5 | Tests widget + `flutter analyze` global | P1 | — | DONE | `test/advertisement_manifest_screen_test.dart` (4), `advertisement_reached_stops_screen_test.dart` (4), `shipment_batches_screen_test.dart` (4) | 12/12 widget tests verts ; `flutter analyze lib/` → 1 info pré-existante (`dart:html`), rien de nouveau |

## POLISH-* — Finitions avant pilote

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| POLISH-1 | Fix flap `support-handover.test.js` + doublons TASK_TRACKER | P1 | — | DONE | `tests/handover-notifications.test.js`, `tests/parcel-handover-integration.test.js` (suffixe = ms + 2 chars random), `docs/continuous-development/TASK_TRACKER.md` | 45/45 tests handover verts en suite combinée, section TODO résiduelle supprimée |
| POLISH-2 | Intégration `mobile_scanner` dans HandoverConfirmScreen | P1 | — | DONE | `lib/widgets/qr_scanner_page.dart` (réutilisable), modifs `lib/screens/parcel/handover_confirm_screen.dart` (bouton `qr_code_scanner` ouvre le scanner, remplit le champ token) | `flutter analyze` propre, scanner fonctionne sur appareil réel |
| POLISH-3 | Picker visuel de colis dans ShipmentBatchDetailScreen | P1 | — | DONE | `_ParcelPickerSheet` dans `lib/screens/shipper/shipment_batch_detail_screen.dart`, consomme `ApiService.getMyParcels()`, filtre statuts terminaux | BottomSheet modal avec recherche + sélection par tap, analyze propre |
| POLISH-4 | i18n fr/en/wo des 6 écrans Phase 1-6 | P1 | — | DONE | `lib/l10n/app_fr.arb` (+33 clés), `lib/l10n/app_en.arb`, `lib/l10n/app_wo.arb`, 7 écrans migrés vers `AppLocalizations.of(context)`, tests widget mis à jour avec delegates | `flutter gen-l10n` OK, 12/12 widget tests verts, `flutter analyze lib/` 1 info pré-existante |
| POLISH-5 | Envoi auto du PIN de livraison au destinataire via SMS quand status → `out_for_delivery` | P1 | — | DONE | `runPostStatusHooks` dans `src/modules/mobile/mobile.controller.js` : 4ᵉ hook `deliverPinAutoSend` (non bloquant) qui appelle `getOrCreateDeliveryCode` et `sendNotificationSms` Brevo | Flux parcel-proposal-flow non régressé (4/4 verts), SMS envoyé automatiquement, code immuable |

## SCP-020 — Helper géofence

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-020 | Service pur `src/utils/geofence.js` (haversineMeters, effectiveStopRadiusMeters, isWithinStop) + DRY vers stop-arrival-detector | P1 | 3 | DONE | `src/utils/geofence.js`, `tests/geofence.test.js`, refacto `src/utils/stop-arrival-detector.js` | 10/10 tests + non-régression stop-arrival (12+8) |
| SCP-021 | Webhook partenaires e-commerce sur événement `stop_reached` | P2 | 3 | DONE | `src/modules/trips/stop-arrival.service.js` (`dispatchStopReachedWebhooks`), extension `shipment-webhook-service.js` (`extraPayload`), `tests/stop-arrival-webhook.test.js` | 3/3 tests : enqueue ciblé, pipeline complet via `evaluateStopArrival`, partenaire inactif → no-op ; payload enrichi avec stopOrder/stopLabel/distanceMeters |

## Phase 2 — Correspondances / handover

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-010 | Modèle `ParcelHandover` + endpoints initiate/confirm/cancel/list + utilitaire preuves (PIN+QR) | P1 | 2 | DONE | migration `20261115000000_parcel_handovers`, `prisma/schema.prisma` (ParcelHandover + back-refs User/Parcel/Advertisement), `src/utils/handover-proofs.js`, `src/modules/parcels/handover.service.js`, 4 endpoints dans `mobile.controller.js` + `mobile.routes.js`, tests `handover-proofs` (5) + `parcel-handover-integration` (12) | 17/17 verts : cycle complet, unique partiel, mauvais PIN rejeté, mauvais QR rejeté, driver tiers 403, cancel restitue au sortant, re-initiation après cancel OK, non-assigné 403, self-handover rejeté, colis hors transport 409, cancel après completed 409, permissions list, 404 |

## Phase 3 — Géofencing

(Voir SCP-020 et SCP-021 livrés plus bas dans les sections « SCP-020 — Helper géofence » et « Phase 3 — Géofencing complète ».)

## Phase 4 — Expédition groupée

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-030 | Modèle `ShipmentBatch` + `Parcel.batchId` + endpoints CRUD + attach/detach/close | P2 | 4 | DONE | migration `20261116000000_shipment_batches`, `prisma/schema.prisma`, `src/modules/parcels/shipment-batch.service.js`, 6 endpoints mobile.routes, `tests/shipment-batch-integration.test.js` | 10/10 tests : create, attach + totaux, foreign parcel rejeté, double-batch 409, detach, close, visibilité par créateur, 404, 422 empty |

## Phase 5 — International étendu

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-040 | `ParcelCustoms` (déclaration douanière structurée) | P3 | 5 | DONE | migration `20261118000000_parcel_customs`, `src/modules/parcels/customs.service.js`, 4 endpoints `/parcels/:id/customs*`, `tests/parcel-customs.test.js` | 9/9 tests : create, 409 duplicate, update, sign immuable, permissions, validation ISO-2, 404 |
| SCP-041 | Abstraction carriers internationaux (scaffold stub DHL + economy) + endpoint devis | P3 | 5 | DONE | `src/utils/international-carriers.js`, controller `parcelInternationalOffers`, route `GET /parcels/:id/international-offers`, `tests/international-carriers.test.js` | 8/8 tests : zones, tri par prix, SN intra-CEDEAO, validation input, prix proportionnel au poids, destination inconnue |

## Phase 7 — Rôles & intégrations

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-060 | Rôle `shuttle_operator` distinct du driver | P1 | 7 | DONE | migration `20261117000000_shuttle_operator_role`, `prisma/schema.prisma` (enum UserRole), `mobile.routes.js` (3 routes advertisement/handover acceptent le rôle) | Migration enum appliquée, routes `/advertisements` + handover ouvertes au rôle |
| ADM-1 | Dashboard admin agrégats (webhooks, stop events, handovers) | P1 | 7 | DONE | 3 controllers admin dans `mobile.controller.js`, 3 routes `/super-admin/*`, `tests/admin-dashboards.test.js` | 6/6 tests : structure, 403 non-admin, 401 anon, limit bornée 200 |
| INT-1 | Connecteur Shopify webhook-in HMAC + création Parcel depuis order | P1 | 7 | DONE | `src/modules/integrations/shopify.js`, `src/modules/integrations/integrations.routes.js`, `express.json verify` pour rawBody, `app.js`, `tests/shopify-integration.test.js` | 7/7 tests : HMAC valide/invalide, topic ignoré, shop inconnu 404, order→parcel, fulfillment no-op |
| OPS-1 | Doc templates WhatsApp Meta + test contractuel | P1 | 7 | DONE | `docs/whatsapp-templates.md` (5 templates + checklist Meta + kill-switch), `tests/whatsapp-templates-contract.test.js` | 6/6 tests : les 5 templates référencés, mapping statut-template exhaustif |
| INT-2 | Connecteur WooCommerce webhook-in HMAC | P2 | 7 | DONE | `src/modules/integrations/woocommerce.js`, route `POST /integrations/woocommerce/webhooks`, `tests/integrations-woocommerce-magento.test.js` | HMAC base64 timing-safe, resolve par siteUrl normalisé, orders/created crée Parcel |
| INT-3 | Connecteur Magento 2 webhook-in HMAC | P2 | 7 | DONE | `src/modules/integrations/magento.js`, route `POST /integrations/magento/webhooks` | HMAC hex timing-safe, resolve par storeDomain, order.placed crée Parcel |
| SCP-042 | Adapters carriers DHL/FedEx/UPS (squelettes avec isConfigured + envVars) | P3 | 5 | DONE | `src/utils/international-carriers-adapters.js`, `tests/integrations-health-adapters.test.js` | Signature contractuelle stable, bascule stub→réel contrôlée par env, pas de leak de secrets |
| OPS-2 | Extension endpoint existant superAdminUpdateUserRole + shuttle_operator + script CLI | P1 | 7 | DONE | `src/modules/mobile/mobile.controller.js` (ASSIGNABLE_ROLES étendu), `scripts/promote-role.mjs`, `tests/admin-promote-role.test.js`, npm script `promote:role` | PATCH `/super-admin/users/:id/role` accepte `shuttle_operator`, 403/422/404 couverts |
| OPS-3 | Health check intégrations + endpoint public | P1 | 7 | DONE | `src/utils/integrations-health.js`, `src/modules/health/health.routes.js` (GET `/health/integrations`) | Rapport Brevo/WhatsApp/Anthropic/PayDunya/Google/3 carriers sans leak, status ok/degraded/fail |
| OPS-4 | Dashboard pilote 14-jours (agrégats Phase 1-6) | P1 | 7 | DONE | `src/utils/pilot-metrics-14d.js`, controller + route `GET /super-admin/pilot-metrics/14d`, `tests/pilot-metrics-14d.test.js` | 9 agrégats : parcels/handovers/stops/offers/webhooks/whatsapp/anomalies/customs/batches, windowDays 1-90 |
| OPS-5 | Script submission templates WhatsApp via API Meta | P1 | 7 | DONE | `scripts/whatsapp-submit-templates.mjs`, npm script `whatsapp:submit-templates` | Idempotent, 5 templates FR UTILITY avec exemples, fetch Graph API v21.0 |

## Phase 6 — IA opérationnelle

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| SCP-050 | Optimiseur de tournée nearest-neighbor + 2-opt (service pur) | P2 | 6 | DONE | `src/utils/tour-optimizer.js`, `tests/tour-optimizer.test.js` | 11/11 : 0 stop, 1 stop, choix du plus proche, pathologique amélioré, filtrage invalides, origin invalide, returnToOrigin, improvedBy ≥ 0, bornage iterations, déterminisme, zigzag ≥ 5 arrêts |
| SCP-051 | Endpoint `POST /advertisements/:id/optimize-route` consomme `optimizeTour` | P2 | 6 | DONE | `src/modules/mobile/mobile.controller.js` (`advertisementOptimizeRoute`), `src/modules/mobile/mobile.routes.js`, `tests/advertisement-optimize-route.test.js` | 5/5 tests : 3 offres → ordre + distance, vide → 200, tiers 403, inexistante 404, maxIterations respecté |

## MOB-6 à MOB-10 — UI mobile des features backend restantes

| ID | Tâche | Prio | Phase | Statut | Fichiers | Critères d'acceptation |
|---|---|---|---|---|---|---|
| MOB-6 | Écran ParcelCustomsScreen (SCP-040) | P1 | — | DONE | `lib/services/api/customs_api.dart`, `lib/providers/customs_provider.dart`, `lib/screens/parcel/parcel_customs_screen.dart` | Form complet (origine/destination ISO-2, contenu, valeur, HS, poids, quantité, usage, dangereux), create/update/sign, lecture seule après signature |
| MOB-7 | Écran InternationalOffersScreen (SCP-041) | P1 | — | DONE | `lib/services/api/international_carriers_api.dart`, `lib/screens/parcel/international_offers_screen.dart` | Affiche les devis carriers triés par prix, tag ⚠️ sur stubs, badge si déclaration non signée |
| MOB-8 | AdminOperationsHubScreen (ADM-1 + OPS-3 + OPS-4) | P1 | — | DONE | `lib/services/api/admin_operations_api.dart`, `lib/providers/admin_operations_provider.dart`, `lib/screens/super-admin/admin_operations_hub_screen.dart` | 5 onglets Pilot 14j / Health / Webhooks / Stop events / Handovers |
| MOB-9 | AdminUserRoleScreen (OPS-2) | P1 | — | DONE | `lib/screens/super-admin/admin_user_role_screen.dart` | Form UUID + sélecteur 7 rôles dont shuttle_operator, PATCH via admin_operations_api |
| MOB-10 | Routes go_router + entrées navigation | P1 | — | DONE | 4 routes dans `app_router.dart`, card dans `parcel_detail_screen.dart`, 2 ActionCards dans `super_admin_dashboard.dart` | Toutes les features backend accessibles depuis points d'entrée utilisateur, flutter analyze propre |
