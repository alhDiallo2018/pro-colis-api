# Contrat API REST

## Conventions

- Prefixe cible : `/api/v1`.
- Compatibilite mobile initiale : accepter aussi les routes sans prefixe.
- Authentification : `Authorization: Bearer <accessToken>`.
- Dates : ISO 8601.
- Montants : `numeric`, devise par defaut `XOF`.
- Identifiants : UUID.

## Auth

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | Creer un compte client, chauffeur, admin ou super admin selon autorisation. |
| POST | `/auth/send-otp` | public | Envoyer un OTP a un email ou telephone. |
| POST | `/auth/verify-otp` | public | Verifier OTP et retourner tokens + user. |
| POST | `/auth/login-with-pin` | public | Connexion par PIN et identifiant. |
| POST | `/auth/refresh` | public | Renouveler access token. |
| POST | `/auth/forgot-password` | public | Demander reset password. |
| POST | `/auth/reset-password` | public | Reinitialiser password. |
| POST | `/auth/change-password` | authentifie | Changer password courant. |
| POST | `/auth/verify-email` | public/auth | Verifier email avec OTP. |
| POST | `/auth/resend-verification` | public/auth | Renvoyer verification email. |
| GET | `/auth/me` | authentifie | Retourner utilisateur courant. |

Payload register minimal :

```json
{
  "email": "client@example.com",
  "phone": "+221770000000",
  "fullName": "Client Test",
  "password": "Password123!",
  "role": "client",
  "address": "Dakar",
  "city": "Dakar",
  "region": "Dakar",
  "vehiclePlate": null,
  "vehicleModel": null,
  "vehicleColor": null,
  "vehicleYear": null,
  "garageId": null
}
```

## Users et profils

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| GET | `/client/debts` | client | Dettes personnelles paginées et total restant dû (FCFA). |
| PUT | `/client/profile` | client | Modifier profil client. |
| PUT | `/driver/profile` | driver | Modifier profil chauffeur. |
| PUT | `/garage-admin/profile` | admin | Modifier profil admin garage. |
| PUT | `/super-admin/profile` | super_admin | Modifier profil super admin. |
| PUT | `/users/pin` | authentifie | Modifier PIN. |
| DELETE | `/users/account` | authentifie | Suppression logique du compte courant. |
| GET | `/users/stats` | authentifie | Stats personnelles. |
| PUT | `/users/profile-photo` | authentifie | Mettre a jour photo profil. |

## Colis client/chauffeur/admin

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| GET | `/client/parcels/my-parcels` | client | Liste des colis du client, filtre `status`. |
| POST | `/client/parcels/create` | client | Creer un colis. |
| POST | `/driver/parcels/create` | driver | Creer un colis pour un client. |
| POST | `/garage-admin/parcels/create` | admin | Creer un colis depuis garage. |
| POST | `/super-admin/parcels/create` | super_admin | Creer un colis globalement. |
| GET | `/driver/parcels` | driver | Colis assignes au chauffeur. |
| GET | `/garage-admin/parcels` | admin | Colis du garage admin. |
| GET | `/super-admin/parcels` | super_admin | Tous les colis. |
| GET | `/{role}/parcels/:parcelId` | role correspondant | Detail colis selon droits. |
| PUT | `/{role}/parcels/:parcelId/status` | authentifie | Changer statut generique selon droits. |
| PATCH/POST | `/{role}/parcels/:parcelId/media` | authentifie | Associer medias uploades au colis. |
| DELETE | `/garage-admin/parcels/:parcelId` | admin | Supprimer/annuler colis garage. |
| DELETE | `/super-admin/parcels/:parcelId` | super_admin | Supprimer/annuler colis global. |
| PUT | `/super-admin/parcels/:parcelId` | super_admin | Modifier colis. |

Payload creation colis :

