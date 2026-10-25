# Acces operateur VPS ProColis

La cle SSH dediee et le compte `procolis-ops` servent aux interventions depuis
le poste operateur. L'outil `procolis-ops` installe dans `/usr/local/sbin` fournit
cinq diagnostics fixes via sudo, sans joker ni arguments supplementaires :

- `status` : etat des quatre conteneurs ProColis connus, images et labels Compose.
- `routing` : reseaux, alias et resolution de `api` depuis le conteneur Caddy.
- `health` : appel de `/health` sur `api:8080` depuis Caddy.
- `logs` : 120 dernieres lignes sur 15 minutes pour les deux API ; ces logs
  restent des donnees privees accessibles au compte operateur.
- `deployment-info` : revision Git des deux projets et configuration filtree
  des services (image, contexte de build, reseaux, volumes et privileges).
  Compare aussi la configuration effective des deux API : presence et egalite
  des secrets JWT, URL de base et delais de session, sans afficher leurs valeurs
  ni leurs empreintes. Les empreintes HMAC temporaires restent internes au diagnostic sur le VPS.

Le script utilise un interpreteur Python isole, des executables et des cibles
fixes, un environnement minimal et le dossier courant `/`. Il ne lance aucun
shell a partir des arguments SSH. Les erreurs sont journalisees sans recopier
les sorties de configuration susceptibles de contenir des secrets. Sudo assure
la trace des commandes accordees ou refusees.

## Installation initiale

L'installateur embarque le code et la regle sudoers. Avant de l'executer en root,
le copier dans `/root` et verifier son SHA-256 avec la valeur calculee localement
et transmise par un canal de confiance. Ne pas executer directement en root un
script encore modifiable par le compte `procolis-ops`.

L'installation refuse de remplacer un outil ou une regle existants. Les deux
fichiers finaux appartiennent a root. Le fragment sudoers est valide avant son
activation ; une erreur de validation globale retire les fichiers installes.
Aucun conteneur n'est arrete ou redemarre. Aucun droit de deploiement n'est encore
accorde : il depend de l'identification de l'API reellement servie par Caddy.

Exemple apres installation :

```sh
ssh procolis-prod 'sudo -n /usr/local/sbin/procolis-ops routing'
```

Pour revoquer ces privileges, depuis le compte administrateur :

```sh
sudo rm /etc/sudoers.d/procolis-ops
sudo visudo -c
```

## Verification locale

```sh
python3 -m unittest discover -s deploy/operations -p 'test_*.py'
bash -n deploy/operations/install-procolis-ops.sh
```

Apres une modification de l'outil ou des regles, regenerer l'installateur
embarque avant distribution. Il est reserve a ce VPS et a ses chemins connus.

## Verification ponctuelle de l'identite PostgreSQL

`check-database-identity.py` ouvre deux connexions simultanees depuis les deux
conteneurs API, avec leur configuration effective et leurs propres reseaux.
Chaque transaction est en lecture seule. Elle lit les metadonnees serveur/base
et positionne un marqueur aleatoire uniquement dans le parametre de session
`application_name`. Aucun contenu de table metier n'est consulte ou modifie.

La visibilite reciproque de ces marqueurs dans `pg_stat_activity` prouve que les
connexions partagent la meme instance active ; nom et OID identifient ensuite
la base. L'identifiant de cluster, lorsqu'il est accessible, distingue aussi
les clusters independants. Un replica ou un clone partageant un identifiant
n'est pas declare comme la meme instance physique sur ce seul critere.
Une preuve insuffisante produit `null`, pas une affirmation de similitude.
Les identifiants de connexion ne quittent pas les conteneurs.

Il s'agit d'un diagnostic ponctuel, sans nouvelle regle sudoers. Depuis le
compte administrateur, copier le script dans `/root`, verifier son SHA-256 par
rapport a la copie locale revue, puis executer cette copie root. Le resultat
contient uniquement des metadonnees et les conclusions de comparaison.

## Fixer l'API de reference

`pin-reference-api-live.py` est le correctif ponctuel utilise le 25 octobre 2026 :
remplacement atomique et protege par ETag des deux upstreams ambigus. Il refuse
une topologie inattendue et conserve une sauvegarde privee. Il a deja ete execute
en production ; ne pas le relancer comme un outil de deploiement general.

`persist-reference-api.py` doit etre copie dans `/root`, verifie par SHA-256 et
execute avec sudo depuis la session administrateur. Il ne confere aucun droit
sudo supplementaire au compte ops. Il conserve les changements preexistants du
Caddyfile source et ne deploie pas les autres changements du depot web. La couche
Docker creee reprend les fichiers de l'image actuellement en service, avec le
seul Caddyfile corrige. La validation refuse une divergence entre le fichier de
demarrage corrige et la configuration active.

