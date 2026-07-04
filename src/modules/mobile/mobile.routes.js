import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as mobileController from './mobile.controller.js';

export const mobileRouter = Router();

mobileRouter.get('/users/stats', authenticate, mobileController.userStats);
mobileRouter.put('/users/pin', authenticate, mobileController.updatePin);

mobileRouter.put('/client/profile', authenticate, requireRoles('client'), mobileController.updateProfile);
mobileRouter.get('/client/parcels/my-parcels', authenticate, requireRoles('client'), mobileController.clientParcels);
mobileRouter.post('/client/parcels/create', authenticate, requireRoles('client'), mobileController.createParcel);
mobileRouter.get('/client/parcels/:parcelId', authenticate, requireRoles('client'), mobileController.getParcelDetail);
mobileRouter.get('/client/parcels/:parcelId/delivery-code', authenticate, requireRoles('client'), mobileController.clientDeliveryCode);
mobileRouter.post('/client/parcels/:parcelId/cancel', authenticate, requireRoles('client'), mobileController.cancelParcel);
mobileRouter.post('/client/parcels/:parcelId/bids/:bidId/accept', authenticate, requireRoles('client'), mobileController.acceptBid);
mobileRouter.post('/client/parcels/:parcelId/bids/:bidId/reject', authenticate, requireRoles('client'), mobileController.rejectBid);
mobileRouter.get('/client/bids/stats', authenticate, requireRoles('client'), mobileController.clientBidStats);
mobileRouter.get('/client/bids/received', authenticate, requireRoles('client'), mobileController.clientBidsReceived);
mobileRouter.post('/client/bids/:bidId/negotiate', authenticate, requireRoles('client'), mobileController.negotiateBid);

mobileRouter.put('/driver/profile', authenticate, requireRoles('driver'), mobileController.updateProfile);
mobileRouter.get('/driver/stats', authenticate, requireRoles('driver'), mobileController.driverStats);
mobileRouter.get('/driver/parcels', authenticate, requireRoles('driver'), mobileController.driverParcels);
mobileRouter.post('/driver/parcels/create', authenticate, requireRoles('driver'), mobileController.createParcel);
mobileRouter.get('/driver/parcels/:parcelId', authenticate, requireRoles('driver'), mobileController.getParcelDetail);
mobileRouter.put('/driver/parcels/:parcelId/confirm', authenticate, requireRoles('driver'), mobileController.driverConfirm);
mobileRouter.put('/driver/parcels/:parcelId/pickup', authenticate, requireRoles('driver'), mobileController.driverPickup);
mobileRouter.put('/driver/parcels/:parcelId/transit', authenticate, requireRoles('driver'), mobileController.driverTransit);
mobileRouter.put('/driver/parcels/:parcelId/arrived', authenticate, requireRoles('driver'), mobileController.driverArrived);
mobileRouter.put('/driver/parcels/:parcelId/out-for-delivery', authenticate, requireRoles('driver'), mobileController.driverOutForDelivery);
mobileRouter.put('/driver/parcels/:parcelId/deliver', authenticate, requireRoles('driver'), mobileController.driverDeliver);
mobileRouter.post('/driver/bids', authenticate, requireRoles('driver'), mobileController.createBid);
mobileRouter.get('/driver/bids/sent', authenticate, requireRoles('driver'), mobileController.driverBidsSent);
mobileRouter.post('/driver/location', authenticate, requireRoles('driver'), mobileController.saveDriverLocation);
mobileRouter.get('/driver/vehicle', authenticate, requireRoles('driver'), mobileController.getDriverVehicle);
mobileRouter.put('/driver/vehicle', authenticate, requireRoles('driver'), mobileController.upsertDriverVehicle);

