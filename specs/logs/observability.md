# Observabilite et consultation des erreurs

## Objectif

Fournir au super-administrateur une vue centralisee et securisee des erreurs de
production sans exposer Docker, Loki, Prometheus ou des fichiers de logs au
navigateur. Le frontend React consommera uniquement les endpoints documentes
dans cette specification et sera implemente separement.

Les journaux techniques ne doivent jamais etre stockes dans la table metier
`audit_logs`. Cette table reste reservee aux actions fonctionnelles et de
securite effectuees par les utilisateurs.

## Architecture cible

```text
API Node / PostgreSQL / Caddy --stdout/stderr--> Grafana Alloy --> Loki
React --Faro--> Caddy /collect/faro -----------> Grafana Alloy --> Loki

API Node --metriques--> Prometheus <--- exporters et probes de disponibilite

React super-admin --> API Node --> Loki + Prometheus
Grafana -----------------------> Loki + Prometheus
```

- Pino continue d'ecrire des lignes JSON sur `stdout`.
- Alloy collecte les journaux Docker de `api`, `postgres` et `caddy`.
- Le receiver Faro d'Alloy recoit les erreurs du navigateur React.
- Loki conserve les journaux interrogeables pendant 14 jours.
- Prometheus conserve les metriques pendant 14 jours.
- Prometheus et le ruler Loki transmettent leurs alertes a Alertmanager, qui
  envoie les emails via Brevo. Grafana fournit une interface de secours
  reservee aux operateurs via un tunnel SSH.
- Loki, Prometheus, Grafana et les exporters ne sont jamais publies sur
  Internet.

## Normalisation des journaux

Chaque entree expose au frontend suit cette structure :

```json
{
  "id": "opaque-cursor-safe-id",
  "timestamp": "2026-08-02T00:15:08.000Z",
  "severity": "error",
  "source": "api",
  "environment": "production",
  "message": "Unhandled API error",
  "requestId": "uuid-if-available",
  "route": "/api/v1/example",
  "method": "GET",
  "statusCode": 500,
  "durationMs": 42,
  "userId": "uuid-if-available",
  "error": {
    "name": "Error",
    "code": "INTERNAL_ERROR",
    "stack": "sanitized stack trace"
  },
  "context": {}
}
```

Les niveaux normalises sont `debug`, `info`, `notice`, `warning`, `error`,
`critical`, `alert` et `emergency`.

- Pino `trace/debug` devient `debug`, `warn` devient `warning` et `fatal`
  devient `critical`.
- PostgreSQL `WARNING`, `ERROR`, `FATAL` et `PANIC` deviennent respectivement
  `warning`, `error`, `critical` et `emergency`.
- Les labels Loki sont limites a `service`, `environment`, `severity` et
  `release` afin d'eviter une cardinalite excessive.
- `requestId`, `userId`, routes et messages restent des champs JSON et ne sont
  jamais des labels Loki.

## Protection des donnees

Les valeurs suivantes sont masquees avant emission et avant retour API :

- mots de passe, PIN et OTP ;
- JWT, refresh tokens et en-tetes d'autorisation ;
- cles Brevo, PayDunya et autres secrets ;
- cookies et identifiants de session ;
- emails, telephones, adresses, noms, plaques et coordonnees geographiques ;
- contenu de fichier, base64 et corps binaires ;
- parametres et valeurs SQL.

Les erreurs conservent leur type, code, message et stack trace nettoyee. Les
requêtes Prisma ne sont pas journalisees. Seuls les evenements Prisma `warn` et
`error` sont transmis a Pino sans parametres SQL.

Les recherches utilisateur ne sont jamais concatenees dans une expression
LogQL libre. L'API construit elle-meme les requetes a partir de filtres valides.

## API super-admin

Toutes les routes sont reservees exclusivement au role `super_admin`. Un role
`support`, `admin`, `driver` ou `client` recoit `403 FORBIDDEN`.

### Resume

```http
GET /api/v1/super-admin/observability/summary?from=<ISO>&to=<ISO>
```

Retourne les compteurs par niveau et source, l'heure de la derniere entree et
un resume de disponibilite. La periode par defaut est une heure et ne peut pas
depasser 14 jours.

### Liste des journaux

```http
GET /api/v1/super-admin/observability/logs
```

Parametres autorises :

| Parametre | Description |
| --- | --- |
| `source` | `api`, `postgres`, `caddy`, `frontend` ou `docker` |
| `levels` | liste separee par des virgules de niveaux normalises |
| `q` | recherche textuelle dans les champs JSON, 2 a 200 caracteres |
| `requestId` | identifiant exact de requete |
| `from`, `to` | dates ISO, maximum 14 jours |
| `limit` | 20 a 200, valeur par defaut 50 |
| `cursor` | curseur opaque retourne par la page precedente |

