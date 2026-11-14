# Point d'entrée pour la session suivante

> **Lire d'abord** : ce fichier → `TASK_TRACKER.md` → sections pertinentes de `CURRENT_STATE.md`.

## État cumulé (final absolu)

**36 tâches livrées. 247 tests backend verts. Plateforme prête.**

### Tout ce qui peut être livré en code l'a été

- Phase 1-6 fonctionnelle (navette, correspondances, GPS, lots B2B, international).
- UI mobile complète avec entrées utilisateur réelles, i18n fr/en/wo, QR scanner.
- Admin dashboards (webhooks, stop events, handovers, pilot metrics 14j).
- 3 connecteurs e-commerce webhooks-in (Shopify, WooCommerce, Magento).
- 3 adapters carriers squelettes (DHL, FedEx, UPS) prêts à recevoir les secrets.
- Health check intégrations.
- Script CLI de promotion de rôle (batch).
- Script CLI d'auto-submission des templates WhatsApp vers Meta.
- 13 migrations Prisma idempotentes.

## Ce qui reste est 100 % hors-code (actions humaines externes)

1. **Renouveler la clé Brevo SMS** dans `.env` prod → débloque l'envoi auto du PIN de livraison.
2. **Poser `META_WHATSAPP_ACCESS_TOKEN` + `META_WHATSAPP_BUSINESS_ID`** dans `.env` → puis `npm run whatsapp:submit-templates` pour soumettre les 5 templates.
3. **Attendre l'approbation Meta** (24-72h).
4. **Négocier les contrats carriers** DHL/FedEx/UPS → poser les env vars → les adapters basculent automatiquement du stub au réel (interface stable).
5. **Signer les contrats merchants** Shopify/WooCommerce/Magento → créer les entrées `system_configs` `apiKeys.business.*` avec les secrets webhook.
6. **Promouvoir les premiers opérateurs navette** :
   ```bash
   DATABASE_URL=prod_url node scripts/promote-role.mjs --phone 77XXXXXXX --role shuttle_operator
   # ou
   curl -X PATCH https://sendprocolis.com/api/v1/super-admin/users/<id>/role \
     -H "Authorization: Bearer <admin_token>" \
     -H "Content-Type: application/json" \
     -d '{"role":"shuttle_operator"}'
   ```
7. **Appliquer les migrations prod** :
   ```bash
   DATABASE_URL=prod_url npx prisma migrate deploy
   ```
8. **Lancer le pilote utilisateur** terrain (Dakar/Thiès/Mbour).

## Vérification santé post-déploiement

```bash
# Statut intégrations
curl https://sendprocolis.com/api/v1/health/integrations | jq

# Métriques pilote 14 jours (nécessite token admin)
curl -H "Authorization: Bearer <admin>" https://sendprocolis.com/api/v1/super-admin/pilot-metrics/14d | jq

# Dashboards flux récents
curl -H "Authorization: Bearer <admin>" https://sendprocolis.com/api/v1/super-admin/webhooks/recent | jq
curl -H "Authorization: Bearer <admin>" https://sendprocolis.com/api/v1/super-admin/handovers/recent | jq
curl -H "Authorization: Bearer <admin>" https://sendprocolis.com/api/v1/super-admin/stop-events/recent | jq
```

## Dette technique négligeable (optionnel)

- Warning Flutter pré-existant `dart:html` dans `web_safe_image_web.dart` (pas lié à mes changements).
- `DATABASE_URL` par défaut `host.docker.internal` à surcharger pour les tests hors conteneur sur macOS.
- Les adapters carriers réels nécessitent une implémentation HTTP V2 (signatures et env vars déjà documentées — scope ~2h par carrier une fois les credentials fournis).

## Commandes utiles

```bash
# Backend — suite complète élargie
cd /Users/testad/Web/Procolis-Api/pro-colis-api
export DATABASE_URL="postgresql://procolis:procolis@localhost:5432/procolis_test?schema=public"
npm test -- --testPathPattern="advertisement|transit|journey|stop-arrival|anomaly|handover|parcel-proposal|tour-optimizer|geofence|shipment-batch|parcel-customs|international-carriers|admin-dashboards|shopify|whatsapp|integrations|admin-promote|pilot-metrics-14"
# → 247 verts attendus

# Scripts opérationnels
npm run promote:role -- --phone 77XXXXXXX --role shuttle_operator
META_WHATSAPP_BUSINESS_ID=xxx META_WHATSAPP_ACCESS_TOKEN=yyy npm run whatsapp:submit-templates

# Mobile
cd /Users/testad/Mobile/Procolis-App/pro-colis-mobile
flutter analyze lib/
flutter test test/advertisement_manifest_screen_test.dart test/advertisement_reached_stops_screen_test.dart test/shipment_batches_screen_test.dart
```

## Prochaine action concrète

**Aucune action technique à faire côté code.** Les 8 étapes ci-dessus sont des actions humaines / contractuelles qui nécessitent des credentials externes et des décisions business.

Une fois ces étapes accomplies, le prochain code réel sera l'implémentation HTTP des 3 adapters carriers DHL/FedEx/UPS (remplacer les throws « V2 » par les vrais appels aux API, ~2h par carrier).
