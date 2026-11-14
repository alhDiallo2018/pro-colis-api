# Décisions d'architecture

Historique chronologique. Chaque entrée : date, décision, raison, alternatives rejetées.

## 2026-11-11 — Affectation d'arrêts portée par `AdvertisementOffer`

**Décision** : ajouter deux colonnes nullables `boarding_stop_order` + `drop_off_stop_order` à `advertisement_offers`, référencées logiquement (pas en FK stricte) à `transit_line_stops.(transit_line_id, order)` via la relation `advertisement.transitLineId`.

**Raison** :
- Une offre réserve déjà une capacité sur un trajet donné (`AdvertisementOffer` → `Advertisement`), donc elle est le lieu naturel d'attachement du couple embarquement/descente.
- Nullable : préserve les offres sur annonces libres (sans `transitLineId`), qui restent valides (bus privés, voitures particulières).
- Composite FK sur `(transitLineId, order)` évitée parce que `transitLineId` est porté par `Advertisement` et non par `AdvertisementOffer` ; une FK imbriquée via la relation impliquerait une dénormalisation ou un trigger. La validation applicative est plus simple et lisible.

**Alternatives rejetées** :
- Déplacer les champs sur `Parcel` : non, un même colis pourrait théoriquement voyager sur plusieurs trajets (phase 2). Les arrêts sont contextuels à l'offre, pas intrinsèques au colis.
- Nouvelle table `ParcelStopAssignment` : prématuré. Si la phase 2 (handover) l'exige, on introduira alors un modèle dédié qui référence `AdvertisementOffer` + `TransitLineStop`.

## 2026-11-11 — Ne pas fusionner `Bid` et `AdvertisementOffer`

**Décision** : conserver les deux modèles distincts.

**Raison** :
- `Bid` = négociation sur un `Parcel` isolé (le client publie, les chauffeurs enchérissent, contre-offres par `parentProposalId`).
- `AdvertisementOffer` = réservation d'une capacité sur un `Advertisement` publié par un chauffeur (le chauffeur publie, les clients postulent).
- Les parcours UX, les acteurs initiateurs et les contraintes de capacité sont différents. Fusionner forcerait des champs optionnels des deux côtés et un routeur applicatif complexe.

**Alternatives rejetées** :
- Table polymorphique unique `Offer(context: 'parcel'|'advertisement', ...)` : complexifie la lecture et empêche les index spécifiques.

## 2026-11-11 — `ShipmentBatch` ajouté au-dessus de `Parcel`, pas à côté

**Décision** : expéditions groupées modélisées via `ShipmentBatch` + `Parcel.batchId` nullable. Un colis conserve son modèle actuel (tracking indépendant, status, driver assigné, négociation libre) ; le batch est un **wrapper commercial** pour N colis. `Parcel.batchId` est nullable : les colis isolés historiques ne sont pas affectés.

**Raison** :
- Rétrocompatibilité totale avec l'API existante et les parcours client isolés.
- Permet le cas B2B/e-commerce (N colis en une opération) sans casser le modèle Parcel qui est le cœur métier.
- Agrégats (`totalParcels`, `totalWeightKg`) calculés par transaction via `prisma.aggregate`, pas via triggers SQL → logique lisible, testable.

**Alternatives rejetées** :
- Transformer `Parcel` en modèle polymorphique "colis ou batch" : explosion de champs optionnels, UX cassée.
- Table de jointure many-to-many : surdimensionné (un colis appartient à au plus un batch par design commercial).

## 2026-11-11 — Optimiseur de tournée en service pur (2-opt sur open path)