La pagination utilise l'horodatage et un curseur opaque, jamais un offset.

### Etat des services

```http
GET /api/v1/super-admin/observability/services
```

Retourne l'etat de `api`, `postgres`, `caddy`, `loki`, `alloy` et
`prometheus`, ainsi que la date de derniere verification.

### Export

```http
GET /api/v1/super-admin/observability/export?format=csv|jsonl&...
```

L'export accepte les memes filtres que la liste, avec une periode maximale de
24 heures et 10 000 entrees. Chaque export produit un `audit_log`. Aucun
endpoint de suppression ou de purge n'est expose.

### Reponses d'erreur

- `400 INVALID_OBSERVABILITY_QUERY` : filtres invalides ;
- `401 UNAUTHORIZED` : session absente ou invalide ;
- `403 FORBIDDEN` : role non autorise ;
- `429 TOO_MANY_REQUESTS` : limite de consultation ou export atteinte ;
- `503 OBSERVABILITY_UNAVAILABLE` : Loki ou Prometheus indisponible.

Les consultations sont limitees a 30 requetes par minute et les exports a deux
par minute et par utilisateur. Chaque appel amont est annule apres cinq
secondes.

## Metriques et alertes

L'API expose `/internal/metrics` uniquement sur le reseau Docker. Cette route
est protegee par un bearer token distinct des JWT utilisateurs.

Prometheus collecte :

- nombre et duree des requetes HTTP par route, methode et statut ;
- metriques processus Node ;
- disponibilite HTTP de l'API, Caddy, Loki et Alloy ;
- disponibilite et metriques essentielles PostgreSQL ;
- occupation disque du VPS.

Alertmanager envoie un email via le relais SMTP Brevo lorsqu'une des conditions
suivantes est satisfaite :

- API ou PostgreSQL indisponible pendant deux minutes ;
- entree `critical`, `alert` ou `emergency` ;
- au moins cinq erreurs backend en cinq minutes ;
- taux HTTP 5xx superieur a 5 % avec au moins dix requetes ;
- occupation disque superieure a 85 % pendant dix minutes.

Une panne totale du VPS ne peut pas etre signalee par cette stack locale. Un
moniteur d'uptime externe constitue une evolution separee.

## Contrat pour l'interface React

La page super-admin « Observabilite » doit afficher :

- cartes de synthese : evenements, erreurs critiques, source la plus touchee et
  derniere erreur ;
- filtres de periode, source, niveau, texte et `requestId` ;
- onglets de severite avec compteurs ;
- lignes depliees avec contexte et stack trace monospace ;
- actualisation manuelle et automatique toutes les 30 secondes lorsque la page
  est visible ;
- export CSV et JSONL ;
- etats chargement, vide, erreur et observabilite indisponible.

Il n'existe ni selecteur de fichier `.log`, ni bouton « vider le fichier » :
Loki gere des flux et la retention est automatique.

## Deploiement

- Affecter des limites memoire adaptees a un VPS d'au moins 4 Go de RAM.
- Rattacher l'API, PostgreSQL, Caddy et la stack d'observabilite au reseau
  Docker prive `procolis-observability-shared` (ou au nom configure).
- Configurer une rotation Docker de trois fichiers de 20 Mo par conteneur.
- Activer le compactor Loki avec une retention de `336h`.
- Conserver les volumes Loki et Prometheus et les inclure dans une sauvegarde
  chiffree quotidienne hors VPS, retenue 14 jours.
- Deployer d'abord la stack de collecte, puis le backend, puis Faro et
  l'interface React.
- Laisser les alertes en observation pendant 24 heures avant l'envoi reel.

## Verification et criteres d'acceptation

- Une erreur de chaque source apparait dans l'API en moins de dix secondes.
- Une recherche sur 24 heures repond en moins de deux secondes en charge
  normale.
- Aucun secret connu n'est present dans Loki, les exports ou les reponses API.
- Les limites de periode, taille, pagination et timeout sont appliquees.
- Seul `super_admin` peut consulter ou exporter les journaux.
- La coupure de Loki ou Prometheus retourne un `503` propre et journalise.
- Une alerte synthetique critique produit bien un email.
- Les tests backend couvrent validation, RBAC, normalisation, redaction,
  pagination, export et indisponibilite amont.

## Regles d'implementation

- Les sections complexes, notamment la construction LogQL, la pagination par
  curseur et la normalisation multi-source, doivent etre commentees.
- Chaque controleur critique ou effectuant des appels Loki, Prometheus ou base
  de donnees doit utiliser un `try/catch`, avec contexte minimal et logging
  Pino propre avant de retourner une erreur publique generique.
