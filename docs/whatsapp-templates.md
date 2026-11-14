# Templates WhatsApp Business — procédure d'approbation Meta

## Statut : à soumettre à Meta Business Manager

Les 5 templates ci-dessous sont codés dans `src/utils/whatsapp.js` et prêts à être soumis. Tant qu'ils ne sont pas approuvés par Meta, `sendParcelStatusWhatsApp` dégrade silencieusement (fire-and-forget) — aucun impact utilisateur.

## Les 5 templates

| ID | Statut parcel | Catégorie Meta | Langue | Variables |
|---|---|---|---|---|
| `procolis_parcel_picked_up` | `picked_up` | Utility | fr | `{{1}}` = nom destinataire, `{{2}}` = numéro de suivi |
| `procolis_parcel_in_transit` | `in_transit` | Utility | fr | idem |
| `procolis_parcel_out_for_delivery` | `out_for_delivery` | Utility | fr | idem |
| `procolis_parcel_delivered` | `delivered` | Utility | fr | idem |
| `procolis_parcel_anomaly` | n/a (anomaly_events) | Utility | fr | `{{1}}` = nom, `{{2}}` = numéro de suivi, `{{3}}` = type anomalie |

### Contenus suggérés (à copier-coller dans Meta Business Manager)

#### 1. `procolis_parcel_picked_up`
```
Bonjour {{1}} 👋
Votre colis SendProColis n° {{2}} vient d'être pris en charge par le chauffeur.
Vous suivre sa progression sur l'application.
```

#### 2. `procolis_parcel_in_transit`
```
Bonjour {{1}},
Votre colis SendProColis n° {{2}} est en route.
Vous recevrez une notification dès qu'il approchera du point de livraison.
```

#### 3. `procolis_parcel_out_for_delivery`
```
Bonjour {{1}},
Votre colis SendProColis n° {{2}} est en livraison finale aujourd'hui.
Vérifiez votre SMS pour le code de remise à communiquer au chauffeur.
```

#### 4. `procolis_parcel_delivered`
```
Merci {{1}} 🎉
Votre colis SendProColis n° {{2}} a bien été livré.
Pensez à noter votre chauffeur dans l'application.
```

#### 5. `procolis_parcel_anomaly`
```
Attention {{1}},
Une anomalie a été détectée sur le trajet de votre colis n° {{2}} : {{3}}.
Notre équipe support vous recontactera si nécessaire.
```

## Procédure Meta

1. Se connecter à **business.facebook.com** → sélectionner le compte business SendProColis.
2. **WhatsApp Manager** → **Message templates** → **Create template**.
3. Pour chaque template : catégorie **Utility**, langue **Français**.
4. Coller le texte, remplacer `{{N}}` dans les placeholders que Meta génère automatiquement.
5. Soumettre pour approbation. Délai Meta : **24–72h** (généralement 24h pour catégorie Utility).
6. Une fois approuvés, poser les secrets suivants dans `.env` prod :
   ```
   META_WHATSAPP_ACCESS_TOKEN=EAAxxxxx
   META_WHATSAPP_PHONE_NUMBER_ID=1234567890
   META_WHATSAPP_API_VERSION=v21.0  # optionnel
   ```
7. Redémarrer l'API. `sendParcelStatusWhatsApp` enverra automatiquement les messages selon les transitions de statut.

## Kill-switch

En cas d'incident côté Meta ou pour désactiver globalement l'envoi WhatsApp :

```sql
INSERT INTO system_configs (key, value) VALUES ('whatsapp.enabled', 'false')
ON CONFLICT (key) DO UPDATE SET value = 'false';
```

Note : la lecture de ce flag n'est **pas encore branchée** dans `sendParcelStatusWhatsApp`. Pour la V1, la désactivation se fait en retirant les variables `META_WHATSAPP_*` du `.env` (dégrade gracieusement).

## Monitoring

Chaque envoi est journalisé dans la table `whatsapp_dispatches` :
- `status` : `sent` | `delivered` | `read` | `failed`
- `error` : message d'erreur Meta (si échec)
- `templateName` : template appelé

Dashboard SQL simple :
```sql
SELECT status, COUNT(*) FROM whatsapp_dispatches
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

## Checklist pré-production

- [ ] 5 templates soumis à Meta
- [ ] 5 templates approuvés (vérifier dans WhatsApp Manager)
- [ ] `META_WHATSAPP_ACCESS_TOKEN` posé dans `.env` prod
- [ ] `META_WHATSAPP_PHONE_NUMBER_ID` posé dans `.env` prod
- [ ] Test d'envoi réel vers un numéro de test
- [ ] Vérifier qu'une ligne apparaît dans `whatsapp_dispatches` avec `status = 'sent'`
