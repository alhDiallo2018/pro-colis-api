# Authentification et securite

## Roles

Roles supportes :

- `client`
- `driver`
- `admin`
- `super_admin`

Statuts utilisateur :

- `active`
- `suspended`
- `deleted`

Statuts chauffeur :

- `available`
- `busy`
- `offline`

## Authentification

Le backend doit supporter :

- inscription par email, telephone, mot de passe, role.
- OTP envoye par email ou SMS selon l'identifiant.
- verification OTP.
- login par PIN.
- refresh token.
- changement de mot de passe.
- reinitialisation de mot de passe.
- verification email.

## JWT

Access token :

- courte duree, recommande `15m`.
- contient `sub`, `role`, `status`, `garageId`.

Refresh token :

- longue duree, recommande `30d`.
- stocke sous forme hashee en base dans `refresh_tokens`.
- revocable a la deconnexion, suppression compte ou suspension.

## PIN

- PIN toujours stocke hashe avec bcrypt/argon2.
- PIN jamais retourne dans les reponses.
- limiter les tentatives de login PIN.
- verrouillage temporaire apres trop d'echecs.

## OTP

- OTP stocke hashe.
- expiration par defaut : 10 minutes.
- maximum 5 tentatives.
- marquer `is_used=true` apres succes.
- rate limit par telephone/email/IP.

## RBAC

Regles minimales :

- `client` : ses colis, son profil, ses paiements, ses notifications, ses offres recues.
- `driver` : colis assignes, colis libres, offres envoyees, annonces, sa localisation, ses documents.
- `admin` : ressources liees a son `garage_id`.
- `super_admin` : acces global.

Les endpoints publics sont limites a :

- healthcheck.
- tracking public.
- liste publique des garages.
- recherche chauffeurs publique si necessaire.
- OTP/register/login.

## Securite HTTP

Middlewares recommandes :

- `helmet`.
- CORS configure avec les domaines autorises.
- pas de quota global par IP pour les rafraîchissements et le suivi mobile.
- rate limiting strict pour auth, OTP et upload.
- limite de body JSON, par exemple `10mb`; endpoints base64 media peuvent avoir une limite dediee.

## Donnees personnelles

Les champs suivants sont sensibles :

- telephone.
- email.
- adresse.
- pieces d'identite.
- localisation chauffeur.
- historique paiement.

Seuls les roles autorises doivent pouvoir les consulter.

## Audit obligatoire

Creer un audit log pour :

- creation, modification, suspension, suppression utilisateur.
- modification role.
- creation/modification/suppression garage.
- assignation chauffeur.
- changement statut colis.
- acceptation/rejet offre.
- validation paiement.
- changement configuration systeme.
- operations backup/restore.

