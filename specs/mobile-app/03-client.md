# Profil Client / Customer

Tous les endpoints de ce fichier utilisent :

```http
Authorization: Bearer <clientAccessToken>
```

## Dashboard client

Statut : `SPEC`

```http
GET /users/stats
```

Reponse :

```json
{
  "success": true,
  "message": "Stats personnelles",
  "stats": {
    "totalParcels": 3,
    "activeParcels": 1,
    "deliveredParcels": 1,
    "pendingBids": 1,
    "unreadNotifications": 2,
    "scoreBalance": 80
  }
}
```

## Profil client

### Modifier profil

Statut : `SPEC`

```http
PUT /client/profile
```

Payload :

```json
{
  "fullName": "Customer Test",
  "email": "customer@procolis.test",
  "address": "Plateau",
  "city": "Dakar",
  "region": "Dakar",
  "gender": "male"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Profil mis a jour",
  "user": {}
}
```

### Changer PIN

Statut : `SPEC`

```http
PUT /users/pin
```

Payload :

```json
{
  "currentPin": "123456",
  "newPin": "654321"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Code PIN mis a jour"
}
```

## Colis client

### Lister mes colis

Statut : `SPEC`

```http
GET /client/parcels/my-parcels?status=in_transit&page=1&limit=20
```

Query :

```text
status=optionnel
page=1
limit=20
```

Reponse :

```json
{
  "success": true,
  "message": "Colis client",
  "parcels": [
    {
      "id": "uuid",
      "trackingNumber": "PC-20260628-SEED03",
      "description": "Vetements et accessoires",
      "status": "in_transit",
      "receiverName": "Cheikh Ba",
      "receiverPhone": "+221770000505",
      "departureGarageId": "uuid",
      "arrivalGarageId": "uuid",
      "driverId": "uuid",
      "totalAmount": "7000.00",
      "createdAt": "2026-06-28T13:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "totalPages": 1
  }
}
```

### Creer un colis

Statut : `SPEC`

```http
POST /client/parcels/create
```

Payload :

```json
{
  "senderName": "Customer Test",
  "senderPhone": "+221770000101",
  "senderEmail": "customer@procolis.test",
  "receiverName": "Mamadou Fall",
  "receiverPhone": "+221770000303",
  "receiverEmail": "mamadou@example.test",
  "receiverAddress": "Thies centre",
  "description": "Documents administratifs",
  "weight": 1.2,
  "type": "document",
  "departureGarageId": "11111111-1111-4111-8111-111111111111",
  "arrivalGarageId": "22222222-2222-4222-8222-222222222222",
  "price": 2500,
  "isUrgent": false,
  "isInsured": false,
  "driverId": null,
  "isFreeForBidding": true,
  "proposedPrice": 4500,
  "photoUrls": [],
  "videoUrls": [],
  "audioUrls": [],
  "notes": "Fragile"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Colis cree",
  "parcel": {
    "id": "uuid",
    "trackingNumber": "PC-20260628-A8F2K9",
    "status": "free",
    "isFreeForBidding": true,
    "totalAmount": "4500.00"
  }
}
```

### Detail colis

Statut : `SPEC`

```http
GET /client/parcels/:parcelId
```

Reponse :

```json
{
  "success": true,
  "message": "Detail colis",
  "parcel": {
    "id": "uuid",
    "trackingNumber": "PC-20260628-SEED03",
    "status": "in_transit",
    "senderName": "Customer Test",
    "receiverName": "Cheikh Ba",
    "driver": {
      "id": "uuid",
      "fullName": "Driver Test",
      "phone": "+221770000202"
    },
    "events": [],
    "media": []
  }
}
```

### Annuler un colis

Statut : `SPEC`

```http
POST /client/parcels/:parcelId/cancel
```

Payload :

```json
{
  "reason": "Le client souhaite reporter l'envoi"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Colis annule",
  "parcel": {
    "id": "uuid",
    "status": "cancelled",
    "cancellationReason": "Le client souhaite reporter l'envoi"
  }
}
```

## Tracking

### Tracking public par numero

Statut : `SPEC`

```http
GET /public/parcels/track/:trackingNumber
```

Exemple :

```http
GET /public/parcels/track/PC-20260628-SEED03
```

Reponse :

```json
{
  "success": true,
  "message": "Suivi colis",
  "parcel": {
    "trackingNumber": "PC-20260628-SEED03",
    "status": "in_transit",
    "receiverName": "Cheikh Ba",
    "estimatedDeliveryDate": "2026-06-28T13:00:00.000Z"
  },
  "events": [
    {
      "status": "in_transit",
      "description": "Le colis est en route vers le garage destination",
      "location": "Autoroute Dakar-Thies",
      "createdAt": "2026-06-28T13:00:00.000Z"
    }
  ]
}
```

### Timeline detaillee

Statut : `SPEC`

```http
GET /parcels/:parcelId/timeline
```

Reponse :

```json
{
  "success": true,
  "message": "Timeline colis",
  "events": []
}
```

## Offres recues sur colis libre

### Lister offres d'un colis

Statut : `SPEC`

```http
GET /public/parcels/:parcelId/bids
```

Reponse :

```json
{
  "success": true,
  "message": "Offres colis",
  "bids": [
    {
      "id": "uuid",
      "parcelId": "uuid",
      "driverId": "uuid",
      "driverName": "Driver Test",
      "price": "4200.00",
      "message": "Je peux prendre ce colis aujourd hui.",
      "status": "pending"
    }
  ]
}
```

### Accepter une offre

Statut : `SPEC`