```json
{
  "senderName": "Awa Diop",
  "senderPhone": "+221770000001",
  "senderEmail": "awa@example.com",
  "senderId": "uuid-optionnel",
  "receiverName": "Mamadou Fall",
  "receiverPhone": "+221770000002",
  "receiverEmail": "mamadou@example.com",
  "receiverAddress": "Thies",
  "description": "Documents administratifs",
  "weight": 1.2,
  "type": "document",
  "departureGarageId": "uuid",
  "arrivalGarageId": "uuid",
  "price": 2500,
  "isUrgent": false,
  "isInsured": false,
  "driverId": "uuid-optionnel",
  "isFreeForBidding": false,
  "proposedPrice": null,
  "photoUrls": [],
  "videoUrls": [],
  "audioUrls": [],
  "notes": "Fragile"
}
```

## Cycle livraison chauffeur

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| PUT | `/driver/parcels/:parcelId/pickup` | driver | Marquer ramasse. |
| PUT | `/driver/parcels/:parcelId/transit` | driver | Marquer en transit. |
| PUT | `/driver/parcels/:parcelId/arrived` | driver | Marquer arrive au garage destination. |
| PUT | `/driver/parcels/:parcelId/out-for-delivery` | driver | Marquer en livraison finale. |
| PUT | `/driver/parcels/:parcelId/deliver` | driver | Confirmer livraison avec signature/photo. |
| POST | `/client/parcels/:parcelId/cancel` | client | Annuler si statut autorise. |

## Tracking public

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| GET | `/public/parcels/track/:trackingNumber` | public | Suivre un colis par numero. |
| GET | `/public/parcels/:parcelId/events` | public | Timeline publique. |
| GET | `/public/parcels/free` | public/auth | Colis libres pour offres. |
| GET | `/parcels/:parcelId/timeline` | authentifie | Timeline detaillee. |
| POST | `/parcels/:parcelId/notes` | authentifie | Ajouter note interne. |
| GET | `/parcels/:parcelId/notes` | authentifie | Lister notes internes. |
| GET | `/parcels/:parcelId/proof` | authentifie | Preuve de livraison. |
| POST | `/parcels/estimate` | public/auth | Estimation prix. |

## Offres et libre service

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| POST | `/driver/bids` | driver | Faire une offre sur un colis libre. |
| POST | `/client/parcels/:parcelId/bids/:bidId/accept` | client | Accepter offre. |
| POST | `/client/parcels/:parcelId/bids/:bidId/reject` | client | Rejeter offre. |
| GET | `/public/parcels/:parcelId/bids` | public/auth | Lister offres d'un colis. |
| GET | `/client/bids/stats` | client | Stats offres recues. |
| POST | `/client/bids/:bidId/negotiate` | client | Contre-proposition. |
| GET | `/client/bids/received` | client | Offres recues. |
| GET | `/driver/bids/sent` | driver | Offres envoyees. |

## Annonces chauffeur

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| GET | `/advertisements` | public/auth | Liste annonces/trajets. |
| GET | `/advertisements/my` | authentifie | Mes annonces. |
| GET | `/advertisements/drivers` | public/auth | Annonces chauffeurs. |
| POST | `/advertisements` | driver | Creer annonce de trajet. |
| GET | `/advertisements/:advertisementId` | public/auth | Detail annonce. |
| PUT | `/advertisements/:advertisementId` | owner/admin | Modifier annonce. |
| DELETE | `/advertisements/:advertisementId` | owner/admin | Supprimer annonce. |
| POST | `/advertisements/:advertisementId/offers` | client | Faire offre sur annonce. |
| GET | `/advertisements/:advertisementId/offers` | owner/admin | Lister offres annonce. |
| POST | `/advertisements/:advertisementId/offers/:offerId/accept` | owner | Accepter offre. |
| POST | `/advertisements/:advertisementId/offers/:offerId/reject` | owner | Rejeter offre. |
| POST | `/advertisements/:advertisementId/close` | owner/admin | Fermer annonce. |
| GET | `/advertisements/stats` | authentifie | Stats annonces. |

