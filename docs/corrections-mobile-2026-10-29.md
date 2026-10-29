# Retours mobile du 29 octobre 2026

## Corrections API et Flutter

- Suppression du quota global par IP. Les routes d’authentification, OTP et
  imports conservent leurs protections propres. `RATE_LIMIT_MAX` n’est plus lu.
- Groupes d’actions adaptés à l’espace disponible et au grossissement système.
  Les libellés des boutons restent entiers, en particulier « Accepter » et
  « Contre-proposer ». Les actions étroites passent en colonne.
- La fiche du colis trouvé remplace le grand formulaire de recherche et passe
  avant la carte : description complète, statut, référence sélectionnable,
  trajet, poids, type, photo si disponible et destinataire. Les boutons de
  détail et de reçu sont directement accessibles. Les textes longs restent
  lisibles sur petit écran, avec les thèmes clair et sombre.
- Suivi des colis par flux GPS natif, notification persistante et verrou de
  veille Android ; mises à jour en arrière-plan et indicateur système iOS.
  Un seul flux dessert tous les colis transportés. Livrer un colis n’arrête pas
  les autres. La déconnexion et le changement de compte arrêtent le suivi.
- Le partage volontaire de proximité ne s’arrête plus lors de `paused`.
  Son activation est enregistrée par compte et restaurée après réouverture ;
  seul l’arrêt manuel efface ce choix. Une indisponibilité temporaire ou une
  déconnexion suspend les envois sans effacer la préférence du compte.
  Sans GPS/réseau, l’interrupteur reste activé avec un message d’attente.
  La reprise automatique ne répète pas les demandes de permission système.
  Les coupures réseau temporaires n’éteignent pas ce partage ou le suivi du
  départ. Sans mesure récente, les données restent indisponibles/anciennes,
  jamais remplacées par une position inventée.
- Le client rafraîchit le suivi toutes les cinq secondes pendant le transport,
  avec un seul appel en vol. Arrêt du rafraîchissement à la fin de la livraison.

## Suivi GPS client du transit à l’arrivée

La carte **Position GPS du colis** est maintenant présente dans le détail du
colis et dans l’écran de suivi. Un bouton **Suivre le colis sur la carte** y mène
directement depuis la fiche de résultat. Le marqueur suit les coordonnées du
téléphone du chauffeur, avec l’heure et la précision de la mesure ; le client
n’a pas besoin d’activer sa propre localisation pour voir son colis.

- `GET /api/v1/public/parcels/track/:trackingNumber/location` : lecture légère
  du statut et de la dernière position, avec `Cache-Control: no-store`.
- Actualisation toutes les 5 secondes, sans appels simultanés, jusqu’à la fin
  du transport. L’arrivée affiche **Colis arrivé** ; le dernier kilomètre peut
  ensuite rester suivi jusqu’à la remise, selon les statuts métier existants.
- Une mesure de plus de 2 minutes, future ou reçue avant une coupure réseau
  n’est jamais présentée comme **En direct**. La dernière position connue reste
  horodatée et une reprise automatique est tentée.
- Le GPS chauffeur continue en arrière-plan et reprend après une interruption
  du flux. Les envois GPS peuvent retenter le réseau malgré le mode hors ligne
  de consultation ; les protections des paiements restent inchangées.
- `GET /api/v1/driver/tracking-parcels` fournit tous les identifiants des colis
  transportés, sans la limite des 20 missions affichées par page.
- `POST /api/v1/driver/location` accepte `capturedAt` (ISO UTC, moins de 60 s).
  L’ordre des mesures dépend de cette heure, même si le réseau inverse leur
  réception. Le champ reste optionnel pour les anciens mobiles.
- Une transaction verrouille le colis avant de vérifier son assignation et son
  statut puis d’écrire le GPS. Une livraison ou une annulation concurrente ne
  laisse pas persister de nouvelle position hors de la fenêtre autorisée.

Validation complémentaire : **489 tests Flutter** réussis, puis **14 tests
ciblés** sur la carte et son accès direct ; **24 tests API** GPS et
confidentialité réussis sur PostgreSQL isolé. Ces modifications nécessitent
la livraison de l’API et du mobile pour être disponibles en production.

Les services natifs nécessitent les permissions de localisation du téléphone.
Ces corrections ne permettent pas de garantir une exécution après arrêt forcé
de l’application par le système ou l’utilisateur. Une recette sur Android et
iPhone physiques, écran verrouillé et avec coupure réseau, reste nécessaire.

## Pause et reprise des vocaux

