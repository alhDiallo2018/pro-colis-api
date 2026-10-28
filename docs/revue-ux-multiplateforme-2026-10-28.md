# Revue SendProColis — client et chauffeur

> Première passe, complétée par [les ajouts de parcours et leur validation PostgreSQL](ameliorations-parcours-2026-10-28.md). Les limitations de test API décrites ici ont été levées lors de cette seconde passe.

28 octobre 2026. Corrections locales dans `ProColis-Web` et `Mobile/ProColis`.
Les changements déjà présents dans les trois dépôts ont été conservés : une
empreinte de chaque fichier a été vérifiée avant le report des corrections.
Aucune migration ni modification des règles métier de l’API n’a été ajoutée.

## Périmètre réellement traité

- Web/PWA : tableaux de bord client/chauffeur, navigation, suivi, filtres de
  colis, composants de formulaire, fenêtres de dialogue, actions et états réseau.
- Flutter Android/iOS : tableaux de bord, rafraîchissement des listes client et
  chauffeur, boutons partagés, affichage des statistiques avec grands caractères,
  imports de composants et tests du formulaire d’annonce.
- Administration : bénéfice des composants web partagés ; les parcours métier
  d’administration n’ont pas fait l’objet d’une recette complète.
- Identité conservée : couleurs SendProColis, Plus Jakarta Sans/Manrope,
  rôles, routes, négociation, tarifs, commissions et statuts métier existants.

## Constats et corrections

| Priorité | Constat vérifié | Impact | Correction |
| --- | --- | --- | --- |
| P1 | Clics imbriqués dans les cartes client/chauffeur | Le bouton de suivi pouvait être remplacé par la navigation du parent ; l’itinéraire ouvrait aussi le détail | Suppression du clic parent et actions explicites ; suivi prérempli avec la référence du colis |
| P1 | Chargement/échec présenté comme zéro ou liste vide | L’utilisateur pouvait croire ne plus avoir de mission ou d’offre | Valeurs indisponibles signalées, états de chargement, message d’erreur et reprise ; conservation des dernières données reçues |
| P1 | Dialogues sans gestion du clavier | Focus pouvant sortir de la fenêtre, titre non associé, fermeture difficile | Nom accessible, focus initial, boucle Tab, Échap, restauration du focus et gestion des fenêtres imbriquées |
| P1 | Tiroir mobile fermé restant dans le parcours clavier | Navigation vers du contenu invisible | Menu fermé inerte, menu ouvert modal, bouton Fermer, contenu de fond inerte, lien d’évitement |
| P1 | Erreurs de formulaire non reliées aux champs | Les lecteurs d’écran perdaient le contexte de l’erreur | `aria-invalid`, descriptions associées, erreurs annoncées et callbacks focus/blur conservés |
| P1 | Rafraîchissements Flutter renvoyant `void` | L’indicateur se terminait avant le chargement des colis | Propagation de `Future<void>` jusqu’aux listes ; attente des requêtes existantes |
| P1 | Hauteurs fixes des boutons et statistiques Flutter | Risque de texte coupé avec grands caractères ou montants longs | Hauteurs minimales, libellés flexibles, statistiques sur une ou deux colonnes selon l’espace et le texte |
| P1 | Imports remontant trop haut dans deux composants Flutter | Erreurs d’analyse de `parcel_media` et `pay_commission_dialog` | Chemins relatifs corrigés |
| P2 | Menus longs et vocabulaire ambigu | Difficulté à retrouver colis, offres et finances | Groupes par usage, « Mes colis », accès aux offres reçues, « Portefeuille » |
| P2 | Actions et focus peu homogènes | Lecture et interaction moins confortables | Contraste des actions renforcé, cibles tactiles agrandies, focus visible, mouvement réduit respecté |

Les boutons Flutter conservent leur nom pendant le chargement et leur action
sémantique reste utilisable par un lecteur d’écran. Les doubles soumissions
restent désactivées pendant l’attente.

## Appréciation technique des surfaces examinées

Évaluation indicative sur le code et les vérifications décrites ci-dessous,
non une certification WCAG ni une recette exhaustive de tous les écrans.

| Dimension | Score / 4 | Observation |
| --- | --- | --- |
| Accessibilité | 3 | Corrections clavier/formulaires/boutons testées ; contrôle manuel VoiceOver/TalkBack restant |
| Performance | 2 | Build réussi, mais bundle principal encore volumineux |
| Responsive | 3 | Repli des actions et boutons flexibles ; grands caractères testés en Flutter |
| Cohérence visuelle | 3 | Tokens et marque conservés, contraste renforcé ; styles en ligne encore nombreux |
| Sobriété de l’interface | 3 | Actions principales visibles et menus regroupés ; densité des tableaux de bord encore perfectible |
| Total | 14/20 | Bon sur le périmètre examiné, vérifications terrain encore nécessaires |

L’identité propre au produit est préservée. Les nouvelles surfaces utilisent
les composants existants et une hiérarchie courte. Le nombre de cartes et de
petits indicateurs dans certains écrans reste un point à simplifier lors d’une
revue visuelle plus large.

## Validation

- Web : **267 tests réussis**, **46 fichiers de tests**. Les nouveaux tests
  couvrent suivi prérempli, absence de clic parent, chargement, reprise après
  erreur, focus des dialogues, erreurs de champs et filtres accessibles.
- Build TypeScript/Vite/PWA : réussi. Bundle JS principal : environ **1,63 Mo**,
  **422 Ko gzip** ; avertissement de taille conservé et non masqué.
- Lint web : aucune erreur ; quatre avertissements existants dans
  `RecipientSelection`, `MapPicker` et `LocationInput`.
- Flutter : **443 tests réussis** sur le dépôt mobile après application,
  avec `flutter test --no-pub --concurrency=1`. Les trois nouveaux tests
  vérifient les grands caractères, le nom pendant le chargement et
  l’activation des boutons par lecteur d’écran.
- Analyse Flutter : aucune erreur ni avertissement ; une information existante
  de dépréciation de `dart:html` dans `web_safe_image_web.dart`.
- Tests d’annonces : les attentes obsolètes sur le prix fixe ont été alignées
  avec la négociation déjà implémentée. La publication vocale utilise un client
  API injecté simulant un véhicule enregistré ; aucune condition métier n’a été
  retirée pour faire passer un test.
- `git diff --check` : aucune erreur dans les dépôts web et mobile.
- Revue visuelle locale du tableau de bord client avec données fictives.
  Cette vérification ne remplace pas une recette de tous les écrans sur appareils.

## Limites et suites de validation

- L’API a été testée sans changement métier : **194 tests réussis**, **389 en
  échec**, répartis sur 23 suites réussies et 40 en échec. Les tests d’intégration
  rencontrent notamment l’indisponibilité de `postgres:5432`. Docker n’est pas
  démarré. Ces résultats ne permettent pas de conclure sur le fonctionnement
  intégré ni d’affirmer que toutes les fonctionnalités sont validées.
- Aucun paiement réel, SMS, envoi de colis réel ou déploiement n’a été effectué.
- À reprendre avec PostgreSQL de test disponible : tests API complets, puis
  envoi client → offre chauffeur → acceptation → livraison et paiement simulé.
- À vérifier sur appareils physiques : clavier, gestes, VoiceOver/TalkBack,
  permissions GPS/caméra/microphone, notifications et mode hors connexion.
- Suite recommandée : `/optimize` pour étudier le chargement par rôle, `/adapt`
  pour la recette des petits écrans et `/polish` pour la finition visuelle.