## Garages, chauffeurs et vehicules

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| GET | `/public/garages` | public | Liste garages actifs. |
| GET | `/public/drivers/search` | public/auth | Recherche chauffeurs. |
| GET | `/public/drivers/:driverId` | public/auth | Detail chauffeur public. |
| GET | `/public/drivers/garage/:garageId` | public/auth | Chauffeurs d'un garage. |
| GET | `/garage-admin/drivers` | admin | Chauffeurs du garage. |
| PUT | `/garage-admin/parcels/:parcelId/assign-driver` | admin | Assigner chauffeur. |
| POST | `/garage-admin/parcels/bulk-assign` | admin | Assignation en masse. |
| POST | `/vehicles` | admin/super_admin | Creer vehicule. |
| GET | `/vehicles` | admin/super_admin | Lister vehicules. |
| PATCH | `/vehicles/:vehicleId/status` | admin/super_admin | Changer disponibilite. |
| DELETE | `/vehicles/:vehicleId` | admin/super_admin | Supprimer vehicule. |

## Uploads

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| POST | `/upload/parcel-photo` | authentifie | Upload photo colis base64. |
| POST | `/upload/parcel-video` | authentifie | Upload video colis base64. |
| POST | `/upload/parcel-audio` | authentifie | Upload audio colis base64. |
| POST | `/upload/bid-audio` | driver | Upload audio offre. |
| POST | `/upload/base64` | authentifie | Upload generique base64. |
| POST | `/upload` | authentifie | Upload multipart generique. |

## Notifications

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| GET | `/notifications` | authentifie | Liste notifications. |
| GET | `/notifications/unread-count` | authentifie | Nombre non lues. |
| PATCH | `/notifications/:notificationId/read` | authentifie | Marquer lue. |
| POST | `/notifications/read-all` | authentifie | Tout marquer lu. |
| DELETE | `/notifications/:notificationId` | authentifie | Supprimer notification. |
| DELETE | `/notifications/all` | authentifie | Supprimer toutes. |

## Paiements et score

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| POST | `/payments/initiate` | authentifie | Initier paiement. |
| POST | `/payments/:paymentId/confirm` | authentifie/admin | Confirmer paiement. |
| GET | `/payments/history` | authentifie | Historique paiements. |
| GET | `/score` | authentifie | Score complet. |
| GET | `/score/balance` | authentifie | Solde points. |
| GET | `/score/history` | authentifie | Historique points. |
| POST | `/score/purchase` | authentifie | Achat points. |
| POST | `/score/debit` | authentifie/system | Debiter points. |
| POST | `/score/credit` | authentifie/system | Crediter points. |
| POST | `/score/refund` | authentifie/system | Rembourser points. |
| GET | `/score/stats` | authentifie | Stats score. |

## Super admin et administration

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| GET | `/super-admin/stats` | super_admin | Stats globales. |
| GET | `/super-admin/stats/advanced` | super_admin | Stats avancees. |
| GET | `/super-admin/reports/monthly` | super_admin | Rapport mensuel. |
| GET | `/super-admin/reports/daily` | super_admin | Rapport journalier. |
| GET | `/super-admin/export` | super_admin | Export donnees. |
| GET | `/super-admin/users` | super_admin | Lister utilisateurs. |
| POST | `/super-admin/users` | super_admin | Creer utilisateur. |
| GET | `/super-admin/users/:userId` | super_admin | Detail utilisateur. |
| PUT | `/super-admin/users/:userId` | super_admin | Modifier utilisateur. |
| PATCH | `/super-admin/users/:userId/role` | super_admin | Modifier role. |
| PATCH | `/super-admin/users/:userId/status` | super_admin | Modifier statut. |
| DELETE | `/super-admin/users/:userId` | super_admin | Suppression logique utilisateur. |
| GET | `/super-admin/garages` | super_admin | Lister garages. |
| POST | `/super-admin/garages` | super_admin | Creer garage. |
| GET | `/super-admin/garages/:garageId` | super_admin | Detail garage. |
| PUT | `/super-admin/garages/:garageId` | super_admin | Modifier garage. |
| DELETE | `/super-admin/garages/:garageId` | super_admin | Supprimer garage. |
| GET | `/super-admin/system/health` | super_admin | Sante systeme. |
| GET | `/super-admin/audit-logs` | super_admin | Audit logs. |
| GET | `/super-admin/observability/summary` | super_admin | Resume des erreurs et disponibilite. |
| GET | `/super-admin/observability/logs` | super_admin | Recherche paginee des journaux techniques. |
| GET | `/super-admin/observability/services` | super_admin | Etat des services de production. |
| GET | `/super-admin/observability/export` | super_admin | Export CSV ou JSONL audite, limite a 24 heures. |
| GET | `/super-admin/config` | super_admin | Configuration. |
| PUT | `/super-admin/config` | super_admin | Modifier configuration. |
| POST | `/super-admin/backup` | super_admin | Demarrer backup. |
| POST | `/super-admin/restore` | super_admin | Restaurer backup. |
| GET | `/super-admin/backups` | super_admin | Lister backups. |

