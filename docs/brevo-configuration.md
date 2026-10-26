# Configuration Brevo : serveur et espace administrateur

Les deux sources sont prises en charge, champ par champ : une valeur non vide
stockee dans `SystemConfig`, cle `brevo`, est prioritaire ; sinon la valeur de
l'environnement est utilisee. Les noms d'expediteurs ont des valeurs par defaut.

```dotenv
BREVO_API_KEY=cle-api-brevo
BREVO_SENDER_EMAIL=adresse-expediteur-validee
BREVO_SENDER_NAME=SENDPROCOLIS
BREVO_SMS_SENDER=ProColis
```

Sur le VPS, les variables doivent figurer dans l'environnement effectif du
conteneur API. Le complement `/etc/procolis/deployment-runtime.json` est utilise
par le deploiement actuel ; modifier seulement le `.env` du depot API ne suffit
pas. Les changements d'environnement exigent de recreer le conteneur.

Dans le web : `/admin/notifications-brevo`, charger la configuration puis
renseigner « Nouvelle cle API Brevo » et les expediteurs. La cle saisie est
stockee en base par l'API ; aucune recreation de conteneur n'est necessaire.
Une saisie vide conserve la cle actuelle. Le bouton « Utiliser la cle du
serveur », suivi d'« Enregistrer », retire explicitement la surcharge en base.
Ce choix est desactive et refuse par l'API si aucune cle serveur ne peut
remplacer la cle en base. Sans cle existante, le formulaire exige une nouvelle
saisie avant la sauvegarde et laisse le test d'envoi desactive.
Si aucune source ne fournit de cle, les envois restent indisponibles.

L'API GET/PUT de configuration renvoie la presence et la source de la cle,
ainsi qu'un masque de compatibilite, jamais le secret. Un masque renvoye par un
ancien client ne remplace pas une vraie cle. Les modifications sont auditees
par noms de champs sans leurs valeurs. Les droits de configuration existants
(super_admin/support) sont conserves.

Le chargement initial et les invalidations du cache sont attendus avant les
decisions d'envoi de recuperation du PIN et le test Brevo. Une ancienne lecture
en cours ne peut pas retablir une configuration remplacee par l'administrateur.
Le parcours PIN attend l'acceptation par au moins un canal avant de confirmer
l'envoi ; une acceptation par Brevo ne garantit pas la livraison finale.

Le bouton « Tester » envoie un vrai email a l'adresse saisie. Il reste a
verifier la cle, l'expediteur autorise et la reception avec le compte Brevo reel.
