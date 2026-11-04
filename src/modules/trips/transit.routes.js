/**
 * Catalogue public des lignes de bus (DDD / AFTU).
 * Lecture seule : les lignes sont alimentées par `seed-transit.js`.
 *
 * Monté explicitement sous `/transit` depuis `app.js` pour que les routes
 * restent visibles côté revue de code (elles étaient historiquement mêlées
 * à `mobile.routes.js`, ce qui rendait les 404 difficiles à diagnostiquer).
 */
import { Router } from 'express';
import * as transit from './transit.controller.js';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';

export const transitRouter = Router();

// Catalogue public : GET /transit/lines[?operator=ddd|aftu]
transitRouter.get('/lines', optionalAuthenticate, transit.listTransitLines);
// Recherche d'arrêts (zones préfixées `transit-stop:`).
transitRouter.get('/stops/search', optionalAuthenticate, transit.searchTransitStops);
// Détail d'une ligne + ses arrêts.
transitRouter.get('/lines/:lineId', optionalAuthenticate, transit.getTransitLine);
// Voyages actifs (Advertisement + GPS live) sur une ligne donnée.
transitRouter.get('/lines/:lineId/live', optionalAuthenticate, transit.listTransitLineLive);
// Pré-remplissage d'un brouillon d'Advertisement depuis une ligne (chauffeur).
transitRouter.get('/lines/:lineId/draft', authenticate, requireRoles('driver'), transit.draftFromTransitLine);