## Support, identite et divers

| Methode | Route | Roles | Description |
| --- | --- | --- | --- |
| POST | `/support/messages` | authentifie | Envoyer message support. |
| GET | `/support/messages` | authentifie/admin | Lister messages support. |
| POST | `/identity/verify` | authentifie | Demande verification identite. |
| POST | `/identity/upload` | authentifie | Upload document identite. |
| GET | `/identity/status` | authentifie | Statut verification. |
| POST | `/ratings` | authentifie | Noter chauffeur/service. |
| GET | `/ratings/driver/:driverId` | public/auth | Notes chauffeur. |
| GET | `/coupons/available` | authentifie | Coupons disponibles. |
| POST | `/messages` | authentifie | Envoyer message interne. |
| GET | `/messages/conversations` | authentifie | Conversations. |
| PATCH | `/messages/:messageId/read` | authentifie | Marquer message lu. |
| POST | `/favorites/garages/:garageId` | authentifie | Ajouter favori. |
| DELETE | `/favorites/garages/:garageId` | authentifie | Retirer favori. |
| GET | `/favorites/garages` | authentifie | Lister favoris. |
| POST | `/addresses` | authentifie | Creer adresse. |
| GET | `/addresses` | authentifie | Lister adresses. |
| PUT | `/addresses/:addressId` | authentifie | Modifier adresse. |
| DELETE | `/addresses/:addressId` | authentifie | Supprimer adresse. |
| PATCH | `/addresses/:addressId/default` | authentifie | Adresse par defaut. |
| GET | `/search/parcels` | authentifie | Recherche colis. |
| POST | `/webhooks` | super_admin | Enregistrer webhook. |
| GET | `/webhooks` | super_admin | Lister webhooks. |
| DELETE | `/webhooks/:webhookId` | super_admin | Supprimer webhook. |


## Recherche de chauffeurs par véhicule et proximité

- `GET /public/vehicle-types` : catalogue `{ vehicleTypes: [{ value, label }] }`.
  Codes : `motorcycle`, `truck`, `van`, `tricycle`, `bus`, `gp`.
  Les écritures véhicule normalisent les anciens libellés (Moto, camion, Tata,
  horaire, minibus…) et refusent les types inconnus.
- `GET /public/drivers/search` : filtres `zoneId` (ou ancien `garageId`),
  `vehicleType`, `availableOnly=true`, `verifiedOnly=true`, `minCapacity` en kg,
  `limit` (1 à 200). Le rattachement zone inclut les anciens garages miroirs.
- `GET /client/drivers/search` : mêmes filtres, authentification client requise.
  Fournir `latitude` **et** `longitude` pour classer les chauffeurs disponibles
  par distance à vol d'oiseau. Réponse enrichie avec `vehicleType`,
  `vehicleModel`, `vehicleCapacity`, `distanceKm` (arrondi à 100 m) et
  `locationUpdatedAt`. Une position absente ou âgée de plus de dix minutes
  donne une distance `null` et place le chauffeur après les positions connues.
  Les coordonnées GPS et plaques des chauffeurs ne sont jamais retournées.
- `PUT /driver/discovery-location` : authentification chauffeur requise.
  `{ enabled: true, latitude, longitude }` publie volontairement une position ;
  `{ enabled: false }` la supprime. Le chauffeur est déduit de la session.
  La table dédiée ne lit jamais les positions de suivi des colis.
- Le client mobile actualise le partage chaque minute au premier plan. Le
  passage en arrière-plan, le changement de compte ou de disponibilité
  interrompt le partage. Si la suppression réseau échoue, la position expire
  automatiquement dix minutes après le dernier envoi réussi.
