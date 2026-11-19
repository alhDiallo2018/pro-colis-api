import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { requestIdMiddleware } from './middlewares/request-id.middleware.js';
import { httpLogger } from './middlewares/http-logger.middleware.js';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware.js';
import { mobileVersionMiddleware } from './middlewares/mobile-version.middleware.js';
import { metricsHandler, metricsMiddleware } from './observability/metrics.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { garageRouter } from './modules/garages/garage.routes.js';
import { notificationRouter, adminNotificationRouter } from './modules/notifications/notification.routes.js';
import { uploadRouter } from './modules/uploads/upload.routes.js';
import { mobileRouter } from './modules/mobile/mobile.routes.js';
import { supportRouter } from './modules/support/support.routes.js';
import { supportChatRouter } from './modules/support/chat.routes.js';
import { zoneRouter } from './modules/zones/zone.routes.js';
import { transitRouter } from './modules/trips/transit.routes.js';
import { shuttleRouter } from './modules/shuttle/shuttle.routes.js';
import { integrationsRouter } from './modules/integrations/integrations.routes.js';
import { observabilityRouter } from './modules/observability/observability.routes.js';
import { consolidationRouter } from './modules/consolidation/consolidation.routes.js';
import { fraudRouter } from './modules/fraud/fraud.routes.js';
import {
  adminReferenceRouter,
  publicReferenceRouter
} from './modules/admin/reference-data/reference-data.routes.js';

import { qualityRouter } from './modules/experience/quality.routes.js';
import { experienceRouter } from './modules/experience/experience.routes.js';
import { getManifest } from './modules/public.controller.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('trust proxy', 1);
app.use(requestIdMiddleware);
app.use(httpLogger);
app.use(metricsMiddleware);
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true
  })
);
// Les flux GPS et rafraîchissements mobiles ne partagent plus un quota par IP.
// Les routes sensibles (authentification, OTP et imports) gardent leur limite.
// Cette route n'est pas proxifiee par Caddy en production et exige en plus un
// bearer token distinct des jetons utilisateurs.
app.get('/internal/metrics', metricsHandler);
// `verify` capture le body brut : nécessaire pour vérifier les signatures
// HMAC des webhooks entrants (Shopify, et futurs partenaires) sans dépendre
// d'un parser spécifique par route.
app.use(express.json({
  limit: '25mb',
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
// Refuse les clients Android sous `MOBILE_ANDROID_MIN_VERSION_CODE` (défense en
// profondeur : la gate app reste la première ligne). Désactivé par défaut tant
// que la version obligatoire n'est pas effectivement disponible sur le store.
app.use(mobileVersionMiddleware);
// Uploaded media are public assets embedded by the web app (a different origin),
// so override Helmet's default same-origin CORP to allow cross-origin embedding.
app.use(
  '/uploads',
  (_req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.resolve(__dirname, '..', env.UPLOAD_LOCAL_DIR))
);

const apiV1 = express.Router();
apiV1.use('/health', healthRouter);
apiV1.use('/public/help-audio', (_req, res, next) => { res.set('Cross-Origin-Resource-Policy', 'cross-origin'); next(); }, express.static(path.resolve(__dirname, '../public/help-audio')));
apiV1.use('/auth', authRouter);
apiV1.use('/public/garages', garageRouter);
apiV1.use('/notifications', notificationRouter);
apiV1.use('/admin/notifications', adminNotificationRouter);
apiV1.use('/upload', uploadRouter);
apiV1.use('/super-admin/observability', observabilityRouter);
apiV1.use('/', zoneRouter);
apiV1.use('/', supportRouter);
apiV1.use('/support/chat', supportChatRouter);
apiV1.use('/experience', experienceRouter);
apiV1.use('/quality', qualityRouter);
apiV1.use('/transit', transitRouter);
apiV1.use('/shuttle-operator', shuttleRouter);
apiV1.use('/integrations', integrationsRouter);
apiV1.use('/drivers', consolidationRouter);
apiV1.use('/super-admin/fraud', fraudRouter);
apiV1.use('/admin/reference', adminReferenceRouter);
apiV1.use('/reference', publicReferenceRouter);
// Phase 6 : manifest PWA dynamique. Monté sous `/api/v1` pour que le
// `<link rel="manifest">` du HTML puisse pointer vers `/api/v1/manifest.webmanifest`
// (le fallback statique `public/manifest.webmanifest` reste en place si l'API
// est injoignable — rollback instantané via la config DNS).
apiV1.get('/manifest.webmanifest', getManifest);
apiV1.use('/', mobileRouter);

app.use('/api/v1', apiV1);

// Alias à la racine : certains navigateurs n'honorent pas un `scope` croisé
// avec le manifest. Servir `/manifest.webmanifest` aussi à la racine couvre le
// cas où le web est déployé derrière le même reverse proxy que l'API.
app.get('/manifest.webmanifest', getManifest);

// Temporary aliases keep the current Flutter client working while it migrates to /api/v1.
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/public/garages', garageRouter);
app.use('/notifications', notificationRouter);
app.use('/admin/notifications', adminNotificationRouter);
app.use('/upload', uploadRouter);
app.use('/', zoneRouter);
app.use('/', supportRouter);
app.use('/', mobileRouter);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export { app };
