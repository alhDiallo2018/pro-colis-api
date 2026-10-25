# Connexion Google Android

## Activation

Déployer la migration additive `20261025200000_google_auth`, puis configurer
`GOOGLE_WEB_CLIENT_ID` avec le client OAuth **Web** du projet Google
`sendprocolis`. Une valeur vide désactive la connexion Google ; les routes
PIN/email/téléphone restent utilisables. Redémarrer l'API après changement.

Le mobile lit ce client public via `GET /api/v1/auth/google/config` et initialise
`google_sign_in` avec `serverClientId`. Ne pas fournir de secret OAuth au mobile.
Enregistrer aussi le client Android `com.sendprocolis.app` et les SHA-1 des clés
de signature utilisées. Google Play App Signing a sa propre empreinte.
La première version active Google uniquement sur Android.

Pour l'inscription, Brevo doit permettre l'envoi de SMS. Le nouveau parcours
attend la réponse du fournisseur et renvoie 503 en cas d'échec. Aucun OTP
n'est retourné dans la réponse HTTP, même en local. Les tests automatisés
simulent Google et la livraison SMS, pas la base de données.

## Contrat API

Toutes les réponses conservent l'enveloppe habituelle `success/message`.
Les routes sont publiques et les POST soumis à la limitation d'authentification.

| Route | Entrée | Résultat |
| --- | --- | --- |
| `GET /auth/google/config` | — | `enabled`, `serverClientId` (public) |
| `POST /auth/google` | `idToken` | `authenticated` avec user/accessToken/refreshToken, ou `link_required` / `profile_required` avec challengeToken/email/fullName/expiresAt |
| `POST /auth/google/link` | `challengeToken`, `identifier`, `pin` | Session après preuve du PIN existant |
| `POST /auth/google/phone-otp` | `challengeToken`, `phone` international | `sent`, `retryAfterSeconds: 60` |
| `POST /auth/google/register` | `challengeToken`, `phone`, `otpCode`, `fullName`, `pin`, `role`, `acceptedTerms: true` | Session ou `link_required` si un compte existe déjà |

Le rôle d'inscription est limité à `client` et `driver`. Le PIN et le SMS sont
six chiffres. Le nom et le rôle choisis ne modifient jamais un compte existant.
L'adresse email et le sujet Google proviennent uniquement du jeton vérifié.
Une égalité d'email n'associe jamais automatiquement un compte.

## Durée de vie et concurrence

Les challenges durent dix minutes, sont stockés sous forme de SHA-256 et sont
à usage unique. Les OTP et PIN sont hachés. Cinq mauvaises preuves rendent le
challenge inutilisable ; un nouvel envoi attend au moins soixante secondes et
n'efface pas le compteur. Le code est lié au challenge et au téléphone.

Un verrou PostgreSQL sérialise les opérations sur un challenge. Les erreurs
de preuve sont levées après commit de leur compteur. Création du compte,
score, audit, association et ouverture de session sont transactionnels.
Une erreur ne laisse pas une association sans session, ni un challenge consommé
sans compte. Les challenges expirés depuis plus de 24 heures sont nettoyés
lors d'un nouveau parcours Google.

Le serveur vérifie signature, audience, émetteur et expiration avec
`google-auth-library`. Il utilise `sub`, pas l'email, comme identité Google.
Les comptes suspendus ou supprimés sont refusés. Les journaux masquent
idToken/challengeToken/OTP/PIN ; l'API conserve requestId/action/type/code d'erreur.

## Vérification

`tests/google-auth.test.js` couvre la vérification cryptographique réelle avec
des certificats locaux, les parcours avec Google/SMS simulés, les transactions
PostgreSQL, le rejeu concurrent, les doublons, les limites et les sessions.
Exécuter avec DATABASE_URL pointant vers le serveur de test accessible ;
`tests/env.setup.js` force le nom de base `procolis_test`.

La validation réelle nécessite un client OAuth configuré, un compte Google
sur Android/Google Play Services et un numéro capable de recevoir les SMS.
Ne pas déclarer ce test réel réussi sur la seule base des simulations.

Sources : [vérification serveur Google](https://developers.google.com/identity/sign-in/android/backend-auth),
[intégration Android](https://pub.dev/packages/google_sign_in_android).
