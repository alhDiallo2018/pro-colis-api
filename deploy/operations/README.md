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
