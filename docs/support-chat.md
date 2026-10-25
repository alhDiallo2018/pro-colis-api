# Conversations support partagées

Les rôles `support`, `support_technique` et `support_commercial` utilisent la même boîte. Le super administrateur peut également y participer en activant sa disponibilité. Un agent peut rechercher n'importe quel utilisateur et démarrer un échange. Les envois email/SMS/notification à plusieurs destinataires restent accessibles dans « Envoyer un message » sur le web.

Chaque utilisateur possède un fil durable : l'identifiant et l'historique restent identiques après une clôture ou un changement d'agent. Les messages conservent le nom de leur auteur. Seul l'agent affecté peut répondre côté support ; les autres agents peuvent consulter le fil sans acquitter les messages à sa place.

## Présence et affectation

- Web et mobile renouvellent une présence par onglet/appareil toutes les 20 secondes.
- Un onglet masqué, une app en arrière-plan ou le choix « indisponible » libère cette présence. L'agent reste disponible si un autre appareil possède une présence valide.
- Le logout révoque la présence de sa famille de session ; une déconnexion de tous les appareils les libère toutes.
- Une coupure brutale expire après `SUPPORT_PRESENCE_TTL_SECONDS` (90 secondes par défaut, de 30 à 300). Le worker vérifie toutes les 15 secondes : la reprise survient donc au plus tard environ 105 secondes après le dernier signal, hors panne serveur.
- Une demande est affectée à l'agent disponible le moins chargé, en privilégiant la spécialité demandée. Sans agent, elle reste en attente et accepte les messages.
- Un verrou transactionnel PostgreSQL commun aux instances sérialise les prises en charge et réponses. Un ancien agent reçoit un conflit HTTP 409 s'il tente de répondre après transfert. Les affectations et clôtures sont auditées.

## Mise en service

1. Déployer l'API et appliquer `prisma migrate deploy`, dont `20261025190000_support_handover`.
2. Déployer le web et publier la nouvelle version mobile pour disposer de la boîte partagée et des signaux de présence.
3. Connecter les agents et vérifier leur disponibilité. L'API seule ne peut pas deviner qu'un ancien client support est disponible.

La migration copie les anciens échanges directs de support avec leurs auteurs et médias, sans supprimer les messages d'origine. Les anciens clients utilisateurs envoyant vers un compte support, ou l'identifiant support par défaut des anciennes APK, sont redirigés vers leur fil partagé. Les conversations liées à un colis conservent leur fonctionnement.

Les notifications applicatives sont créées pour les nouvelles affectations et les messages. Leur transmission push utilise la configuration Firebase existante ; email et SMS utilisent la configuration de messagerie existante.

## API

Toutes les routes sont sous `/api/v1/support/chat` et nécessitent une session authentifiée.

- `POST /presence` : agent uniquement, `{connectionId, available}`.
- `GET /users?search=...` : recherche de destinataires réservée aux agents.
- `GET /agents` : agents actuellement disponibles et nombre de dossiers ouverts, sans données de session.
- `GET /mine` : historique du demandeur, sans réouverture.
- `POST /conversations` : ouvrir/réouvrir son fil ; un agent peut préciser `userId`. `department` vaut `general`, `technique` ou `commercial`.
- `GET /conversations` : boîte partagée réservée aux agents (200 conversations les plus récentes).
- `GET /conversations/:id` : fil et affectation, accessible au demandeur ou aux agents.
- `POST /conversations/:id/messages` : texte (5 000 caractères maximum), photo, vidéo ou audio.
- `POST /conversations/:id/claim` et `/close` : prise en charge et clôture.
- `POST /conversations/:id/transfer` : `{agentId, expectedAssignedToId}` ; le second champ est nullable pour un dossier libre et obligatoire pour refuser un transfert basé sur une affectation périmée.

## Recherche, sélection et envois ciblés depuis le web

Les pages Utilisateurs et Chauffeurs proposent une recherche serveur par nom,
e-mail et téléphone, puis une sélection individuelle ou de la page affichée.
La sélection est conservée pendant la pagination et les changements de recherche,
avec un maximum de 50 destinataires par formulaire. « Sélectionner cette page »
ne sélectionne jamais implicitement toute la base.