Les formulaires de colis, d’offre et l’ancien formulaire d’annonce chauffeur
proposent désormais **Pause**, **Reprendre** et **Terminer**. La pause conserve
la prise native et son fichier ; le compteur exclut le temps en pause et il
est possible de terminer directement depuis cet état. La publication et le
passage au récapitulatif attendent la finalisation du vocal.

Les commandes natives sont sérialisées pour éviter les doubles appuis. Un
échec de pause/reprise conserve l’état précédent avec un message et un log ;
un échec d’arrêt permet de réessayer. Dans le champ vocal partagé des annonces,
la reprise de l’écoute continue désormais à la même position plutôt que de
recharger le fichier depuis le début.

Validation : **495 tests Flutter réussis** ; analyse sans erreur ni
avertissement (information préexistante sur `dart:html`).

Les tests couvrent les transitions, les commandes concurrentes, les erreurs
natives, la fin en pause, la durée enregistrée et un écran de 280 px avec texte
agrandi. Ces vérifications ne remplacent pas un essai du microphone sur
appareil physique. Aucune nouvelle version mobile n’a été publiée.

## Import d’itinéraires navette

Accessible dans **Mes trajets habituels → Importer des itinéraires CSV**.
Choisir le fichier, relire les arrêts, puis confirmer son import dans le carnet.
Les départs et leurs horaires sont ensuite publiés par le parcours existant.

```csv
ligne;zone;minutes
45;Dakar;0
45;Thiès;90
```

Utiliser les libellés exacts du référentiel ou, pour éviter les homonymes, les
UUID des zones. Les minutes sont relatives au départ et doivent commencer à
zéro, puis augmenter strictement. Une ligne CSV représente un arrêt ; plusieurs
numéros de ligne sont possibles dans le même fichier.

- CSV UTF-8, BOM Excel toléré, séparateurs virgule, point-virgule et tabulation.
- Colonnes `ligne`, `zone`, `minutes` ; alias anglais `lineNumber`, `zoneId`,
  `offsetMinutes` également acceptés.
- 128 Ko, 50 arrêts par fichier et 2 à 40 arrêts par itinéraire.
- Chauffeur connecté disposant d’un véhicule bus/navette et d’une capacité.
- Aperçu sans écriture : `POST /api/v1/driver/route-templates/import/preview`.
- Enregistrement : `POST /api/v1/driver/route-templates/import`.
- Les deux routes reçoivent un multipart avec un unique champ fichier `file`.
- Validation de tout le fichier avant enregistrement transactionnel. Une zone
  absente/ambiguë ou un horaire incohérent invalide tout le fichier.
- Même empreinte que le carnet existant : renvoyer le fichier ne duplique pas
  les itinéraires. Une modification de l’ordre ou des durées crée un autre
  modèle. Aucun prix d’une ancienne livraison n’est repris.

## Google : diagnostic et point restant

Le 29 octobre, `/api/v1/auth/google/config` en production renvoie un client Web
actif : `856894814285-blm20bnfamss8spptpjvp2c5984rgsni.apps.googleusercontent.com`.
Ce client appartient au projet **sendprocolismaps**
(`gmp-demo-project-672849367`), distinct du projet Firebase `sendprocolis`.
Les clients Android doivent être autorisés dans le même projet que ce client
Web, avec le package `com.sendprocolis.app` et la signature du binaire installé.

Signatures vérifiées et état de leur autorisation OAuth :

| SHA-1 | Observation |
| --- | --- |
| `A3:48:31:BF:2E:A7:DE:CE:3B:5B:1D:90:30:C3:31:83:FD:27:6A:58` | Correspond à l’APK release local existant, vérifié avec `apksigner`. |
| `6A:C2:65:49:0A:5B:54:D7:92:23:03:40:FA:AF:9D:5D:B8:9D:93:97` | Autre client Android préexistant. |
| `24:BE:58:23:BE:E4:66:5A:83:C8:8C:CF:74:0C:50:09:78:1A:17:23` | Clé configurée pour les builds release, vérifiée avec `keytool` ; autorisée par le client Android créé le 29 octobre à 20:13 UTC. |

Cette dernière empreinte a aussi été extraite directement du fichier demandé
par l’utilisateur : `~/Downloads/sendprocolis-upload-key.jks`. L’utilisateur a
créé le client `sendprocolis-android-upload-20261029`, dont la configuration a
été vérifiée en lecture dans Google Cloud :

```text
856894814285-8bon5r19bo0tbustju560efvsiggk5en.apps.googleusercontent.com
```