**Décision** : `optimizeTour({ origin, stops, config })` opère sur un chemin ouvert `[origin, ...stops]`. Le flag `returnToOrigin` n'est appliqué qu'à la **distance mesurée** (ajout haversine de la dernière étape vers l'origin), pas au tableau retourné. Le 2-opt ne touche jamais à `origin` (index 0 fixe).

**Raison** :
- Sépare la représentation (liste d'arrêts) du métrique (distance avec ou sans retour).
- Évite les bugs où 2-opt réordonnerait un depot final et casserait l'invariant "l'arrêt final est le depot".
- Déterministe : toute entrée identique → même sortie (vérifié par test).

**Alternatives rejetées** :
- Inclure le depot final dans la route et le filtrer après 2-opt : fragile car 2-opt peut échanger un segment contenant le depot.

## 2026-11-11 — Preuves de handover : PIN + QR token stockés en hash SHA-256

**Décision** : à l'initiation d'un `ParcelHandover`, générer un PIN 6 chiffres (`crypto.randomInt`) + un QR token opaque 24 octets (`crypto.randomBytes` base64url). Ces deux secrets sont renvoyés **une seule fois** dans la réponse HTTP d'initiate, puis **jamais plus** : seul leur hash SHA-256 est persisté. La confirmation exige les deux ensemble.

**Raison** :
- Protection contre le vol : même si la base est compromise, un attaquant ne peut pas confirmer un handover sans le PIN + QR en clair.
- Double facteur : l'oral/SMS (PIN) + le visuel (QR imprimé/affiché) complique l'usurpation.
- `pickupPinLast4` conservé pour que le driver sortant retrouve visuellement « son » handover sans ré-exposer le secret.

**Alternatives rejetées** :
- JWT signé : plus lourd, et impose un secret global côté serveur à faire tourner. Un hash ciblé par handover est auto-contenu.
- Stockage en clair (comme certains codes OTP de 2 min) : la fenêtre d'un handover peut durer des heures (temps d'arriver à l'arrêt de correspondance), stockage clair non acceptable.

## 2026-11-11 — Un seul handover actif par colis via index unique partiel

**Décision** : contrainte unique `CREATE UNIQUE INDEX ... WHERE status = 'pending_pickup'` sur `parcel_handovers.(parcel_id)`. Un colis ne peut avoir qu'un handover `pending_pickup` à la fois, mais autant de `cancelled`/`completed` historiques que nécessaire.

**Raison** :
- Évite la race entre deux driver sortants (impossible normalement, mais sécurise contre bug applicatif).
- Permet au driver sortant de **ré-initier** un handover après un cancel (test couvre ce cas).
- Pas de blocage sur les colis multi-étapes réels : Dakar→Thiès→Mbour = 2 handovers séquentiels, jamais simultanés.

**Alternatives rejetées** :
- Contrainte au niveau applicatif seul : subit la race. Fallback applicatif conservé (try/catch sur P2002) pour messages d'erreur métier clairs.

## 2026-11-11 — Endpoint manifeste `GET /advertisements/:id/manifest`

**Décision** : exposer un endpoint spécifique plutôt qu'enrichir `GET /advertisements/:id/offers`. Permissions élargies (driver + super_admin + clients avec offre acceptée) pour que le destinataire puisse consulter la progression du trajet.

**Raison** :
- La vue manifeste a une logique de **groupement par arrêt** différente de la vue plate des offres. Deux responsabilités séparées.
- Les clients avec une offre acceptée sont des destinataires légitimes du manifeste (ils vont attendre à un arrêt), d'où l'ouverture de la permission au-delà du driver.
- Le payload inclut `unassigned` pour les offres acceptées sans affectation d'arrêt (legacy ou annonces libres), afin que le driver ne manque pas de colis à charger.

**Alternatives rejetées** :
- Enrichir `GET /advertisements/:id` avec un champ `manifest` : le payload existant est déjà volumineux et non filtré par statut d'offre. Un endpoint dédié est plus lisible.

## 2026-11-11 — Enrichissements non-breaking pilotés par `SystemConfig.*.enabled`

**Décision** : chaque nouvelle feature exposée au mobile ajoute des champs optionnels (jamais obligatoires) et est pilotée par une clé `*.enabled` dans `system_configs`.

**Raison** : hérité de la session 2026-11 (chantiers ETA, anomalies, driver-scoring). Permet un kill-switch sans redéploiement et préserve les builds mobiles antérieurs.

**À appliquer** à SCP-003 (détection d'arrivée) : config `transitArrival.enabled`.
