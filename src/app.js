import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { requestIdMiddleware } from './middlewares/request-id.middleware.js';
import { httpLogger } from './middlewares/http-logger.middleware.js';
import { globalRateLimit } from './middlewares/rate-limit.middleware.js';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { garageRouter } from './modules/garages/garage.routes.js';
import { notificationRouter, adminNotificationRouter } from './modules/notifications/notification.routes.js';
import { uploadRouter } from './modules/uploads/upload.routes.js';
import { mobileRouter } from './modules/mobile/mobile.routes.js';
import { zoneRouter } from './modules/zones/zone.routes.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('trust proxy', 1);
app.use(requestIdMiddleware);
app.use(httpLogger);
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true
  })
);
app.use(globalRateLimit);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
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
apiV1.use('/auth', authRouter);
apiV1.use('/public/garages', garageRouter);
apiV1.use('/notifications', notificationRouter);
apiV1.use('/admin/notifications', adminNotificationRouter);
apiV1.use('/upload', uploadRouter);
apiV1.use('/', zoneRouter);
apiV1.use('/', mobileRouter);

app.use('/api/v1', apiV1);

// Temporary aliases keep the current Flutter client working while it migrates to /api/v1.
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/public/garages', garageRouter);
app.use('/notifications', notificationRouter);
app.use('/admin/notifications', adminNotificationRouter);
app.use('/upload', uploadRouter);
app.use('/', zoneRouter);
app.use('/', mobileRouter);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export { app };
