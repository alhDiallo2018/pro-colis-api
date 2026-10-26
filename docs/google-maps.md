# Recherche mondiale et choix sur carte

La recherche des clients React et Flutter utilise `GET /api/v1/public/places/autocomplete`,
`/details` et `/reverse`. L'API lit `GOOGLE_MAPS_API_KEY` et appelle Places API (New)
et Geocoding API. Les suggestions ne sont limitées ni à un pays, ni à une liste de villes,
ni aux zones déjà enregistrées. Un jeton lie les suggestions aux détails de la session.
Les routes restent publiques pour les formulaires d'inscription, avec 60 appels/minute/IP
et un délai maximal de 8 secondes chez Google. Les erreurs fournisseur ne divulguent pas la clé.

Le rendu de la carte utilise une configuration distincte :

- React : `VITE_GOOGLE_MAPS_API_KEY`, au build. Le Dockerfile et Compose la transmettent.
  Compose accepte `GOOGLE_MAPS_API_KEY` comme repli si la variable Vite est absente.
- Android : `GOOGLE_MAPS_API_KEY` exportée pour Gradle, ou `googleMapsApiKey` dans
  `android/local.properties`. `tool/build_android_release.sh` charge aussi `.env`.
- iOS : `GOOGLE_MAPS_API_KEY = ...` dans `ios/Flutter/Maps.local.xcconfig`, inclus par
  Debug/Release et ignoré par Git. Le mécanisme Info.plist/AppDelegate existant lit cette valeur.

Activer Maps JavaScript API pour le web et les SDK Maps correspondants pour Android/iOS.
Les restrictions de chaque clé doivent convenir à son usage (serveur, origines web,
application Android ou iOS). Les clés ne figurent jamais dans les fichiers versionnés.

`POST /zones/resolve` accepte `exactPoint: true` pour un point manuel/GPS. L'identité
est construite à partir des coordonnées à sept décimales : le `placeId` du géocodage
inverse peut couvrir une rue entière et ne sert donc pas à remplacer ce point. Une
suggestion Places conserve son propre lieu ; elle n'est plus ramenée au centre d'une
zone couvrante. Les anciens clients sans `placeId` ni `exactPoint` conservent la détection
par proximité. Les nouvelles zones restent en attente de validation selon le flux existant.
Aucune migration de base n'est nécessaire.

Déployer l'API avant les nouveaux clients ; reconstruire le web et les applications
natives pour intégrer les configurations de carte. Vérifications : recherche hors Sénégal,
sélection d'une suggestion, clic/toucher et déplacement du repère, conservation des
coordonnées, saisies rapides, erreur fournisseur et refus de géolocalisation.