```http
POST /client/parcels/:parcelId/bids/:bidId/accept
```

Payload :

```json
{
  "responseMessage": "Offre acceptee"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Offre acceptee",
  "parcel": {
    "id": "uuid",
    "status": "confirmed",
    "driverId": "uuid",
    "selectedBidId": "uuid",
    "negotiatedPrice": "4200.00"
  },
  "bid": {
    "id": "uuid",
    "status": "accepted"
  }
}
```

### Rejeter une offre

Statut : `SPEC`

```http
POST /client/parcels/:parcelId/bids/:bidId/reject
```

Payload :

```json
{
  "responseMessage": "Prix trop eleve"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Offre rejetee",
  "bid": {
    "id": "uuid",
    "status": "rejected"
  }
}
```

### Stats offres client

Statut : `SPEC`

```http
GET /client/bids/stats
```

Reponse :

```json
{
  "success": true,
  "message": "Stats offres",
  "stats": {
    "received": 4,
    "pending": 1,
    "accepted": 2,
    "rejected": 1
  }
}
```

### Contre-proposition

Statut : `SPEC`

```http
POST /client/bids/:bidId/negotiate
```

Payload :

```json
{
  "price": 4000,
  "message": "Je propose 4000 XOF"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Contre-proposition envoyee",
  "bid": {}
}
```

## Paiements client

### Initier paiement

Statut : `SPEC`

```http
POST /payments/initiate
```

Payload :

```json
{
  "parcelId": "uuid",
  "amount": 3000,
  "currency": "XOF",
  "method": "wave",
  "phoneNumber": "+221770000101"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Paiement initie",
  "payment": {
    "id": "uuid",
    "status": "pending",
    "amount": "3000.00",
    "reference": "PAY-20260628-0001"
  }
}
```

### Historique paiement

Statut : `SPEC`

```http
GET /payments/history?page=1&limit=20
```

Reponse :

```json
{
  "success": true,
  "message": "Historique paiements",
  "payments": []
}
```

## Score client

Statut : `SPEC`

| Methode | Endpoint | Reponse |
| --- | --- | --- |
| GET | `/score` | `{ "success": true, "score": {}, "history": [] }` |
| GET | `/score/balance` | `{ "success": true, "balance": 80 }` |
| GET | `/score/history` | `{ "success": true, "transactions": [] }` |
| POST | `/score/purchase` | `{ "success": true, "payment": {} }` |

Payload achat points :

```json
{
  "points": 100,
  "method": "wave",
  "phoneNumber": "+221770000101"
}
```

## Adresses client

Statut : `SPEC`

| Methode | Endpoint | Payload |
| --- | --- | --- |
| GET | `/addresses` | aucun |
| POST | `/addresses` | `{ "label": "Maison", "address": "Plateau", "city": "Dakar", "region": "Dakar", "isDefault": true }` |
| PUT | `/addresses/:addressId` | `{ "label": "Bureau", "address": "Almadies" }` |
| DELETE | `/addresses/:addressId` | aucun |
| PATCH | `/addresses/:addressId/default` | aucun |

Reponse liste :

```json
{
  "success": true,
  "message": "Adresses",
  "addresses": []
}
```

## Favoris, messages, support, rating

Statut : `SPEC`

| Methode | Endpoint | Payload | Reponse |
| --- | --- | --- | --- |
| POST | `/favorites/garages/:garageId` | aucun | `{ "success": true, "message": "Garage ajoute aux favoris" }` |
| DELETE | `/favorites/garages/:garageId` | aucun | `{ "success": true, "message": "Garage retire des favoris" }` |
| GET | `/favorites/garages` | aucun | `{ "success": true, "garages": [] }` |
| POST | `/messages` | `{ "receiverId": "uuid", "parcelId": "uuid", "body": "Bonjour" }` | `{ "success": true, "message": {}, "data": {} }` |
| GET | `/messages/conversations` | aucun | `{ "success": true, "conversations": [] }` |
| PATCH | `/messages/:messageId/read` | aucun | `{ "success": true, "message": "Message lu" }` |
| POST | `/support/messages` | `{ "subject": "Question", "message": "Texte" }` | `{ "success": true, "supportMessage": {} }` |
| POST | `/ratings` | `{ "parcelId": "uuid", "driverId": "uuid", "rating": 5, "comment": "Tres bien" }` | `{ "success": true, "rating": {} }` |

## Mes dettes

Implémenté : accès depuis **Profil → Mes dettes**.

`GET /client/debts?page=1&limit=20` (authentification client obligatoire).
Le filtre optionnel `status` accepte `pending`, `partially_paid` ou `paid`.
La réponse contient :

- `debts` : `id`, `parcelId`, `trackingNumber`, `reference`, `reason`, `amount`,
  `remaining`, `status`, `createdAt`, `updatedAt`, `settledAt` ;
- `summary` : `totalDebt` (FCFA), `currency: "XOF"`, `debtLimit`, `canCreateParcel` ;
- `pagination` : `page`, `limit`, `total`, `totalPages`.

Le total porte sur toutes les dettes encore dues du compte connecté, même si
la liste est filtrée ou paginée. Aucun paramètre `userId` n'est pris en compte.
Les dettes réglées restent consultables dans l'historique.

Le bouton de règlement réutilise `POST /payments/paydunya/create` avec
`type: "penalty_debt"` et l'`id` réel comme `debtId` ; `amount` est facultatif
pour un paiement partiel. Le retour du prestataire provoque une relecture des
montants serveur, jamais une remise à zéro locale du reliquat.
