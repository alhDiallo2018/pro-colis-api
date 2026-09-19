# Profil Driver / Chauffeur

Tous les endpoints de ce fichier utilisent :

```http
Authorization: Bearer <driverAccessToken>
```

## Dashboard driver

Statut : `SPEC`

```http
GET /driver/stats
```

Reponse :

```json
{
  "success": true,
  "message": "Stats chauffeur",
  "stats": {
    "assignedParcels": 2,
    "activeParcels": 1,
    "completedDeliveries": 1,
    "rating": 5,
    "scoreBalance": 120,
    "pendingBids": 1,
    "openAdvertisements": 1
  }
}
```

## Profil driver

Statut : `SPEC`

```http
PUT /driver/profile
```

Payload :

```json
{
  "fullName": "Driver Test",
  "email": "driver@procolis.test",
  "address": "Medina",
  "city": "Dakar",
  "region": "Dakar",
  "driverStatus": "available",
  "garageId": "11111111-1111-4111-8111-111111111111"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Profil mis a jour",
  "user": {
    "id": "uuid",
    "role": "driver",
    "driverStatus": "available"
  }
}
```

## Colis driver

### Lister colis assignes

Statut : `SPEC`

```http
GET /driver/parcels?status=in_transit&page=1&limit=20
```

Reponse :

```json
{
  "success": true,
  "message": "Colis chauffeur",
  "parcels": [
    {
      "id": "uuid",
      "trackingNumber": "PC-20260628-SEED03",
      "status": "in_transit",
      "senderName": "Customer Test",
      "receiverName": "Cheikh Ba",
      "receiverAddress": "Touba",
      "totalAmount": "7000.00"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 2,
    "totalPages": 1
  }
}
```

### Creer un colis pour client

Statut : `SPEC`

```http
POST /driver/parcels/create
```

Payload :

```json
{
  "senderName": "Awa Diop",
  "senderPhone": "+221770000001",
  "senderEmail": "awa@example.test",
  "receiverName": "Mamadou Fall",
  "receiverPhone": "+221770000002",
  "receiverAddress": "Thies",
  "description": "Documents administratifs",
  "weight": 1.2,
  "type": "document",
  "departureGarageId": "11111111-1111-4111-8111-111111111111",
  "arrivalGarageId": "22222222-2222-4222-8222-222222222222",
  "price": 2500,
  "isUrgent": false,
  "isInsured": false,
  "notes": "Cree par le chauffeur"
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
    "status": "confirmed",
    "driverId": "uuid"
  }
}
```

### Detail colis

Statut : `SPEC`

```http
GET /driver/parcels/:parcelId
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
    "senderPhone": "+221770000101",
    "receiverPhone": "+221770000505",
    "events": [],
    "media": []
  }
}
```

## Cycle livraison

Statut : `SPEC`

### Marquer ramasse

```http
PUT /driver/parcels/:parcelId/pickup
```

Payload :

```json
{
  "location": "Garage Dakar Test",
  "locationLat": 14.7167,
  "locationLng": -17.4677,
  "photoUrl": "http://localhost:18081/uploads/photo/pickup.jpg",
  "notes": "Colis recupere"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Colis ramasse",
  "parcel": {
    "id": "uuid",
    "status": "picked_up"
  },
  "event": {}
}
```

### Marquer en transit

```http
PUT /driver/parcels/:parcelId/transit
```

Payload :

```json
{
  "location": "Autoroute Dakar-Thies",
  "locationLat": 14.78,
  "locationLng": -17.1,
  "notes": "Depart vers Thies"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Colis en transit",
  "parcel": {
    "id": "uuid",
    "status": "in_transit"
  }
}
```

### Marquer arrive

```http
PUT /driver/parcels/:parcelId/arrived
```

Payload :

```json
{
  "location": "Garage Thies Test",
  "locationLat": 14.791,
  "locationLng": -16.9359
}
```

Reponse :

```json
{
  "success": true,
  "message": "Colis arrive au garage",
  "parcel": {
    "id": "uuid",
    "status": "arrived"
  }
}
```

### Marquer en livraison finale

```http
PUT /driver/parcels/:parcelId/out-for-delivery
```

Payload :

```json
{
  "location": "Thies centre",
  "notes": "Livraison finale demarree"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Colis en livraison finale",
  "parcel": {
    "id": "uuid",
    "status": "out_for_delivery"
  }
}
```

### Confirmer livraison

```http
PUT /driver/parcels/:parcelId/deliver
```

Payload :

```json
{
  "location": "Thies centre",
  "receiverName": "Mamadou Fall",
  "signatureUrl": "http://localhost:18081/uploads/signature/signature.jpg",
  "photoUrl": "http://localhost:18081/uploads/proof/proof.jpg",
  "notes": "Livre au destinataire"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Livraison confirmee",
  "parcel": {
    "id": "uuid",
    "status": "delivered",
    "deliveryDate": "2026-06-28T13:00:00.000Z"
  },
  "score": {
    "credited": 120
  }
}
```

## Colis libres et offres driver

### Lister colis libres

Statut : `SPEC`

```http
GET /public/parcels/free?page=1&limit=20
```

Reponse :

```json
{
  "success": true,
  "message": "Colis libres",
  "parcels": [
    {
      "id": "uuid",
      "trackingNumber": "PC-20260628-SEED02",
      "description": "Petit colis fragile",
      "status": "free",
      "proposedPrice": "4500.00",
      "departureCity": "Dakar",
      "arrivalCity": "Thies"
    }
  ]
}
```