- La proposition directe (`POST /client/parcels/create`, avec `driverId`)
  revérifie la disponibilité et la capacité déclarée au moment de l'envoi.
  Le champ optionnel `vehicleType` permet de revérifier le type sélectionné.
  Un changement incompatible renvoie `409`. Le colis reste `proposal_sent`
  jusqu'à la réponse du chauffeur : la sélection n'est pas une acceptation.

Déploiement : appliquer la migration `20261028000000_driver_discovery`, puis
redémarrer l'API avec le client Prisma régénéré avant de distribuer le mobile.
La capacité est une déclaration en kg ; elle ne garantit pas les dimensions,
la capacité restante ou les conditions de transport, à confirmer avec le chauffeur.

### Découverte cartographique mobile

`GET /client/drivers/discovery` (client authentifié uniquement) exige
`latitude` et `longitude` du point de retrait. Filtres : `vehicleType`,
`minCapacity`, `verifiedOnly`, `radiusKm` (1–100, défaut 10), `limit` (1–200).
Cette recherche géographique ne se limite pas au garage de rattachement.

Réponse : `{ drivers, categories, search }`. Seuls les chauffeurs disponibles,
avec véhicule et position volontaire actualisée depuis moins de dix minutes,
sont inclus, dans le rayon demandé et par distance croissante. Chaque chauffeur
porte `mapPosition` (coordonnées arrondies à 0,001 degré et
`accuracyMeters: 150`) ; aucune position précise de suivi de colis n'est exposée.
`categories` fournit les comptes par type avant application du filtre de type,
mais après les contraintes de capacité, vérification et rayon. `search.total`
précède la pagination ; `search.returned` indique le nombre effectivement rendu.
Les distances sont à vol d'oiseau, sans promesse de délai d'arrivée.

Le mobile ouvre la carte depuis l'accueil et les annonces : retrait/destination,
catégories, capacité, rayon, chauffeur puis description et proposition de prix.
La localisation du client reste facultative ; la saisie manuelle et le choix
sur carte restent disponibles. Les résultats sont revérifiés toutes les
30 secondes au premier plan. En cas d'échec réseau, la sélection est retirée
pour éviter de présenter une ancienne disponibilité comme actuelle.

### Voyages, GP et navettes avec arrêts intermédiaires

Les annonces chauffeur acceptent désormais `itinerary` :

```json
{
  "serviceType": "shuttle",
  "lineNumber": "45",
  "stops": [
    { "zoneId": "<zone-départ>", "offsetMinutes": 0 },
    { "zoneId": "<zone-intermédiaire>", "offsetMinutes": 30 },
    { "zoneId": "<zone-arrivée>", "offsetMinutes": 90 }
  ]
}
```

- Services : `trip`, `gp`, `shuttle`. Le numéro de ligne est obligatoire pour
  `shuttle`. L'exemple 45 est un libellé déclaré, pas un itinéraire certifié.
- Une annonce représente un départ daté : `departureAt`, `availableWeight`
  et les zones des deux terminus sont requis avec un itinéraire. Les 2–40
  arrêts distincts suivent des horaires strictement croissants, en minutes
  depuis le départ. Le serveur résout leurs noms, positions et dates prévues.
- Stockage dans `Advertisement.metadata.itinerary`, exposé aussi sous
  `itinerary`. Les anciennes annonces sans itinéraire restent compatibles.
- Recherche `GET /advertisements?pickupZoneId=…&dropoffZoneId=…&weight=…`
  filtre avant pagination, dans le sens du trajet et avec capacité suffisante
  sur chaque tronçon. Filtres supplémentaires : `serviceType`, `lineNumber`.
  `matchingSegment` précise retrait, remise et indices dans les arrêts.
- Un départ déjà effectué peut encore accepter une prise en charge à un arrêt
  futur. Aucun embarquement à un arrêt dont l'horaire est passé n'est proposé.
- Une offre sur un itinéraire doit avoir un colis appartenant au client ; ses
  zones déterminent les arrêts. L'acceptation verrouille l'annonce en base,
  revalide horaires et poids, puis calcule la charge sur chaque tronçon.
  Deux colis consécutifs réutilisent la capacité ; deux colis qui se
  chevauchent l'additionnent. Un dépassement renvoie `409`.