mobileRouter.put('/garage-admin/profile', authenticate, requireRoles('admin'), mobileController.updateProfile);
mobileRouter.get('/garage-admin/stats', authenticate, requireRoles('admin'), mobileController.garageStats);
mobileRouter.get('/garage-admin/parcels', authenticate, requireRoles('admin'), mobileController.garageParcels);
mobileRouter.post('/garage-admin/parcels/create', authenticate, requireRoles('admin'), mobileController.createParcel);
mobileRouter.get('/garage-admin/parcels/:parcelId', authenticate, requireRoles('admin'), mobileController.getParcelDetail);
mobileRouter.put('/garage-admin/parcels/:parcelId/status', authenticate, requireRoles('admin'), mobileController.updateParcelStatus);
mobileRouter.put('/garage-admin/parcels/:parcelId/assign-driver', authenticate, requireRoles('admin'), mobileController.assignDriver);
mobileRouter.post('/garage-admin/parcels/bulk-assign', authenticate, requireRoles('admin'), mobileController.bulkAssignDriver);
mobileRouter.delete('/garage-admin/parcels/:parcelId', authenticate, requireRoles('admin'), mobileController.cancelParcel);
mobileRouter.get('/garage-admin/drivers', authenticate, requireRoles('admin'), mobileController.garageDrivers);
mobileRouter.get('/garage-admin/reports/daily', authenticate, requireRoles('admin'), mobileController.garageDailyReport);
mobileRouter.get('/garage-admin/reports/monthly', authenticate, requireRoles('admin'), mobileController.garageMonthlyReport);
mobileRouter.get('/garage-admin/reports/export', authenticate, requireRoles('admin'), mobileController.garageExport);

mobileRouter.put('/super-admin/profile', authenticate, requireRoles('super_admin'), mobileController.updateProfile);
mobileRouter.get('/super-admin/stats', authenticate, requireRoles('super_admin'), mobileController.superAdminStats);
mobileRouter.get('/super-admin/stats/advanced', authenticate, requireRoles('super_admin'), mobileController.superAdminStats);
mobileRouter.get('/super-admin/users', authenticate, requireRoles('super_admin'), mobileController.superAdminUsers);
mobileRouter.post('/super-admin/users', authenticate, requireRoles('super_admin'), mobileController.superAdminCreateUser);
mobileRouter.get('/super-admin/users/:userId', authenticate, requireRoles('super_admin'), mobileController.superAdminUserDetail);
mobileRouter.put('/super-admin/users/:userId', authenticate, requireRoles('super_admin'), mobileController.superAdminUpdateUser);
mobileRouter.patch('/super-admin/users/:userId/role', authenticate, requireRoles('super_admin'), mobileController.superAdminUpdateUserRole);
mobileRouter.patch('/super-admin/users/:userId/status', authenticate, requireRoles('super_admin'), mobileController.superAdminUpdateUserStatus);
mobileRouter.delete('/super-admin/users/:userId', authenticate, requireRoles('super_admin'), mobileController.superAdminDeleteUser);
mobileRouter.get('/super-admin/garages', authenticate, requireRoles('super_admin'), mobileController.superAdminGarages);
mobileRouter.post('/super-admin/garages', authenticate, requireRoles('super_admin'), mobileController.superAdminCreateGarage);
mobileRouter.get('/super-admin/garages/:garageId', authenticate, requireRoles('super_admin'), mobileController.superAdminGarageDetail);
mobileRouter.put('/super-admin/garages/:garageId', authenticate, requireRoles('super_admin'), mobileController.superAdminUpdateGarage);
mobileRouter.delete('/super-admin/garages/:garageId', authenticate, requireRoles('super_admin'), mobileController.superAdminDeleteGarage);
mobileRouter.get('/super-admin/parcels', authenticate, requireRoles('super_admin'), mobileController.superAdminParcels);
mobileRouter.post('/super-admin/parcels/create', authenticate, requireRoles('super_admin'), mobileController.createParcel);
mobileRouter.get('/super-admin/parcels/:parcelId', authenticate, requireRoles('super_admin'), mobileController.getParcelDetail);
mobileRouter.put('/super-admin/parcels/:parcelId', authenticate, requireRoles('super_admin'), mobileController.superAdminUpdateParcel);
mobileRouter.put('/super-admin/parcels/:parcelId/status', authenticate, requireRoles('super_admin'), mobileController.updateParcelStatus);
mobileRouter.delete('/super-admin/parcels/:parcelId', authenticate, requireRoles('super_admin'), mobileController.cancelParcel);
mobileRouter.get('/super-admin/reports/daily', authenticate, requireRoles('super_admin'), mobileController.superAdminDailyReport);
mobileRouter.get('/super-admin/reports/monthly', authenticate, requireRoles('super_admin'), mobileController.superAdminMonthlyReport);
mobileRouter.get('/super-admin/export', authenticate, requireRoles('super_admin'), mobileController.superAdminExport);
mobileRouter.get('/super-admin/audit-logs', authenticate, requireRoles('super_admin'), mobileController.auditLogs);
mobileRouter.get('/super-admin/config', authenticate, requireRoles('super_admin'), mobileController.getSystemConfig);
mobileRouter.put('/super-admin/config', authenticate, requireRoles('super_admin'), mobileController.updateSystemConfig);
mobileRouter.post('/super-admin/backup', authenticate, requireRoles('super_admin'), mobileController.createBackup);
mobileRouter.get('/super-admin/backups', authenticate, requireRoles('super_admin'), mobileController.listBackups);
mobileRouter.post('/super-admin/restore', authenticate, requireRoles('super_admin'), mobileController.restoreBackup);

