import { MESSAGE_ROLES } from './recipient-scope.js';
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as messagingController from './messaging.controller.js';
import * as notificationController from './notification.controller.js';

export const notificationRouter = Router();

notificationRouter.use(authenticate);
notificationRouter.get('/', notificationController.listNotifications);
notificationRouter.get('/unread-count', notificationController.unreadCount);
notificationRouter.get('/preferences', notificationController.getPreferences);
notificationRouter.put('/preferences', notificationController.updatePreferences);
notificationRouter.post('/device-token', messagingController.registerDeviceToken);
notificationRouter.post('/sms/send', requireRoles('admin', 'super_admin'), messagingController.sendSmsMessage);
notificationRouter.post('/email/send', requireRoles('admin', 'super_admin'), messagingController.sendEmailMessage);
notificationRouter.post('/email/send-bulk', requireRoles('super_admin', 'support'), messagingController.sendBulkEmailMessage);
notificationRouter.patch('/:notificationId/read', notificationController.markAsRead);
notificationRouter.post('/read-all', notificationController.markAllAsRead);
// `/all` doit précéder `/:notificationId` : sinon Express capte le mot « all »
// comme identifiant et la purge répond 404.
notificationRouter.delete('/all', notificationController.deleteAllNotifications);
notificationRouter.delete('/:notificationId', notificationController.deleteNotification);

// Configuration Brevo — montee sous /admin/notifications (super admin uniquement).
export const adminNotificationRouter = Router();

adminNotificationRouter.use(authenticate);
const configRoles = requireRoles('super_admin', 'support');
const senderRoles = requireRoles(...MESSAGE_ROLES);
// Autoriser les agents a contacter les utilisateurs ne leur donne pas acces
// aux secrets et aux reglages du fournisseur de messagerie.
adminNotificationRouter.get('/brevo-config', configRoles, messagingController.getBrevoConfig);
adminNotificationRouter.put('/brevo-config', configRoles, messagingController.updateBrevoConfig);
adminNotificationRouter.post('/brevo-test', configRoles, messagingController.testBrevoConnection);
adminNotificationRouter.get('/recipients', senderRoles, messagingController.listMessageRecipients);
adminNotificationRouter.post('/messages', senderRoles, messagingController.sendManualMessage);
adminNotificationRouter.get('/messages/:requestId', senderRoles, messagingController.manualMessageResult);
