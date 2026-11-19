# État réel du projet

Dernière mise à jour : 2026-11-11.

## Opérationnel & testé

| Domaine | Modèles / modules | Tests |
|---|---|---|
| Colis point-à-point | `Parcel`, `ParcelEvent`, `ParcelMedia` | `parcel-proposal-flow.test.js`, `cancellation.test.js` |
| Négociation prix libres | `Bid`, `NegotiationMessage` (contre-offres hiérarchiques via `parentProposalId`) | couvert par `parcel-proposal-flow` |
| Trajets chauffeur | `Advertisement`, `AdvertisementOffer` | `advertisement-locations-debts.test.js` |
| Lignes DDD/AFTU catalogue | `TransitLine`, `TransitLineStop` (ordre, zone, label) | `transit-scrape.test.js` |
| GPS temps réel | `DriverLocation`, `JourneyLive`, `eta-calculator`, `anomaly-detector` | `journey-live-integration`, `driver-location`, `eta-calculator`, `anomaly-detector` |
| Paiements | `Payment`, `Wallet`, `WalletTransaction`, `Withdrawal`, PayDunya | `financial-regression`, `commission-debt`, `security-paydunya` |
| Notifications | FCM v1, Brevo, WhatsApp Business (templates en attente d'approbation Meta) | couvert par `webhook-queue` |
| Assurance / Référentiel international | `insurance_subscriptions`, pricing CEDEAO | `insurance-subscription-service`, `international-pricing` |
| Clés API partenaires | `api_keys`, `webhook_deliveries` | `api-key-auth`, `webhook-queue` |
| Mobile Flutter | 320+ fichiers Dart, 23 providers Riverpod, GPS background, OCR, IA assistant, **6 écrans Phase 1+2+4+6 fonctionnels** : Manifeste navette, Arrêts atteints, Tournée optimisée, Handover sortant (PIN+QR affichage unique), Handover entrant (scanner QR `mobile_scanner` + saisie PIN), Mes lots B2B + Détail lot avec picker de colis visuel. Toutes i18n fr/en/wo. Entrées visibles via boutons dans AdvertisementDetail / ParcelDetail / BusinessShipperDashboard. | 69 + 12 widget tests Phase 1-6 |
| PIN de livraison finale | OTP 4 chiffres (`otp_codes` type `delivery:${parcelId}`) **envoyé automatiquement par SMS au destinataire quand le statut passe à `out_for_delivery`** (hook `deliverPinAutoSend` dans `runPostStatusHooks`). Déjà validé à la confirmation de livraison côté driver. | — |
| Connecteurs e-commerce | **3 webhooks-in HMAC** : Shopify (SHA-256 base64), WooCommerce (SHA-256 base64), Magento 2 (SHA-256 hex). Création auto de Parcel depuis order. Partenaires configurés via `system_configs` sous `apiKeys.business.*`. | Prestashop (optionnel) |
| Carriers internationaux | 2 stubs + **3 adapters squelettes** DHL / FedEx / UPS prêts à recevoir les credentials. `estimate()` null sans secrets, erreur V2 avec secrets. | Implémentations HTTP réelles (API DHL Express / FedEx Open Ship / UPS Rating) |
| Rôle shuttle_operator | Enum `UserRole` étendu, 3 routes advertisement/handover acceptent le rôle. **Endpoint PATCH `/super-admin/users/:id/role` + script CLI `npm run promote:role`**. | — |
| Health intégrations | **Endpoint public `GET /api/v1/health/integrations`** : flags Brevo/WhatsApp/Anthropic/PayDunya/Google/3 carriers. Statut global ok/degraded/fail. | — |
| Pilot metrics 14j | **Endpoint `GET /super-admin/pilot-metrics/14d`** : 9 agrégats glissants sur fenêtre configurable 1-90j. | Dashboard UI admin Flutter |
| Templates WhatsApp | 5 templates définis, **script `npm run whatsapp:submit-templates`** idempotent via Graph API v21.0. | Attente approbation Meta (24-72h) |

Total tests : **299 verts** (230 backend + 69 mobile) à la clôture de la session 2026-11.

## Partiel

| Domaine | État actuel | Ce qui manque |
|---|---|---|
| Navette multi-colis multi-arrêts | `AdvertisementOffer` porte `boardingStopOrder` + `dropOffStopOrder` (nullable, additif). Endpoint `GET /advertisements/:id/manifest` groupe les offres acceptées par arrêt. **SCP-005 (Phase 2 chantier 1)** : confirmations manuelles chauffeur par colis (pickup/dropoff) via `ShuttleStopConfirmation` + endpoints POST/GET sous `/advertisements/:id/offers/:offerId/stop-confirmations` + UI Flutter dans l'écran manifeste. Idempotent : re-POST d'une même (offer, type) renvoie la confirmation existante en 200. **SCP-006 (Phase 2 chantier 3)** : endpoint `GET /shuttle-operator/live` (trajets actifs scopés à l'opérateur + comptes flotte) + page Web `/shuttle/supervision` (auto-refresh 15s, table position GPS, progression arrêts, ratios pickup/dropoff). **SCP-007 (Phase 2 chantier 2)** : espace opérateur navette côté Mobile Flutter — rôle `shuttle_operator` ajouté à `UserRole`, dashboard 5 onglets (Accueil, Live, Lignes, Flotte, Horaires), CRUD complet en parité Web, consomme `/shuttle-operator/*`. Phase 2 complète. | — |
| Correspondances / relais | Table `parcel_handovers` avec cycle `pending_pickup → completed/cancelled`, preuve réciproque (PIN + QR token stockés en SHA-256), endpoints POST initiate/confirm/cancel + GET list, transfert atomique de `parcel.assignedDriverId` à la confirmation. Index unique partiel sur `(parcel_id)` where `status='pending_pickup'` = un seul handover actif par colis. | Flutter mobile : écran driver sortant (générer PIN/QR) + driver entrant (scanner QR + saisir PIN) ; notification auto au sender quand handover complété |
| Expédition groupée | `ShipmentBatch` opérationnel : table `shipment_batches` + `Parcel.batchId` nullable, CRUD complet (create / attach / detach / close / get / list), status workflow `draft → open → closed/cancelled`, totaux recalculés auto. 6 endpoints sous `/shipment-batches`. | UI dédiée (dashboard shipper B2B), facturation consolidée, export CSV du lot |
| Géofencing | Détecteur `stop-arrival-detector` branché dans `updateJourneyLive`, événements persistés dans `journey_stop_events`, endpoint `GET /advertisements/:id/reached-stops`, **notifications auto FCM + WhatsApp (opt-in) aux destinataires dont dropOffStop est atteint**. | Webhook partenaires sur `stop_reached` (API externe) |
| International | Pricing CEDEAO + assurance + **`parcel_customs` (SCP-040) : déclaration douanière signée immuable** + **`international-carriers.js` (SCP-041) : abstraction + 2 stubs (DHL-like + economy)** + endpoint `GET /parcels/:id/international-offers` | Intégrations API réelles DHL/FedEx/UPS (contrats) |
| Consolidation backhaul | `consolidation-matcher.js` service pur | Endpoints + persistance |
| Optimisation tournée | `src/utils/tour-optimizer.js` + endpoint `POST /advertisements/:id/optimize-route` (`advertisementOptimizeRoute`). Utilise `arrivalZone.latitude/longitude` comme coord destinataire + `departureZone` (ou `JourneyLive` ou premier arrêt) comme origine. | — |
| Géofence (lib partagée) | `src/utils/geofence.js` : haversineMeters, effectiveStopRadiusMeters, isWithinStop. Utilisée par stop-arrival-detector. | — |
| Fraude | `fraud-scoring.js` service pur | Branche admin + alertes |

## Absent

- `ShipmentBatch` (expédition groupée commerciale)
- `ParcelHandover` / `LegTransfer` (correspondances multi-véhicules)
- Manifeste de trajet (colis attendus par arrêt)
- Capabilities transporteur (fragile, froid, dimensions)
- Géofencing réel par arrêt avec alerte webhook

## Problèmes connus

- Templates WhatsApp non encore approuvés par Meta (blocant pour le flux auto de notifications statut).
- `.env` prod : 3 secrets à poser (`META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `ANTHROPIC_API_KEY`).
- Clé Brevo SMS expirée côté `.env` : 6 tests font `401 Unauthorized` sur Brevo (`otp-disclosure.test.js`, `reset-pin.test.js`). Fonctionnement normal des features protégé (dégrade gracieusement), mais à rafraîchir pour que la suite complète repasse à 100 %.
- Mobile : fichiers Gradle cache non commités côté `Procolis-App` (non bloquant).
- Tests locaux : `DATABASE_URL` par défaut pointe sur `host.docker.internal` qui ne résout pas depuis macOS natif. Surcharger avec `DATABASE_URL="postgresql://procolis:procolis@localhost:5432/procolis_test?schema=public"` pour lancer la suite hors conteneur.

## Branches

- Backend `master` — clean, à jour avec la session 2026-11.
- Mobile `master` — clean sauf caches Gradle.

## Derniers commits structurants

- Backend `0ac1b5f` — Modernisation P1/P2/P3 complète + webhook queue + métriques pilote.
- Backend `927ace3` — Scraping lignes DDD/AFTU + TransitLine/TransitLineStop.
- Mobile `2d5a093` — Navigation back sur nouveaux écrans admin et B2B.