mobileRouter.post('/vehicles', authenticate, requireRoles('admin', 'super_admin'), mobileController.createVehicle);
mobileRouter.get('/vehicles', authenticate, requireRoles('admin', 'super_admin'), mobileController.listVehicles);
mobileRouter.patch('/vehicles/:vehicleId/status', authenticate, requireRoles('admin', 'super_admin'), mobileController.updateVehicleStatus);
mobileRouter.delete('/vehicles/:vehicleId', authenticate, requireRoles('admin', 'super_admin'), mobileController.deleteVehicle);

mobileRouter.get('/public/parcels/free', optionalAuthenticate, mobileController.freeParcels);
mobileRouter.get('/public/parcels/track/:trackingNumber', optionalAuthenticate, mobileController.trackParcel);
mobileRouter.get('/public/parcels/:parcelId/events', optionalAuthenticate, mobileController.publicParcelEvents);
mobileRouter.get('/public/parcels/:parcelId/bids', optionalAuthenticate, mobileController.publicParcelBids);
mobileRouter.get('/public/drivers/search', optionalAuthenticate, mobileController.searchDrivers);
mobileRouter.get('/public/drivers/garage/:garageId', optionalAuthenticate, mobileController.garagePublicDrivers);
mobileRouter.get('/public/drivers/:driverId', optionalAuthenticate, mobileController.publicDriverDetail);

mobileRouter.get('/parcels/:parcelId/timeline', authenticate, mobileController.parcelTimeline);
mobileRouter.post('/parcels/:parcelId/notes', authenticate, mobileController.addParcelNote);
mobileRouter.get('/parcels/:parcelId/notes', authenticate, mobileController.getParcelNotes);
mobileRouter.get('/parcels/:parcelId/proof', authenticate, mobileController.deliveryProof);
mobileRouter.post('/parcels/estimate', optionalAuthenticate, mobileController.estimateParcel);

mobileRouter.post('/payments/initiate', authenticate, mobileController.initiatePayment);
mobileRouter.post('/payments/:paymentId/confirm', authenticate, mobileController.confirmPayment);
mobileRouter.get('/payments/history', authenticate, mobileController.paymentHistory);

mobileRouter.get('/score', authenticate, mobileController.getScore);
mobileRouter.get('/score/balance', authenticate, mobileController.getScoreBalance);
mobileRouter.get('/score/history', authenticate, mobileController.getScoreHistory);
mobileRouter.post('/score/purchase', authenticate, mobileController.purchaseScore);
mobileRouter.post('/score/debit', authenticate, mobileController.debitScore);
mobileRouter.post('/score/credit', authenticate, mobileController.creditScore);
mobileRouter.post('/score/refund', authenticate, mobileController.refundScore);
mobileRouter.get('/score/stats', authenticate, mobileController.scoreStats);