- Le segment réservé est enregistré dans l'événement `confirmed` du colis et
  affiché au chauffeur dans les offres. La prise en charge et la livraison
  gardent leurs confirmations existantes : un horaire ne livre pas un colis.
- Une annonce avec réservation acceptée ne peut plus modifier ses arrêts ou
  sa capacité. Une navette récurrente publie une annonce par départ ; aucune
  répétition ni géolocalisation de bus n'est fabriquée automatiquement.

### Identité du véhicule et position GPS en direct

La ligne (`45`, par exemple) n'est pas une clé de véhicule. Chaque annonce
reste un départ identifié par son UUID, lié au `transport.vehicleId` du
véhicule enregistré et à l'ordre de ses arrêts. Plusieurs dizaines de véhicules
peuvent publier le même numéro, dans le même sens ou dans des sens opposés.
Le véhicule conserve une référence d'affichage ; les repères cartographiques
utilisent l'identifiant du départ et ne sont jamais regroupés par numéro.

Pour une nouvelle annonce avec itinéraire, le serveur reprend le véhicule du
profil (ou `vehicleId` appartenant au chauffeur). Il déduit `serviceType` :
`bus` → `shuttle`, `gp` → `gp`, autres → `trip`. Le mobile ne redemande pas la
catégorie et préremplit la capacité enregistrée ; le chauffeur précise la
capacité disponible pour ce départ. Les anciennes annonces doivent être
modifiées pour rattacher leur véhicule avant d'activer le suivi précis.

Le partage précis est **distinct** de la découverte approximative : activation
explicite par le chauffeur, pour un départ ouvert, au plus tôt 30 minutes avant
son départ annoncé. Aucun GPS de colis ou point de démonstration n'est réutilisé.

- `POST /advertisements/:id/live` (chauffeur propriétaire) :
  `{ enabled: true, latitude, longitude, accuracyMeters, capturedAt }`.
  Retourne `sessionId`. Une session par chauffeur, véhicule et départ.
- `PATCH /advertisements/:id/live` : mêmes mesures avec `sessionId`. Seules
  les mesures plus récentes remplacent le point courant ; un ancien flux ne
  peut pas déplacer le véhicule d'une nouvelle session.
- `DELETE /advertisements/:id/live` avec `{ sessionId }` : arrêt idempotent.
  La fermeture du départ supprime également son partage.
- `GET /client/journeys/live` (authentifié client, ou chauffeur pour ses propres
  départs) : filtres `advertisementId`, `lineNumber`, paire `pickupZoneId` /
  `dropoffZoneId`. Coordonnées non arrondies, précision fournie par le GPS,
  date de mesure et expiration. La direction vient des arrêts ordonnés.

Une position de plus de 60 secondes est retirée. Une mesure future de plus de
5 secondes ou une précision déclarée supérieure à 1 000 m est refusée. Les
clients actualisent la carte toutes les cinq secondes et affichent la précision
et l'âge GPS ; ils n'affichent pas d'ETA inventée. Le suivi mobile utilise les
mesures du GPS, espacées d'au moins huit secondes, avec notification persistante
Android / indication iOS, et peut continuer en arrière-plan selon les permissions
système. L'arrêt, la déconnexion et le changement de compte interrompent le flux.
Un défaut réseau ou une absence prolongée de mesures ne renouvelle jamais la
fraîcheur d'un point stocké. Le fonctionnement écran verrouillé doit aussi être
vérifié sur téléphones physiques iOS et Android.

Déploiement : migration `20261029000000_journey_live` et régénération Prisma,
puis reconstruction native du mobile (capacités de localisation en arrière-plan).

L'inscription chauffeur (`POST /auth/register`) conserve aussi `vehicleType`,
`vehicleCapacity`, `vehiclePlate` et `vehicleModel` dans la table des véhicules,
dans la même transaction que le compte. Les alias de catégorie sont normalisés.
Pour un GP, une référence interne de transporteur remplace la plaque routière
si elle n'est pas fournie ; aucun numéro de bus ou d'avion n'est inventé.

### Trajets habituels et départs en série

