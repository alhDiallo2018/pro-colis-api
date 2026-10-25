# Administration, reporting et audit

## Dashboards

Le backend doit fournir les donnees necessaires aux dashboards :

- dashboard client.
- dashboard chauffeur.
- dashboard admin garage.
- dashboard super admin.

## Stats super admin

Endpoint : `GET /super-admin/stats`

Reponse attendue :

```json
{
  "success": true,
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

## Stats garage

Endpoint : `GET /garage-admin/stats`

Doit limiter les calculs au `garage_id` de l'admin connecte.

Inclure :

- colis du garage.
- chauffeurs actifs.
- revenus garage.
- colis par statut.
- livraisons du jour.

## Stats chauffeur

Endpoint : `GET /driver/stats`

Inclure :

- colis assignes.
- colis actifs.
- livraisons terminees.
- note moyenne.
- revenus/score si applicable.

## Rapports

Endpoints :

- `GET /garage-admin/reports/daily?date=YYYY-MM-DD`
- `GET /garage-admin/reports/monthly?year=2026&month=6`
- `GET /garage-admin/reports/export`
- `GET /super-admin/reports/daily`
- `GET /super-admin/reports/monthly`
- `GET /reports/export`

Les exports peuvent retourner :

- JSON dans le MVP.
- CSV/PDF dans une iteration suivante.

## Audit logs

Endpoint : `GET /super-admin/audit-logs`

Filtres :

- `actorId`
- `action`
- `entityType`
- `entityId`
- `dateFrom`
- `dateTo`
- `page`
- `limit`

`from` et `to` sont aussi acceptes comme alias de `dateFrom` et `dateTo`.
Une date de fin sans heure inclut toute la journee UTC. Une periode inversee
est rejetee en 422. `search` recherche dans l'action, le type d'entite, le nom
de l'auteur et le request ID ; un UUID permet aussi de retrouver l'auteur ou
l'entite. Le total de pagination respecte les memes filtres que les lignes.

Actions recommandees :

- `user.create`
- `user.update`
- `user.status_update`
- `user.role_update`
- `user.delete`
- `garage.create`
- `garage.update`
- `garage.delete`
- `parcel.create`
- `parcel.status_update`
- `parcel.assign_driver`
- `parcel.cancel`
- `bid.accept`
- `bid.reject`
- `payment.confirm`
- `config.update`
- `backup.create`
- `backup.restore`

## Configuration systeme

Endpoint :

- `GET /super-admin/config`
- `PUT /super-admin/config`

Exemples de cles :

- `pricing.baseFee`
- `pricing.pricePerKg`
- `pricing.urgentFee`
- `score.deliveryCompleted`
- `score.signupBonus`
- `uploads.maxPhotoMb`
- `maintenance.enabled`

Toute modification doit creer un audit log avec `before_data` et `after_data`.

## Backups

Endpoints :

- `POST /super-admin/backup`
- `GET /super-admin/backups`
- `POST /super-admin/restore`

Regles :

- restauration uniquement `super_admin`.
- demander confirmation cote client.
- logger audit obligatoire.
- en production, stocker backups dans stockage externe securise.

