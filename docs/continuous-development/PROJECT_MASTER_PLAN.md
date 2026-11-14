# SendProColis — Plan maître

Référence stable de la vision et des principes. À ne pas régénérer à chaque session, à amender seulement quand une décision structurante change.

## Vision

Transformer SendProColis en marketplace de transport universelle : particulier, commerçant, transporteur indépendant ou opérateur collectif peut faire acheminer un colis par le mode le plus adapté — moto urbaine, voiture, navette Tata/AFTU/DDD, car interurbain, livraison collaborative, expédition internationale.

## Principes non négociables

1. **Liberté des prix** — SendProColis n'impose aucun tarif. Toute négociation reste bilatérale (client ↔ transporteur). Les estimations IA sont indicatives. Le prix verrouillé après accord est protégé serveur contre modifications unilatérales. Voir audit : `Bid` + `NegotiationMessage` déjà opérationnels.
2. **Architecture additive** — Ne pas reconstruire. Chaque phase étend les modèles existants (migration additive, nullable, préservation des contrats API mobile).
3. **Traçabilité continue** — Un colis ne peut jamais entrer dans un "trou" de responsabilité. Chaque handover doit être prouvable (QR, PIN, photo, signature, GPS, horodatage).
4. **GPS honnête** — Distinguer position live / récente / obsolète. Jamais présenter une ancienne position comme actuelle. L'arrivée à un arrêt ≠ livraison effective.
5. **IA consultative** — Peut suggérer prix, trajet, anomalie. Ne décide jamais de paiement, de livraison confirmée, ni de modification d'accord.

## Architecture cible

Base conservée : Node.js/Express/Prisma/PostgreSQL + Flutter/Riverpod + PayDunya + FCM/Brevo/WhatsApp + Google Maps.

Nouveaux concepts à introduire par extensions ciblées (jamais en doublon) :

- **Multi-colis multi-arrêts** : `AdvertisementOffer` enrichi d'une affectation d'arrêts (boarding / dropOff) + endpoint manifeste par trajet.
- **Correspondances** : modèle de transfert/handover entre véhicules (`ParcelHandover` futur) avec preuve réciproque.
- **Expéditions groupées** : `ShipmentBatch` (N colis sous un ordre commercial) — à ne créer qu'au moment où un cas concret l'exige (B2B, e-commerce).
- **Géofencing opérationnel** : combinaison `TransitLineStop.zoneId` + `JourneyLive.lat/lng` + anomaly-detector existant.

## Phases

| Phase | Nom | État |
|---|---|---|
| 0 | Continuité & audit | **En cours** |
| 1 | Multi-colis multi-arrêts (navette) + manifeste | Démarré (SCP-001) |
| 2 | Correspondances / handover inter-véhicules | À planifier |
| 3 | Géofencing & alertes temps réel | À planifier |
| 4 | Expéditions groupées (B2B / e-commerce avancé) | À planifier |
| 5 | International étendu (docs, douane, carriers) | Base existante (CEDEAO pricing) |
| 6 | IA opérationnelle (matching, routing TSP) | Base existante (ai-assistant, driver-scoring) |

## Dépendances

- **Phase 1 → Phase 2** : l'affectation d'arrêts est le socle nécessaire aux correspondances.
- **Phase 3 → Phase 1** : la détection d'arrivée par géofencing a besoin que chaque offre connaisse son dropOffStop.
- **Phase 4 → Phase 1** : un batch regroupe N `AdvertisementOffer` (ou N `Parcel`) qui ont déjà leurs arrêts.

## Décisions structurantes antérieures (conservées)

- 1 `Parcel` = 1 paire sender/receiver (ne pas transformer en entité multi-destinataires ; on introduira un batch au-dessus plutôt que casser le modèle).
- `Bid` + `AdvertisementOffer` cohabitent : `Bid` pour la négociation sur un colis isolé (point-à-point), `AdvertisementOffer` pour la réservation sur un trajet publié. Ne pas fusionner.
- Les enrichissements de tracking (`eta`, `anomalies`) sont non-breaking et pilotés par `SystemConfig.*.enabled`. Conserver ce pattern pour toute nouvelle feature.
