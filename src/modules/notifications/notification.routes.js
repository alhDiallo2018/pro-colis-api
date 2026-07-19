import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import * as notificationController from './notification.controller.js';

export const notificationRouter = Router();

notificationRouter.use(authenticate);
notificationRouter.get('/', notificationController.listNotifications);
notificationRouter.get('/unread-count', notificationController.unreadCount);
notificationRouter.patch('/:notificationId/read', notificationController.markAsRead);
notificationRouter.post('/read-all', notificationController.markAllAsRead);
notificationRouter.delete('/:notificationId', notificationController.deleteNotification);
notificationRouter.delete('/all', notificationController.deleteAllNotifications);
