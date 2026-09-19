# Déboursement PayDunya

Source : [documentation officielle API PUSH](https://developers.paydunya.com/doc/FR/api_deboursement), consultée le 19 septembre 2026, sections 1, 2 et 4.

## Règles du prestataire

- `get-invoice` reçoit `account_alias`, `amount`, `withdraw_mode`, `callback_url`. `debit_account_number` concerne uniquement le mode `paydunya`.
- Le callback contient notamment `hash`, `status`, `token` ; le hash attendu est le SHA-512 de la MasterKey.
- Après une erreur de `submit-invoice`, consulter `check-status` avec le même token : `created` impose une resoumission, `pending` demande d'attendre, `success` et `failed` sont terminaux.
- Certains exemples de succès wallet omettent `status` avec `response_code: "00"`.
- `4002` peut désigner un callback inaccessible ou des fonds insuffisants : lire `response_text`.

La documentation ne précise pas de protocole de sonde GET/HEAD ou POST vide. Leur réponse HTTP ne suffit donc pas à identifier la cause du refus PayDunya.

## Sonde observée en production

Les logs du 19 septembre 2026 à 17:43:18 UTC montrent, pendant `get-invoice`,
un POST `application/x-www-form-urlencoded` avec une seule clé `data`, de type
chaîne et de longueur zéro. Son rejet local en HTTP 400 est immédiatement suivi
du refus PayDunya `4002: the callback is not accessible`.

Le correctif acquitte uniquement ce formulaire `data=` en HTTP 200, sans
lecture de configuration, recherche de retrait ni écriture en base. Cette
compatibilité repose sur les logs observés, pas sur une sonde décrite dans la
documentation. Les autres corps, notamment `data=` accompagné de champs de
transaction, passent toujours par la validation habituelle. Les requêtes GET
et les POST entièrement vides ne bénéficient d'aucune exception.

## Choix ProColis

L'approbation retourne HTTP 502 et `success: false` si le versement échoue : c'est le contrat de notre API, pas une exigence PayDunya. Après une soumission, une réponse ambiguë ou un incident réseau conserve les fonds gelés. Une seule reprise immédiate est autorisée par appel ; un retrait encore incertain reste à réconcilier.

## Diagnostic du callback inaccessible

Contrôler la valeur exacte `callback_url` du log `PAYOUT_REQUEST`, puis `PAYDUNYA_RESPONSE` et les logs entrants correspondants. Ne pas partager les clés, tokens ou hash.

Pour ce déploiement, la configuration attendue est `PUBLIC_BASE_URL=https://sendprocolis.com`, sans `/api/v1`. L'URL construite est `https://sendprocolis.com/api/v1/payments/paydunya/disburse-callback`. Vérifier ces valeurs sur le serveur : le `.env` local ne prouve pas la configuration de production. Les callbacks reçus doivent passer la vérification de signature avant toute écriture financière.