### Faire une offre

Statut : `SPEC`

```http
POST /driver/bids
```

Payload :

```json
{
  "parcelId": "uuid",
  "price": 4200,
  "message": "Je peux prendre ce colis aujourd hui.",
  "audioUrl": "http://localhost:18081/uploads/audio/bid.webm"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Offre envoyee",
  "bid": {
    "id": "uuid",
    "parcelId": "uuid",
    "driverId": "uuid",
    "price": "4200.00",
    "status": "pending"
  }
}
```

### Mes offres envoyees

Statut : `SPEC`

```http
GET /driver/bids/sent?page=1&limit=20
```

Reponse :

```json
{
  "success": true,
  "message": "Offres envoyees",
  "bids": []
}
```

## Annonces chauffeur

### Lister annonces

Statut : `SPEC`

```http
GET /advertisements?page=1&limit=20
```

Reponse :

```json
{
  "success": true,
  "message": "Annonces",
  "advertisements": [
    {
      "id": "uuid",
      "driverId": "uuid",
      "departureCity": "Dakar",
      "arrivalCity": "Thies",
      "availableWeight": "120.00",
      "proposedPrice": "5000.00",
      "status": "open"
    }
  ]
}
```

### Mes annonces

Statut : `SPEC`

```http
GET /advertisements/my
```

Reponse :

```json
{
  "success": true,
  "message": "Mes annonces",
  "advertisements": []
}
```

### Creer annonce

Statut : `SPEC`

```http
POST /advertisements
```

Payload :

```json
{
  "departureGarageId": "11111111-1111-4111-8111-111111111111",
  "arrivalGarageId": "22222222-2222-4222-8222-222222222222",
  "departureCity": "Dakar",
  "arrivalCity": "Thies",
  "departureAt": "2026-06-29T08:00:00.000Z",
  "availableWeight": 120,
  "proposedPrice": 5000,
  "description": "Trajet disponible demain matin pour colis moyens.",
  "audioUrl": null
}
```

Reponse :

```json
{
  "success": true,
  "message": "Annonce creee",
  "advertisement": {
    "id": "uuid",
    "status": "open"
  }
}
```

### Modifier annonce

Statut : `SPEC`

```http
PUT /advertisements/:advertisementId
```

Payload :

```json
{
  "availableWeight": 100,
  "proposedPrice": 4500,
  "description": "Mise a jour du trajet"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Annonce mise a jour",
  "advertisement": {}
}
```

### Fermer annonce

Statut : `SPEC`

```http
POST /advertisements/:advertisementId/close
```

Payload :

```json
{
  "reason": "Trajet complet"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Annonce fermee",
  "advertisement": {
    "id": "uuid",
    "status": "closed"
  }
}
```

### Offres recues sur annonce

Statut : `SPEC`

```http
GET /advertisements/:advertisementId/offers
```

Reponse :

```json
{
  "success": true,
  "message": "Offres annonce",
  "offers": [
    {
      "id": "uuid",
      "clientId": "uuid",
      "parcelId": "uuid",
      "price": "4800.00",
      "message": "Pouvez-vous prendre le colis fragile ?",
      "status": "pending"
    }
  ]
}
```

### Accepter ou rejeter offre annonce

Statut : `SPEC`

```http
POST /advertisements/:advertisementId/offers/:offerId/accept
POST /advertisements/:advertisementId/offers/:offerId/reject
```

Payload :

```json
{
  "responseMessage": "Je confirme la prise en charge"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Offre traitee",
  "offer": {
    "id": "uuid",
    "status": "accepted"
  }
}
```

## Localisation driver

Statut : `SPEC`

```http
POST /driver/location
```

Payload :

```json
{
  "parcelId": "uuid-optionnel",
  "latitude": 14.78,
  "longitude": -17.1,
  "accuracy": 12.5
}
```

Reponse :

```json
{
  "success": true,
  "message": "Position enregistree",
  "location": {
    "id": "uuid",
    "latitude": "14.7800000",
    "longitude": "-17.1000000"
  }
}
```

## Documents identite driver

Statut : `SPEC`

| Methode | Endpoint | Payload | Reponse |
| --- | --- | --- | --- |
| POST | `/identity/verify` | `{ "documentType": "driver_license" }` | `{ "success": true, "identity": {} }` |
| POST | `/identity/upload` | multipart `file`, `side=front` | `{ "success": true, "url": "..." }` |
| GET | `/identity/status` | aucun | `{ "success": true, "status": "pending" }` |

## Lieux des annonces et accès aux dettes

Le sélecteur mobile utilise les zones : après `POST /zones/resolve`, envoyer
`data.id` dans `departureZoneId` / `arrivalZoneId`. `garageId` est uniquement
compatible avec les anciens champs `departureGarageId` / `arrivalGarageId`.
Une zone nouvellement créée en statut `pending` peut être utilisée pour
publier une annonce, même si elle n'apparaît pas encore dans la liste publique.

Toutes les réponses annonces (liste, mes annonces, détail, création,
modification, fermeture) exposent `departureName` / `arrivalName`, ainsi que
les noms des zones et garages et les villes avec repli sur un lieu lisible.
Le mobile privilégie ces noms et ignore les chaînes vides.

**Profil → Mes dettes** ouvre le portefeuille chauffeur avec le montant de la
dette, son éventuel blocage et le règlement depuis le solde disponible.
La lecture utilise `GET /driver/wallet` et le règlement
`POST /driver/wallet/pay-debt`. L'achat de points existant permet également
la régularisation automatique de la dette par le backend.