Les actions « Envoyer un message » et « Renvoyer leurs données » ouvrent le même
formulaire avec les comptes sélectionnés. Un accès « Envoyer un message » existe
aussi dans les espaces super admin, support et admin de zone. Le répertoire du
formulaire permet de filtrer par profil et de choisir plusieurs destinataires.

Canaux : email, SMS, notification dans l'application et chat privé. La diffusion
chat crée un message dans le fil support privé de chaque destinataire, et non un
salon commun où les destinataires verraient les données des autres. L'affectation
support reste gérée par le mécanisme de disponibilité/réaffectation existant.
Un agent déjà disponible et affecté n'est pas remplacé par l'auteur de la diffusion.

Le mode `account_summary` produit côté serveur une fiche différente pour chaque
compte : nom, e-mail, téléphone, profil, ville et statut. Aucun PIN, mot de passe,
jeton ou document d'identité n'est inclus. Ce mode ne réinitialise aucun accès.

- `GET /api/v1/admin/notifications/recipients` : `search`, `role`, `page`, `limit`
  (maximum 50), comptes non supprimés et projection sans secrets.
- `POST /api/v1/admin/notifications/messages` : canal `chat` supplémentaire et
  `kind: message | account_summary` (défaut `message`). Une référence UUID unique
  par destinataire/canal empêche les doublons. En mode fiche, `content` peut être vide.
- Les trois rôles support et le super admin peuvent contacter tous les comptes
  non supprimés. Un `admin` de zone ne peut rechercher/contacter que les clients
  et chauffeurs rattachés à son `garageId`. Sans rattachement, aucun destinataire
  n'est accessible. Cette restriction est contrôlée à nouveau lors de l'envoi.

Les résultats distinguent l'acceptation par le fournisseur, les comptes ignorés
et les réponses incertaines. Un email/SMS accepté n'est pas une preuve de livraison.
Les messages et reçus chat sont créés dans la même transaction ; une requête rejouée
ne crée pas de second message. Les erreurs des contrôleurs sont normalisées et
journalisées sans enregistrer le texte de la fiche ou du message.

### Validation et mise en production

Les tests utilisent exclusivement `procolis_test` et des transporteurs simulés
pour les emails/SMS. Le parcours web a aussi été vérifié dans Chrome avec des
comptes fictifs, sans envoi externe. Ces ajouts restent locaux tant que le web et
l'API ne sont pas déployés ensemble. Les migrations préexistantes
`20261025180000_manual_notifications` et `20261025190000_support_handover` sont
requises, ainsi que leur dépendance `20261025160000_session_families` ; cette
extension ne crée pas de nouvelle migration. Les prochains déploiements doivent
conserver le routage Caddy vers `sendprocolis-api:8080`.


## Affectation manuelle et passage de relais

Dans la boîte support web, l'agent affecté et le super administrateur disposent
d'un sélecteur « Affecter à un support disponible », avec la charge actuelle de
chaque agent. Le bouton « Transférer l’assistance » conserve le fil, tous les
messages et leur auteur, notifie le nouvel agent et journalise le changement.
Pour un dossier non affecté, un support peut également choisir un collègue.

Un support tiers ne peut pas retirer un dossier à un collègue encore affecté ;
le super administrateur peut le réaffecter. La cible doit être disponible, avec
une session valide, et ne peut pas être le demandeur. Un dossier clôturé doit
être repris avant transfert. Après réaffectation, l'ancien agent conserve la
lecture de l'historique mais le serveur refuse toute réponse tardive (HTTP 409).

Le contrôle d'affectation et l'écriture se font sous le verrou PostgreSQL commun.
Une précondition sur l'agent précédemment affiché empêche deux transferts
concurrents de s'écraser. Le web recharge le dossier après succès ou conflit.
La prise manuelle d'un dossier libre se fait avant la répartition automatique,
pour que celle-ci n'annule pas l'action en attribuant le dossier à quelqu'un
d'autre au sein de la même requête. Les autres dossiers continuent d'être répartis.

Ces ajouts sont locaux et nécessitent le déploiement conjoint du web et de l'API.
Aucune nouvelle migration n'est nécessaire au-delà de celles du support partagé.
