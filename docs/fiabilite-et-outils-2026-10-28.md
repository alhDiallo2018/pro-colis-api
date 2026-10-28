# SendProColis — fiabilité, outils professionnels et qualité

Travail intégré au code API, web et Flutter, sans déploiement en production. Les règles de prix, négociation, affectation, commissions et remise restent celles du parcours existant.

## Fonctionnalités intégrées

- Reprise d'un envoi avec une clé stable et un journal local par compte. Le serveur sérialise les requêtes concurrentes et conserve leur résultat dans la transaction de création. Une réponse perdue ne provoque plus une deuxième création lorsque la demande est rejouée avec sa clé.
- Pièces jointes conservées sur disque mobile ou dans IndexedDB sur le web, état d'envoi sauvegardé après chaque fichier et upload dédupliqué. Les photos web sont réduites avant leur sauvegarde ; leurs octets restent identiques pendant la reprise. Un manque de stockage bloque la publication avant l'appel réseau. Déconnexion : purge locale des données du compte.
- Imports CSV/XLSX avec aperçu, erreurs par ligne, limites de taille et de nombre de colis, traitement isolé côté API. Les imports produisent des brouillons : chaque envoi passe encore par la confirmation habituelle.
- Carnet de destinataires sur web et mobile, accès privé et suppression individuelle. Suivi du nombre de brouillons publiés et lien vers leurs colis.
- Réclamations reliées au fil support ; accès à la conversation depuis la réclamation ; notification interne lors d'un changement de statut.
- Tableau « Qualité de service » web et mobile, réservé au super-admin et au support technique. Créations, livraisons, retards estimés, échecs de paiement, abandons présumés et délai de première réponse du support. Les moyennes reposent sur des messages réels, pas sur un simple changement de statut.
- Écrans web chargés à la demande, précache PWA limité au socle initial, écran de récupération si le chargement d'une page échoue.

## Limites de la reprise

La protection exige la conservation de la clé : les anciennes versions sans `requestId`, la suppression des données de l'application ou une déconnexion après une réponse perdue ne permettent pas une reprise locale automatique. Consulter l'historique serveur avant une nouvelle publication dans ces cas. Un colis déjà créé avec des médias restants reste consultable. Aucun paiement n'est rejoué par cette nouvelle file.

Le lot suit les brouillons encore présents dans les outils, pas un registre comptable permanent. La suppression d'un brouillon publié retire sa ligne du suivi, sans supprimer le colis.

## Préparation de la recette externe

- Aucun téléphone physique détecté. Les compilations Android et iOS simulateur vérifient l'intégration native ; elles ne valident pas le GPS en arrière-plan, les autorisations système, la réception push appareil fermé ou le partage vers d'autres applications.
- Pas de configuration prestataire détectée dans les variables d'environnement inspectées. Les paramètres éventuellement stockés dans une base métier n'ont pas été utilisés. `node scripts/check-delivery-sandbox.mjs` fournit uniquement un état de présence, sans exposer de secrets et sans envoyer de paiement, SMS ou push.
- Avant recette externe : choisir le serveur de recette, les comptes PayDunya de test, le projet Firebase de test et les numéros/appareils destinataires autorisés. Exécuter succès, refus, délai dépassé et callback répété ; vérifier une seule écriture métier et l'état visible client/chauffeur.
- Wolof : trois textes de travail dans `help-guides-wo.review.json`, **non publiés**, accompagnés du français de référence. Une relecture par un locuteur et l'enregistrement des audios restent nécessaires. Les guides français existants restent disponibles.

## Installation

API : installer les dépendances, exécuter `prisma generate`, puis appliquer les migrations selon la procédure du serveur cible. Cette passe ajoute `20261102000000_reliable_operations` et `20261103000000_ticket_threads`, vérifiées uniquement sur la base PostgreSQL de tests isolée.

Web : `npm install`, `npm run build`. Flutter : `flutter pub get`, puis compilation habituelle. La dépendance `file_picker` est verrouillée dans `pubspec.lock`; la compilation iOS régénère les dépendances natives.

Le parser XLSX utilise ExcelJS et la vérification d'archive fflate. Le sélecteur natif suit l'API de [file_picker 11.0.3](https://pub.dev/packages/file_picker/versions/11.0.3). Les contrôles d'archive suivent le filtre de [fflate](https://github.com/101arrowz/fflate/blob/master/README.md).

## Résultats des vérifications

- API : **599 tests, 66 suites**, tous réussis sur PostgreSQL isolé. La nouvelle suite couvre concurrence, réponse perdue/rejeu, publication unique d'un brouillon, média rejoué, droits d'accès, imports CSV/XLSX, liaison réclamation/conversation, notification unique et calcul des abandons.
- Web : **274 tests, 48 fichiers**, tous réussis ; compilation de production réussie ; vérification visuelle locale des outils en largeur étroite et de l'aperçu de lot. Quatre avertissements de lint déjà présents restent dans MapPicker, LocationInput et RecipientSelection ; aucun nouvel avertissement lié aux routes.
- Flutter : **448 tests**, tous réussis dans le projet final ; analyse sans erreur, avec le seul signalement existant de `dart:html` déprécié. Compilations **APK Android debug** et **iOS simulateur debug** réussies dans la copie de recette.
- Taille du fichier JavaScript principal : environ **1,64 Mo → 499 Ko** ; gzip **428 Ko → 156 Ko**. Ensemble des 14 fichiers JavaScript du socle initial après découpage : **650 Ko / 205 Ko gzip**. Ce sont des mesures de fichiers, pas une mesure du temps de chargement sur réseau réel ni des Core Web Vitals.
- `git diff --check` : aucun défaut d'espacement dans les trois projets.

Les outils de compilation signalent encore les avertissements de compatibilité de certains plugins natifs. L'audit des dépendances signale aussi des vulnérabilités restantes (API : 9, dont 1 haute ; web : 2 modérées, liées à l'outillage Vitest). Les mises à jour compatibles réalisées côté API ne suffisent pas à clore cet audit ; la migration Zod majeure et les correctifs restants de l'outillage de test restent à traiter avant de déclarer la pile entièrement assainie.
