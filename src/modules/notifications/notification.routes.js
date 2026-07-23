import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as messagingController from './messaging.controller.js';
import * as notificationController from './notification.controller.js';

export const notificationRouter = Router();

notificationRouter.use(authenticate);
notificationRouter.get('/', notificationController.listNotifications);
notificationRouter.get('/unread-count', notificationController.unreadCount);
notificationRouter.post('/device-token', messagingController.registerDeviceToken);
notificationRouter.post('/sms/send', requireRoles('admin', 'super_admin'), messagingController.sendSmsMessage);
notificationRouter.post('/email/send', requireRoles('admin', 'super_admin'), messagingController.sendEmailMessage);
notificationRouter.post('/email/send-bulk', requireRoles('super_admin', 'support'), messagingController.sendBulkEmailMessage);
notificationRouter.patch('/:notificationId/read', notificationController.markAsRead);
notificationRouter.post('/read-all', notificationController.markAllAsRead);
notificationRouter.delete('/:notificationId', notificationController.deleteNotification);
notificationRouter.delete('/all', notificationController.deleteAllNotifications);

// Configuration Brevo — montee sous /admin/notifications (super admin uniquement).
export const adminNotificationRouter = Router();

adminNotificationRouter.use(authenticate, requireRoles('super_admin', 'support'));
adminNotificationRouter.get('/brevo-config', messagingController.getBrevoConfig);
adminNotificationRouter.put('/brevo-config', messagingController.updateBrevoConfig);
adminNotificationRouter.post('/brevo-test', messagingController.testBrevoConnection);