Les créations et modifications d'annonces avec itinéraire mémorisent le trajet
privé du chauffeur. Une empreinte du service, de la ligne et des arrêts ordonnés
avec leurs durées évite un nouveau modèle pour chaque départ identique. La date,
les offres, les réservations, le GPS et les sessions ne sont jamais mémorisés
comme données à dupliquer. Prix et capacité servent seulement de valeurs initiales.

- `GET /driver/route-templates` : carnet privé, trié par utilisation récente.
- `POST /driver/route-templates` avec `{ advertisementId }` : mémoriser un
  ancien voyage appartenant au chauffeur ; aucune ressaisie des zones.
- `PATCH /driver/route-templates/:id` avec `{ name }` : renommer.
- `DELETE /driver/route-templates/:id` : archiver le modèle sans toucher aux
  voyages déjà publiés.
- `POST /driver/route-templates/:id/departures` : publier 1 à 100 départs :

```json
{
  "requestId": "<UUID stable pour cette publication>",
  "departures": [
    { "departureAt": "2027-01-02T06:00:00Z", "reverse": false },
    { "departureAt": "2027-01-02T07:00:00Z", "reverse": true }
  ],
  "availableWeight": 20,
  "proposedPrice": null
}
```

Les horaires sont explicites (ISO avec fuseau), futurs, dans les 90 jours.
Les nouveaux départs sont à négocier : `proposedPrice` absent ou `null` ne
reprend jamais un ancien tarif, y compris pour un modèle historique tarifé.
Les interfaces de création publient sans prix : le client propose un colis et
une offre, puis le chauffeur négocie selon ses caractéristiques. Les anciens
clients API peuvent encore transmettre un tarif explicite ; les demandes déjà
enregistrées pour une reprise idempotente gardent leur contenu d'origine.
`reverse` inverse les arrêts et recalcule les durées depuis le nouveau départ.
Le véhicule actuel et sa catégorie proviennent du profil. La série refuse les
chevauchements internes et les créneaux déjà occupés par ses départs ouverts.
L'opération est transactionnelle : tous les départs sont créés, ou aucun.

`requestId` est unique par chauffeur. Un nouvel essai identique renvoie les
mêmes `advertisementIds` et `replayed: true` ; un contenu différent avec la même
clé renvoie `409`. Le mobile conserve la demande sur ce téléphone, par compte,
avant son envoi et jusqu'à confirmation, afin de reprendre après une coupure.
Chaque départ possède ensuite ses réservations et son activation GPS propres.

Le mobile propose « Trajets habituels · planning rapide » dans Mes annonces,
« Utiliser un trajet habituel » à la création et « Réutiliser ce trajet » depuis
un voyage. Le premier horaire, le nombre et l'intervalle génèrent un récapitulatif
avant publication, avec alternance aller/retour possible. Cette planification
crée une série finie ; elle ne lance pas de récurrence quotidienne indéfinie.

Déploiement : migration `20261030000000_route_templates`, régénération Prisma et
mise à jour du mobile. Aucun ancien voyage n'est modifié par la réutilisation.

## Outils d’envoi et accompagnement des livraisons

Routes sous `/api/v1/experience`, authentification obligatoire, rôles client ou
chauffeur. Réponses privées `Cache-Control: private, no-store`.

| Méthode | Route | Accès et résultat |
| --- | --- | --- |
| GET | `/parcels/:id` | Expéditeur ou chauffeur attribué : `experience` avec prochaine action, état de suivi, finances filtrées par rôle, reçus du payeur et réclamations personnelles. |
| GET | `/parcels/:id/repeat` | Expéditeur : `draft` avec liste blanche des coordonnées, trajet et caractéristiques ; aucun engagement repris. |
| POST | `/parcels/:id/complaints` | Expéditeur ou chauffeur attribué : `requestId` UUID stable, `reason` (`delay`, `damage`, `missing`, `payment`, `other`), `message` (10–3000 caractères), `photos` (0–4 URL). Renvoie `complaint`. Le même contenu est rejouable, un changement avec la même clé renvoie 409. |
| GET | `/workspace?page=1` | Client : `drafts` (100 maximum), `alerts` actives, `receipts` (25 par page), `page`, `hasMore`. |
| POST | `/drafts` | Client : `drafts: [{id: UUID, label, data}]`, 1–50 éléments. Écriture atomique, rejouable à contenu identique. Prix/paiement/chauffeur interdits dans `data`. |
| GET | `/drafts/:id` | Client propriétaire : `draft` prêt à préremplir, à relire avant publication. |
| DELETE | `/drafts/:id` | Client propriétaire : suppression idempotente. |
| POST | `/alerts` | Client : `departureZoneId`, `arrivalZoneId`, `consent: true`, `days` optionnel (1–90, défaut 30). 20 alertes maximum. |
| DELETE | `/alerts/:id` | Client propriétaire : désactivation idempotente. |