Apres execution, verifier le message SUCCESS et les diagnostics de routage.
La sauvegarde `/root/procolis-reference-*` conserve les fichiers avant modification
et `images.json` avec l'ancien identifiant d'image ; aucun nettoyage automatique
des images n'est effectue. Les futures images web doivent conserver ce routage.

Le controle de persistance tient compte du chemin temporaire ajoute automatiquement
par Caddy dans `file_server.hide` : seule cette entree exacte est ramenee au chemin
final avant comparaison stricte. Les autres differences restent bloquantes.
Reference : https://caddyserver.com/docs/caddyfile/directives/file_server


## Autorisation minimale de deploiement — livraison du 25 octobre 2026

`install-procolis-deploy.sh` ajoute uniquement la commande sans argument
`sudo -n /usr/local/sbin/procolis-deploy` au compte existant `procolis-ops`.
Il n'ajoute ni groupe Docker, ni shell root, ni commande Git/Docker/sudo generique.
Les droits de diagnostic existants restent inchanges. L'installation ne lance
aucune migration ni aucun deploiement.

Le helper appartient a root (0555), la regle sudoers a root (0440). Python
fonctionne en mode isole ; l'environnement, les chemins et les commits sont
fixes. La regle contient `""` pour refuser tout argument, ainsi que `NOSETENV`.
Le programme refuse lui-meme les arguments et une execution hors root.

Seules ces revisions sont autorisees :
- API : `5779764acc6ec8f69e3c297fb97954ce2eb694f8` ;
- web : `1a88896599f7c90717a142aad8944282216648a2`.

Une nouvelle livraison exige une mise a jour revue par l'administrateur.
Les depots restent sous `/home/debian` en mode 0700 ; ops n'en obtient aucun
acces en ecriture. Les fichiers de build sont controles (proprietaire, droits,
absence de liens). Git s'execute sous debian, sans hooks. Les modifications
locales des fichiers Compose/Caddy sont conservees dans un stash, appliquees
apres fast-forward et jamais supprimees automatiquement. D'autres modifications
locales ou un conflit interrompent la procedure avant la migration.

La topologie Docker est controlee : services et volumes ProColis uniquement,
pas de bind mount, de socket Docker, de mode privilegie ni de port API publie.
Le programme ne lance aucune commande Compose `down`, aucun nettoyage global
ni aucune restauration automatique. Il sauvegarde les configurations, anciennes
images et la base effective avant migration, attend l'API puis deploie Caddy et
verifie HTTPS ainsi que le client Google public.

La configuration effective de l'ancienne API est conservee dans
`/etc/procolis/deployment-runtime.json` (root uniquement), avec activation du
client Google autorise. Cela evite de perdre les secrets auparavant contenus
dans le `.env` de l'image. Les dollars sont echappes pour Compose. Apres succes,
`COMPOSE_FILE` dans le `.env` web reference ce complement pour les futurs appels
Compose standards via sudo. Les autres fichiers `.env` restent prives.

Les journaux et dumps sont sous `/var/lib/procolis-deploy/release-*`, accessibles
uniquement a root. La commande n'expose ni configuration complete ni erreurs de
build brutes au compte ops. Un verrou empeche deux executions simultanees ; un
marqueur de succes empeche de rejouer cette livraison deja terminee.

**Limite de securite :** deployer inclut l'execution du code applicatif et des
migrations avec les acces existants aux donnees et secrets ProColis. Cette
restriction limite les commandes sur le VPS ; elle ne transforme pas un
deploiement en operation en lecture seule. Debian et root restent les comptes
administrateurs de confiance. Aucun test de deploiement reel n'a encore ete
execute avec ce helper ; les tests locaux couvrent ses gardes et le packaging.

### Installation depuis la session administrateur

Copier l'installateur recu dans `/root`, puis verifier son SHA-256 contre la
valeur calculee sur la copie locale revue, avant execution. Ne jamais executer
en root directement la copie encore modifiable sous `/home/procolis-ops`.
L'installateur refuse d'ecraser une installation existante ; il valide la regle
avec `visudo` et retire ses nouveaux fichiers si la validation globale echoue.

Verification locale :

```sh
python3 -m unittest discover -s deploy/operations -p 'test_*.py'
bash -n deploy/operations/install-procolis-deploy.sh
visudo -cf deploy/operations/procolis-deploy.sudoers
```

Revocation depuis le compte administrateur :

```sh
sudo rm /etc/sudoers.d/procolis-deploy
sudo visudo -c
```

Cela retire le droit de lancer un nouveau deploiement ; une execution deja en
cours doit etre arretee separement par l'administrateur si necessaire.
