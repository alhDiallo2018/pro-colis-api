# SendProColis — compléments client, chauffeur et support

Travail appliqué le 28 octobre 2026 dans les trois projets : API, web/PWA et
Flutter Android/iOS. Il complète la première revue UX du même jour. Les
changements préexistants ont été conservés ; les fichiers web/mobile ont été
reportés après vérification de leurs empreintes.

## Fonctionnalités livrées

| Besoin | Réalisation |
| --- | --- |
| Prochaine action | Indication selon le rôle et le statut, attente des offres ou du prochain interlocuteur, consigne de remise du code. Les transitions existantes restent la seule autorité. |
| Nouveau colis | Reprise explicite d’un ancien colis ; coordonnées, trajet et description modifiables. Prix, chauffeur, paiement, médias et statut ne sont pas copiés. Brouillon texte mobile par compte, en complément du brouillon web existant. |
| Comparaison des offres | Filtre par colis, tri par dernier échange ou prix, dernier prix/commentaire cohérents, véhicule et disponibilité déclarée. Une disponibilité inconnue est affichée comme telle. |
| Suivi | Horodatage de la dernière position, distinction entre position récente et ancienne, alerte si l’estimation de livraison est dépassée. Aucun délai d’arrivée inventé. |
| Finances | Prix convenu, paiements confirmés, reçus du payeur ; pour le chauffeur : commission historique ou estimation identifiée, montant réglé, dette créée pour ce colis, dette actuelle du compte et net après commission. Les montants privés sont filtrés par rôle côté serveur. |
| Réclamations | Motif, texte, jusqu’à quatre photos ; ticket lié au colis dans le support existant, statut consultable et accès à la conversation support. Répéter une même demande après coupure réseau ne crée pas un second ticket. |
| Réseau limité | Compression des photos de colis et de réclamation, conservation de la saisie en cas d’échec, reprise des pièces jointes après création mobile sans republier le colis déjà confirmé. |
| Envois réguliers/professionnels | « Mes outils d’envoi » : préparation de 1 à 50 brouillons en une opération, 100 brouillons maximum par compte, complément/relecture individuelle avant publication, historique et reçus paginés. |
| Alertes | Abonnement explicite à un trajet dans un sens donné, durée de 30 jours dans l’interface, désactivation immédiate. Notification dans l’application lors d’un nouveau départ correspondant, y compris les départs planifiés. Une modification d’annonce ne renotifie pas deux fois la même alerte. |
| Aide | Sélection Français/Wolof et guides administrables depuis la configuration. Trois consignes audio françaises courtes, avec transcription. Les guides en wolof attendent des textes et enregistrements validés ; l’interface propose le support lorsqu’aucun guide n’est publié. |

## Compatibilité et données

Deux migrations additives :

- `20261031000000_delivery_workspace` : alertes, déduplication des alertes et
  brouillons d’envoi, supprimés avec leur compte.
- `20261101000000_help_guides` : contenu français initial dans `help.guides`,
  uniquement si la clé n’existe pas déjà.

Les routes privées `/api/v1/experience` sont réservées aux clients et chauffeurs.
Un chauffeur ne lit que ses colis attribués ; un client ne lit que ses envois.
Les brouillons, alertes, réclamations et reçus sont cloisonnés par compte.
Les méthodes de contrôleur passent par un garde `try/catch` avec journalisation
du contexte et normalisation des erreurs, sans contenu privé dans les logs.

Les réclamations alimentent les tickets et messages support existants. Leur
statut est celui du ticket ; elles ne créent pas une seconde messagerie. Les
notifications de trajet sont internes à l’application, sans SMS ou email ajouté.

Aucune règle de prix, attribution, négociation, commission, annulation ou paiement
n’a été remplacée. L’espace professionnel prépare des lots de brouillons : la
publication de chaque colis suit le formulaire et les contrôles actuels.
Un reçu téléchargeable/partageable est un justificatif de paiement confirmé,
présenté comme tel, et non une facture fiscale.

## Validation

- Base PostgreSQL 16 de test créée sur `127.0.0.1:25433`, base `procolis_test`,
  conteneur `sendprocolis-ux-test-20261028`. Aucune base existante modifiée.
- Suite API complète et tests ciblés sur l’accès privé, les reçus, les commissions
  historiques en points, les lots rejouables, les réclamations concurrentes et le
  sens/dédoublonnage des alertes. Résultat final consigné en fin de document.
- Web : 271 tests réussis, 47 fichiers ; build TypeScript/Vite/PWA réussi.
  Quatre avertissements de lint préexistants, aucune erreur. Le bundle principal
  reste volumineux (environ 1,64 Mo, 428 Ko gzip).
- Flutter : 446 tests réussis dans le dépôt final. Analyse sans erreur ni
  avertissement ; information de dépréciation `dart:html` déjà présente.
- Revue visuelle locale avec données fictives : suivi et préparation d’envois à
  375 px, relecture d’une ligne avant son enregistrement. Les composants
  conservent les couleurs, polices et composants SendProColis.
- Trois fichiers MP3 vérifiés, durées d’environ 10 à 11 secondes chacun.

## Validation restant extérieure à ce travail

- Textes et voix wolof à faire valider puis publier via `help.guides`
  (`id`, `language: "wo"`, `title`, `text`, `audioUrl`, `published: true`).
  Les enregistrements audio externes doivent utiliser HTTPS.
- Recette sur appareils Android/iPhone physiques : localisation en arrière-plan,
  permissions, partage natif et conditions réseau réelles.
- Vérification des fournisseurs de paiement, SMS et notifications en environnement
  de recette avec leurs identifiants dédiés. Les tests automatisés utilisent des
  simulations ; aucun paiement ni message réel n’a été déclenché.

Aucun déploiement n’a été effectué. Les migrations doivent accompagner les
versions API/web/mobile lors de leur mise en service. Les anciennes versions
peuvent continuer à employer les routes métier existantes.

## Résultat final

- API : **592 tests réussis, 65 suites**, sur PostgreSQL isolé.
- Web/PWA : **271 tests réussis, 47 fichiers**, compilation réussie.
- Flutter : **446 tests réussis**, dans le projet mobile final.
- `git diff --check` : aucune erreur dans les trois projets.
- 32 fichiers web/mobile créés ou complétés, avec contrôle des modifications
  concurrentes. Aucun fichier restant à reporter depuis la préparation locale.

Le conteneur PostgreSQL de test a été arrêté après validation. Il peut être
redémarré avec `docker start sendprocolis-ux-test-20261028` pour rejouer la suite.
