# Source maps frontend

Deposer ici les source maps par release, par exemple
`<APP_RELEASE>/assets/index.js.map`, en conservant l'arborescence obtenue apres
retrait de `FARO_SOURCEMAP_PREFIX` de l'URL minifiee.

Ces fichiers contiennent le code source du frontend : ils sont ignores par Git,
montes en lecture seule dans Alloy et ne doivent jamais etre servis par Caddy.
