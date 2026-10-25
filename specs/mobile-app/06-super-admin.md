# Profil Super Admin

Tous les endpoints de ce fichier utilisent :

```http
Authorization: Bearer <superAdminAccessToken>
```

Le super admin a acces global.

## Dashboard super admin

Statut : `SPEC`

```http
GET /super-admin/stats
```

Reponse :

```json
{
  "success": true,
  "message": "Stats globales",
  "stats": {
    "totalUsers": 100,
    "totalDrivers": 25,
    "totalClients": 70,
    "totalGarages": 5,
    "totalVehicles": 12,
    "totalParcels": 450,
    "parcelsInTransit": 30,
    "parcelsDeliveredToday": 18,
    "parcelsPending": 42,
    "totalRevenue": 2500000,
    "revenueThisMonth": 600000,
    "revenueLastMonth": 520000,
    "parcelsByRegion": {
      "Dakar": 120,
      "Thies": 80
    },
    "dailyStats": [],
    "garagePerformance": []
  }
}
```

## Profil super admin

Statut : `SPEC`

```http
PUT /super-admin/profile
```

Payload :

```json
{
  "fullName": "Super Admin",
  "email": "super-admin@example.test",
  "phone": "+221770000999"
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

## Utilisateurs

### Lister utilisateurs

Statut : `SPEC`

```http
GET /super-admin/users?role=driver&status=active&page=1&limit=20
```

Reponse :

```json
{
  "success": true,
  "message": "Utilisateurs",
  "users": [
    {
      "id": "uuid",
      "fullName": "Driver Test",
      "phone": "+221770000202",
      "role": "driver",
      "status": "active",
      "garageId": "uuid"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### Creer utilisateur

Statut : `SPEC`

```http
POST /super-admin/users
```

Payload :

```json
{
  "email": "admin@example.test",
  "phone": "+221770000707",
  "fullName": "Admin Garage",
  "password": "Password123!",
  "pin": "123456",
  "role": "admin",
  "status": "active",
  "garageId": "uuid-optionnel",
  "city": "Dakar",
  "region": "Dakar"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Utilisateur cree",
  "user": {
    "id": "uuid",
    "role": "admin",
    "status": "active"
  }
}
```

### Detail utilisateur

Statut : `SPEC`

```http
GET /super-admin/users/:userId
```

Reponse :

```json
{
  "success": true,
  "message": "Detail utilisateur",
  "user": {
    "id": "uuid",
    "fullName": "Driver Test",
    "role": "driver",
    "score": {},
    "garage": {},
    "stats": {}
  }
}
```

### Modifier utilisateur

Statut : `SPEC`

```http
PUT /super-admin/users/:userId
```

Payload :

```json
{
  "fullName": "Driver Test Updated",
  "email": "driver@example.test",
  "phone": "+221770000202",
  "garageId": "uuid",
  "city": "Dakar",
  "region": "Dakar"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Utilisateur mis a jour",
  "user": {}
}
```

### Modifier role

Statut : `SPEC`

```http
PATCH /super-admin/users/:userId/role
```

Payload :

```json
{
  "role": "admin"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Role mis a jour",
  "user": {
    "id": "uuid",
    "role": "admin"
  }
}
```

### Modifier statut

Statut : `SPEC`

```http
PATCH /super-admin/users/:userId/status
```

Payload :

```json
{
  "status": "suspended",
  "reason": "Verification necessaire"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Statut mis a jour",
  "user": {
    "id": "uuid",
    "status": "suspended"
  }
}
```

### Suppression logique utilisateur

Statut : `SPEC`

```http
DELETE /super-admin/users/:userId
```

Payload :

```json
{
  "reason": "Compte ferme"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Utilisateur supprime",
  "user": {
    "id": "uuid",
    "status": "deleted"
  }
}
```

## Garages

### Lister garages

Statut : `SPEC`

```http
GET /super-admin/garages?page=1&limit=20&city=Dakar
```

Reponse :

```json
{
  "success": true,
  "message": "Garages",
  "garages": [
    {
      "id": "uuid",
      "name": "Garage Dakar Test",
      "city": "Dakar",
      "region": "Dakar",
      "isActive": true
    }
  ]
}
```

### Creer garage

Statut : `SPEC`

```http
POST /super-admin/garages
```

Payload :

```json
{
  "name": "Garage Kaolack",
  "city": "Kaolack",
  "region": "Kaolack",
  "address": "Centre ville",
  "phone": "+221339999999",
  "latitude": 14.15,
  "longitude": -16.08,
  "isActive": true
}
```

Reponse :

```json
{
  "success": true,
  "message": "Garage cree",
  "garage": {
    "id": "uuid",
    "name": "Garage Kaolack",
    "isActive": true
  }
}
```

### Detail garage

Statut : `SPEC`

```http
GET /super-admin/garages/:garageId
```

Reponse :

```json
{
  "success": true,
  "message": "Detail garage",
  "garage": {
    "id": "uuid",
    "stats": {},
    "drivers": [],
    "vehicles": []
  }
}
```

### Modifier garage

Statut : `SPEC`

```http
PUT /super-admin/garages/:garageId
```

Payload :

```json
{
  "name": "Garage Dakar Principal",
  "address": "Route de Rufisque",
  "phone": "+221338000001",
  "isActive": true
}
```

Reponse :

```json
{
  "success": true,
  "message": "Garage mis a jour",
  "garage": {}
}
```

### Supprimer garage

Statut : `SPEC`

```http
DELETE /super-admin/garages/:garageId
```

Payload :

```json
{
  "reason": "Garage ferme"
}
```

Reponse :

```json
{
  "success": true,
  "message": "Garage supprime",
  "garage": {
    "id": "uuid",
    "deletedAt": "2026-06-28T13:00:00.000Z"
  }
}
```

## Colis globaux

Statut : `SPEC`

| Methode | Endpoint | Payload ou query | Reponse |
| --- | --- | --- | --- |
| GET | `/super-admin/parcels` | `?status=in_transit&page=1&limit=20` | `{ "success": true, "parcels": [], "pagination": {} }` |
| POST | `/super-admin/parcels/create` | payload creation colis standard | `{ "success": true, "parcel": {} }` |
| GET | `/super-admin/parcels/:parcelId` | aucun | `{ "success": true, "parcel": {} }` |
| PUT | `/super-admin/parcels/:parcelId` | `{ "receiverAddress": "Thies", "notes": "Updated" }` | `{ "success": true, "parcel": {} }` |
| PUT | `/super-admin/parcels/:parcelId/status` | `{ "status": "delivered", "reason": "Correction admin" }` | `{ "success": true, "parcel": {} }` |
| DELETE | `/super-admin/parcels/:parcelId` | `{ "reason": "Annulation admin" }` | `{ "success": true, "parcel": {} }` |

Payload creation colis standard :

```json
{
  "senderName": "Awa Diop",
  "senderPhone": "+221770000001",
  "receiverName": "Mamadou Fall",
  "receiverPhone": "+221770000002",
  "receiverAddress": "Thies",
  "description": "Documents",
  "weight": 1.2,
  "type": "document",
  "departureGarageId": "uuid",
  "arrivalGarageId": "uuid",
  "driverId": "uuid-optionnel",
  "price": 2500,
  "isUrgent": false,
  "isInsured": false
}
```

## Reporting

Statut : `SPEC`

| Methode | Endpoint | Query | Reponse |
| --- | --- | --- | --- |
| GET | `/super-admin/stats/advanced` | aucun | `{ "success": true, "stats": {} }` |
| GET | `/super-admin/reports/daily` | `?date=2026-06-28` | `{ "success": true, "report": {} }` |
| GET | `/super-admin/reports/monthly` | `?year=2026&month=6` | `{ "success": true, "report": {} }` |
| GET | `/super-admin/export` | `?format=json&type=parcels` | `{ "success": true, "data": [] }` |

## Audit logs

Statut : `SPEC`

```http
GET /super-admin/audit-logs?action=parcel.create&entityType=parcel&page=1&limit=20
```

Query :

```text
actorId=uuid
action=parcel.create
entityType=parcel
entityId=uuid
dateFrom=2026-06-01
dateTo=2026-06-28
page=1
limit=20
```

Reponse :

```json
{
  "success": true,
  "message": "Audit logs",
  "auditLogs": [
    {
      "id": "uuid",
      "actorId": "uuid",
      "actorRole": "driver",
      "action": "parcel.status_update",
      "entityType": "parcel",
      "entityId": "uuid",
      "beforeData": {},
      "afterData": {},
      "createdAt": "2026-06-28T13:00:00.000Z"
    }
  ]
}
```

## Configuration systeme

Statut : `SPEC`

### Lire configuration

```http
GET /super-admin/config
```

Reponse :

```json
{
  "success": true,
  "message": "Configuration",
  "config": {
    "pricing.baseFee": 1000,
    "pricing.pricePerKg": 500,
    "score.deliveryCompleted": 120,
    "uploads.maxPhotoMb": 8,
    "maintenance.enabled": false
  }
}
```

### Modifier configuration

```http
PUT /super-admin/config
```

Payload :

```json
{
  "key": "pricing.baseFee",
  "value": 1200
}
```

Reponse :

```json
{
  "success": true,
  "message": "Configuration mise a jour",
  "config": {
    "key": "pricing.baseFee",
    "value": 1200
  }
}
```

## Backup et restore

Statut : `SPEC`

| Methode | Endpoint | Payload | Reponse |
| --- | --- | --- | --- |
| POST | `/super-admin/backup` | `{ "storage": "local" }` | `{ "success": true, "backup": { "id": "uuid", "status": "running" } }` |
| GET | `/super-admin/backups` | aucun | `{ "success": true, "backups": [] }` |
| POST | `/super-admin/restore` | `{ "backupId": "uuid", "confirmation": "RESTORE" }` | `{ "success": true, "restore": { "status": "running" } }` |

## Webhooks

Statut : `SPEC`

| Methode | Endpoint | Payload | Reponse |
| --- | --- | --- | --- |
| GET | `/webhooks` | aucun | `{ "success": true, "webhooks": [] }` |
| POST | `/webhooks` | `{ "url": "https://example.com/hook", "events": ["parcel.delivered"], "secret": "secret" }` | `{ "success": true, "webhook": {} }` |
| DELETE | `/webhooks/:webhookId` | aucun | `{ "success": true, "message": "Webhook supprime" }` |

La creation accepte `isActive` (booleen, `true` par defaut). Les evenements
sont nettoyes des espaces et dedupliques ; une valeur vide ou non textuelle
est rejetee en 422. Les reponses exposent `isActive` et `hasSecret`, jamais le
secret. Creation et suppression produisent une trace d'audit dans la meme
transaction, sans y copier le secret.

Ces routes gerent les abonnements en base. Le mecanisme de livraison sortante
des evenements n'est pas encore implemente ; `isActive` decrit la configuration
de l'abonnement et ne prouve pas la reception d'un evenement.