mobileRouter.get('/addresses', authenticate, mobileController.listAddresses);
mobileRouter.post('/addresses', authenticate, mobileController.createAddress);
mobileRouter.put('/addresses/:addressId', authenticate, mobileController.updateAddress);
mobileRouter.delete('/addresses/:addressId', authenticate, mobileController.deleteAddress);
mobileRouter.patch('/addresses/:addressId/default', authenticate, mobileController.setDefaultAddress);

mobileRouter.post('/favorites/garages/:garageId', authenticate, mobileController.addFavoriteGarage);
mobileRouter.delete('/favorites/garages/:garageId', authenticate, mobileController.removeFavoriteGarage);
mobileRouter.get('/favorites/garages', authenticate, mobileController.favoriteGarages);

mobileRouter.post('/messages', authenticate, mobileController.sendMessage);
mobileRouter.get('/messages/conversations', authenticate, mobileController.conversations);
mobileRouter.get('/messages/thread', authenticate, mobileController.messageThread);
mobileRouter.patch('/messages/:messageId/read', authenticate, mobileController.readMessage);

mobileRouter.post('/support/messages', authenticate, mobileController.createSupportMessage);
mobileRouter.get('/support/messages', authenticate, mobileController.listSupportMessages);
mobileRouter.post('/ratings', authenticate, mobileController.createRating);
mobileRouter.get('/ratings/driver/:driverId', optionalAuthenticate, mobileController.driverRatings);
mobileRouter.get('/coupons/available', authenticate, mobileController.availableCoupons);
mobileRouter.get('/search/parcels', authenticate, mobileController.searchParcels);

mobileRouter.post('/identity/verify', authenticate, mobileController.createIdentityVerification);
mobileRouter.post('/identity/upload', authenticate, mobileController.identityUploadPlaceholder);
mobileRouter.get('/identity/status', authenticate, mobileController.identityStatus);

mobileRouter.get('/advertisements', optionalAuthenticate, mobileController.listAdvertisements);
mobileRouter.get('/advertisements/my', authenticate, mobileController.myAdvertisements);
mobileRouter.get('/advertisements/drivers', optionalAuthenticate, mobileController.listAdvertisements);
mobileRouter.post('/advertisements', authenticate, requireRoles('driver'), mobileController.createAdvertisement);
mobileRouter.get('/advertisements/stats', authenticate, mobileController.advertisementStats);
mobileRouter.get('/advertisements/:advertisementId', optionalAuthenticate, mobileController.advertisementDetail);
mobileRouter.put('/advertisements/:advertisementId', authenticate, mobileController.updateAdvertisement);
mobileRouter.delete('/advertisements/:advertisementId', authenticate, mobileController.deleteAdvertisement);
mobileRouter.post('/advertisements/:advertisementId/close', authenticate, mobileController.closeAdvertisement);
mobileRouter.post('/advertisements/:advertisementId/offers', authenticate, requireRoles('client'), mobileController.createAdvertisementOffer);
mobileRouter.get('/advertisements/:advertisementId/offers', authenticate, mobileController.advertisementOffers);
mobileRouter.post('/advertisements/:advertisementId/offers/:offerId/accept', authenticate, mobileController.acceptAdvertisementOffer);
mobileRouter.post('/advertisements/:advertisementId/offers/:offerId/reject', authenticate, mobileController.rejectAdvertisementOffer);
mobileRouter.post('/advertisements/:advertisementId/offers/:offerId/negotiate', authenticate, mobileController.negotiateAdvertisementOffer);

mobileRouter.get('/webhooks', authenticate, requireRoles('super_admin'), mobileController.listWebhooks);
mobileRouter.post('/webhooks', authenticate, requireRoles('super_admin'), mobileController.createWebhook);
mobileRouter.delete('/webhooks/:webhookId', authenticate, requireRoles('super_admin'), mobileController.deleteWebhook);