Son JSON téléchargé `client_secret_856894814285-8bon5r19bo0tbustju560efvsiggk5en.apps.googleusercontent.com.json`
a également été contrôlé : type `installed`, projet `gmp-demo-project-672849367`,
identifiant conforme, aucun secret client. Le mobile initialise déjà Google
avec le client Web de l’API ; le client Android est résolu par Google à partir
du package et du certificat de signature. Ce JSON ne remplace donc ni
`google-services.json` (Firebase), ni `GOOGLE_WEB_CLIENT_ID` côté serveur.

Le SHA-256 Play fourni par l’utilisateur (`EB:B8:…:FB:59`) appartient à un
certificat distinct du JKS local. Il ne permet pas de calculer son SHA-1 :
la clé de signature Play doit être autorisée séparément pour les installations
issues du magasin.

La signature **Play App Signing** est distincte de la clé d’importation et doit
être relevée dans Play Console → SendProColis → Protégé avec Play → Protection
Play Store → Gérer la signature d’application Play. Utiliser le SHA-1 de la
**Clé de signature d’applications**, y compris les anciennes clés encore
utilisées si Play en présente plusieurs. L’extraction automatique de cette
empreinte n’a pas abouti ; une copie manuelle a été demandée.

Le client Android créé par l’utilisateur est confirmé ; aucune connexion Google
réelle sur téléphone n’a encore été déclarée réussie. Le SDK Android documente qu’une signature mal
configurée peut remonter comme une annulation :
[documentation officielle du plugin](https://pub.dev/packages/google_sign_in_android#troubleshooting).

## Validation

- API : 40 tests ciblés réussis (Google, GPS, carnet, CSV, contrôle d’accès,
  transactions et suppression du quota général), PostgreSQL 18 isolé sous
  `/private/tmp`, port 25434, base `procolis_test`.
- Flutter : 478 tests réussis, dont neuf configurations de largeur/taille de
  texte et six cas de suivi natif, arrêt, erreurs temporaires et positions périmées.
  Six tests supplémentaires vérifient le partage persistant, et six autres
  l’affichage du colis en tête de page, les textes longs et les deux thèmes.
- Analyse Flutter : aucune erreur ni avertissement ; information préexistante
  de dépréciation `dart:html` dans `web_safe_image_web.dart`.
- Aperçu des actions vérifié à 360 px. Les essais automatisés ne remplacent
  pas une validation GPS/Google sur téléphone physique.
- Modifications Flutter reportées avec sauvegarde et contrôle préalable des
  fichiers concurrents. Aucun déploiement ni nouvelle publication Play effectué.

## Livraison Android 1.1.5 (14)

Vérifications avant publication : **616 tests API (69 suites)** et **495 tests
Flutter** réussis. Le contrôle statique mobile/API couvre **232 appels** sur
351 routes. La version 1.1.4 (13) a été confirmée active à 100 % dans la Play
Console ; la nouvelle version utilise donc le code 14.

Ordre de livraison : déployer l’API (les nouveaux endpoints GPS et CSV sont
nécessaires au mobile), diffuser Android en production, puis rendre sa mise
à jour obligatoire lorsque le code 14 est disponible pour tous les appareils
concernés. Configuration cible du serveur :

```dotenv
MOBILE_ANDROID_UPDATE_ENABLED=true
MOBILE_ANDROID_LATEST_VERSION=1.1.5
MOBILE_ANDROID_LATEST_VERSION_CODE=14
MOBILE_ANDROID_MIN_VERSION_CODE=14
MOBILE_ANDROID_RELEASE_NOTES_FR="Suivi GPS du colis, partage de position persistant, pause des vocaux et corrections mobiles."
MOBILE_ANDROID_UPDATE_URL=https://play.google.com/store/apps/details?id=com.sendprocolis.app
```

La configuration doit être appliquée à l’environnement effectif de l’API
(par exemple le complément runtime Compose), avec recréation du conteneur.
Vérifier ensuite `/api/v1/public/mobile-update` : `enabled=true` et
`latestVersionCode=minVersionCode=14`. Ne pas relever le minimum pendant
l’examen Google Play. Les versions déjà publiées qui intègrent le contrôle
affichent alors l’écran obligatoire.

État au contrôle initial : API disponible, politique de mise à jour désactivée,
nouveaux endpoints GPS absents. La clé SSH opérateur est reconnue par le VPS
mais verrouillée localement ; son déverrouillage est requis avant intervention.