`finance.commissionEstimated` distingue estimation et valeur historique ; un
montant non déterminable est `null`, jamais remplacé par zéro. La dette créée sur
un colis et la dette actuelle du compte sont deux informations distinctes.
Les reçus ne comprennent que les paiements `completed` du payeur autorisé.

`/public/config` expose aussi `help.guides` : guides publiés en `fr` ou `wo`,
transcription et URL audio facultative. Les guides français initiaux sont servis
sous `/api/v1/public/help-audio/`. La publication de contenus ne modifie pas les
règles de livraison ou de paiement.

### Reprise fiable et outils professionnels (2026-10-28)

- `POST /client/parcels/create` accepte `requestId` (UUID) et `sourceDraftId` (UUID facultatif). La même clé, pour le même compte et le même contenu, retrouve le colis créé. Un contenu différent avec cette clé renvoie `409`. Le résultat et la création sont commis dans la même transaction PostgreSQL. Les anciennes applications sans clé restent compatibles.
- `POST /upload` accepte également `requestId`. Le type, le colis, le nom et l'empreinte du fichier doivent rester identiques à la reprise. Les fichiers temporaires refusés ou rejoués sont supprimés. Un fichier lié à un colis exige un accès à ce colis.
- `GET /experience/requests/:id` retourne `{result: {parcelId} | null}` pour la clé du compte connecté. L'absence de résultat ne constitue pas une autorisation de créer avec une autre clé : une première requête peut encore être en cours.
- `GET /experience/workspace` expose `completedParcelId` et `completedAt` sur les brouillons publiés. Un brouillon publié ne peut plus être utilisé pour créer un deuxième colis ; il reste visible pour le suivi du lot.
- `POST /experience/imports/preview` : multipart `file`, CSV ou XLSX, 2 Mo, une feuille, 1–50 colis. En-têtes : `nom`, `telephone`, `description`, `poids` ; `adresse` et `email` facultatifs. Résultat `{drafts,errors:[{line,message}],count}`. Toute ligne invalide vide `drafts`. Aucune création métier pendant l'aperçu. Formules, macros et liens externes XLSX refusés ; analyse dans un worker borné.
- `GET/POST /experience/recipients`, `GET/DELETE /experience/recipients/:id` : carnet privé client, 200 entrées maximum. Création avec `requestId`, `name`, `phone`, `email?`, `address?`. La lecture individuelle retourne un `draft` pour préremplir le parcours existant.
- `POST /experience/events` : `{attemptId,event,platform}` ; événements `creation_started`, `creation_submitted`, `creation_failed`, `creation_completed`, plateformes `web` ou `mobile`. Aucun champ libre ni position. Un événement identique pour la même tentative est dédupliqué.
- Une réclamation crée aussi son premier message dans la conversation support du demandeur. Les messages acceptent `ticketId` ; l'API contrôle l'appartenance au même demandeur. `GET /support/chat/conversations/:id?ticketId=…` permet une lecture filtrée. Les interfaces gardent le fil complet afin que les réponses générales restent visibles. Un changement effectif de statut notifie le demandeur une seule fois.
- `GET /quality` : réservé à `super_admin` et `support_technique`, agrégats sur 30 jours, aucun détail personnel. Retards actifs selon l'estimation enregistrée ; abandons présumés après 24 h sans création confirmée dans le journal serveur ; première réponse réelle sur les conversations commencées pendant la période et ayant reçu une réponse.
