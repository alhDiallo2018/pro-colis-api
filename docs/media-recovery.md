# Recuperation des medias historiques

Un diagnostic HTTPS du 26 octobre 2026 a confirme une reponse 404 pour une
photo de profil referencee sous `/uploads/`. Les deux anciens services API
partagent la base, mais pas leur stockage :

- API publique : volume `sendprocolis-web_api-uploads` monte sur `/app/uploads` ;
- ancienne API arretee : dossier `/home/debian/procolis/SendProColis-Api/uploads`.

`deploy/operations/recover-upload-media.py` est une recuperation ponctuelle a
executer en administrateur, sans argument, apres verification de son SHA-256.
Il controle les deux montages et la configuration effective, lit uniquement
les references de medias en base puis copie les fichiers manquants de l'ancien
dossier vers le volume actif. Il ne modifie ni la base ni la configuration, ne
redemarre aucun service et ne supprime jamais la source.

Les fichiers existants, meme invalides, ne sont jamais remplaces. La copie
refuse les liens symboliques et les chemins arbitraires ; elle publie chaque
fichier de facon atomique apres verification de stabilite de la source.
Seules les URL locales `/uploads/` avec un nom UUID et une extension de media
admise sont eligibles. Les URL externes sont comptees separement.

Le rapport prive sous `/var/lib/procolis-deploy/media-recovery-*/` contient les
chemins concernes et les empreintes des fichiers recuperes, sans leur contenu.
La sortie publique presente des compteurs et un controle HTTPS par categorie.
Les fichiers `missing` sont absents des deux stockages controles : il faut alors
chercher une sauvegarde, pas annoncer une recuperation complete. Les resultats
`existing_invalid`, `source_invalid` et `unsafe_or_unreadable` doivent egalement
etre examines. La presence d'un fichier n'atteste pas son decodage ni la
compatibilite de son codec video sur chaque appareil.

Verification locale :

```sh
python3 -m unittest discover -s deploy/operations -p 'test_media_recovery.py'
```
