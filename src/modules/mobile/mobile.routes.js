import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as adminAssistanceController from '../admin-assistance.controller.js';
import * as adminExpenseController from '../admin-expense.controller.js';
import * as adminFinanceController from '../admin-finance.controller.js';
import * as adminIdentityController from '../admin-identity.controller.js';
import * as adminReputationController from '../admin-reputation.controller.js';
import * as backupController from '../backups/backup.controller.js';
import * as paydunyaController from '../paydunya.controller.js';
import * as mobileController from './mobile.controller.js';

export const mobileRouter = Router();

// ============================================================
// PROFIL UTILISATEUR
// ============================================================

mobileRouter.get('/users/stats', authenticate, mobileController.userStats);
mobileRouter.put('/users/pin', authenticate, mobileController.updatePin);
mobileRouter.delete('/users/account', authenticate, mobileController.deleteAccount);
mobileRouter.put('/users/profile-photo', authenticate, mobileController.updateProfilePhoto);

// ============================================================
// CLIENT
// ============================================================

mobileRouter.put('/client/profile', authenticate, requireRoles('client'), mobileController.updateProfile);
mobileRouter.get('/client/parcels/my-parcels', authenticate, requireRoles('client'), mobileController.clientParcels);
mobileRouter.post('/client/parcels/create', authenticate, requireRoles('client'), mobileController.createParcel);
mobileRouter.get('/client/parcels/:parcelId', authenticate, requireRoles('client'), mobileController.getParcelDetail);
mobileRouter.put('/client/parcels/:parcelId', authenticate, requireRoles('client'), mobileController.updateParcel);
mobileRouter.get('/client/parcels/:parcelId/delivery-code', authenticate, requireRoles('client'), mobileController.clientDeliveryCode);
mobileRouter.post('/client/parcels/:parcelId/cancel', authenticate, requireRoles('client'), mobileController.cancelParcel);

// ============================================================
// CLIENT - ENCHÈRES (BIDS)
// ============================================================

mobileRouter.post('/client/parcels/:parcelId/bids/:bidId/accept', authenticate, requireRoles('client'), mobileController.acceptBid);
mobileRouter.post('/client/parcels/:parcelId/bids/:bidId/reject', authenticate, requireRoles('client'), mobileController.rejectBid);
mobileRouter.get('/client/bids/stats', authenticate, requireRoles('client'), mobileController.clientBidStats);
mobileRouter.get('/client/bids/received', authenticate, requireRoles('client'), mobileController.clientBidsReceived);

// ============================================================
// CLIENT - NÉGOCIATION DES ENCHÈRES
// ============================================================

// Compatibilité avec les versions déjà publiées
mobileRouter.post('/client/bids/:bidId/negotiate', authenticate, requireRoles('client'), mobileController.clientCounterBid);

// Client: Récupérer les détails de négociation d'une offre
mobileRouter.get(
  '/client/bids/:bidId/negotiation',
  authenticate,
  requireRoles('client'),
  mobileController.getBidNegotiation
);

// Route partagée par le web et le mobile
mobileRouter.get(
  '/bids/:bidId/negotiation',
  authenticate,
  mobileController.getBidNegotiation
);

// Client: Envoyer une contre-offre
mobileRouter.post(
  '/client/bids/:bidId/counter',
  authenticate,
  requireRoles('client'),
  mobileController.clientCounterBid
);

// Client: Accepter une offre (après négociation)
mobileRouter.post(
  '/client/bids/:bidId/accept',
  authenticate,
  requireRoles('client'),
  mobileController.clientAcceptBid
);

// ============================================================
// DRIVER - ENCHÈRES
// ============================================================

// Driver: Répondre à une contre-offre
mobileRouter.post(
  '/driver/bids/:bidId/respond-counter',
  authenticate,
  requireRoles('driver'),
  mobileController.driverRespondCounter
);

// Alias temporaire pour les builds web/mobile qui utilisaient encore /respond
mobileRouter.post(
  '/driver/bids/:bidId/respond',
  authenticate,
  requireRoles('driver'),
  mobileController.driverRespondCounter
);

// ============================================================
// ✅ PROPOSITIONS DIRECTES (NOUVEAU FLUX B)
// ============================================================

/**
 * Chauffeur répond à une proposition directe
 * POST /driver/proposals/:parcelId/respond
 * Actions: accept, reject, counter
 */
mobileRouter.post(
  '/driver/proposals/:parcelId/respond',
  authenticate,
  requireRoles('driver'),
  mobileController.respondToProposal
);

/**
 * Client répond à une contre-offre
 * POST /client/proposals/:parcelId/respond-counter
 * Actions: accept, counter
 */
mobileRouter.post(
  '/client/proposals/:parcelId/respond-counter',
  authenticate,
  requireRoles('client'),
  mobileController.respondToCounterProposal
);

/**
 * Récupérer les propositions reçues par un chauffeur
 * GET /driver/proposals
 */
mobileRouter.get(
  '/driver/proposals',
  authenticate,
  requireRoles('driver'),
  mobileController.getDriverProposals
);

// ============================================================
// DRIVER - PARCELS
// ============================================================

mobileRouter.put('/driver/profile', authenticate, requireRoles('driver'), mobileController.updateProfile);
mobileRouter.get('/driver/stats', authenticate, requireRoles('driver'), mobileController.driverStats);
mobileRouter.get('/driver/parcels', authenticate, requireRoles('driver'), mobileController.driverParcels);
mobileRouter.post('/driver/parcels/create', authenticate, requireRoles('driver'), mobileController.createParcel);

// ✅ CORRECTION : Accès aux colis en statut 'free' où le chauffeur a fait une offre
mobileRouter.get(
  '/driver/parcels/:parcelId',
  authenticate,
  requireRoles('driver'),
  mobileController.getDriverParcelDetail
);

// ✅ Missions assignées (après acceptation de proposition ou enchère)
mobileRouter.put('/driver/parcels/:parcelId/confirm', authenticate, requireRoles('driver'), mobileController.driverConfirm);
mobileRouter.put('/driver/parcels/:parcelId/pickup', authenticate, requireRoles('driver'), mobileController.driverPickup);
mobileRouter.put('/driver/parcels/:parcelId/transit', authenticate, requireRoles('driver'), mobileController.driverTransit);
mobileRouter.put('/driver/parcels/:parcelId/arrived', authenticate, requireRoles('driver'), mobileController.driverArrived);
mobileRouter.put('/driver/parcels/:parcelId/out-for-delivery', authenticate, requireRoles('driver'), mobileController.driverOutForDelivery);
mobileRouter.put('/driver/parcels/:parcelId/deliver', authenticate, requireRoles('driver'), mobileController.driverDeliver);

// ============================================================
// DRIVER - CASH & FINANCES
// ============================================================

mobileRouter.post('/driver/parcels/:parcelId/declare-cash', authenticate, requireRoles('driver'), mobileController.declareCashCollection);
mobileRouter.get('/driver/parcels/:parcelId/delivery-code', authenticate, requireRoles('driver'), mobileController.clientDeliveryCode);
mobileRouter.get('/driver/cash-declarations', authenticate, requireRoles('driver'), mobileController.driverCashDeclarations);
mobileRouter.post('/driver/bids', authenticate, requireRoles('driver'), mobileController.createBid);
mobileRouter.get('/driver/bids/sent', authenticate, requireRoles('driver'), mobileController.driverBidsSent);
mobileRouter.post('/driver/location', authenticate, requireRoles('driver'), mobileController.saveDriverLocation);
mobileRouter.get('/driver/vehicle', authenticate, requireRoles('driver'), mobileController.getDriverVehicle);
mobileRouter.put('/driver/vehicle', authenticate, requireRoles('driver'), mobileController.upsertDriverVehicle);

// ============================================================
// COMMISSIONS
// ============================================================

mobileRouter.post('/commissions/estimate', optionalAuthenticate, mobileController.estimateCommission);
mobileRouter.get('/driver/parcels/:parcelId/commission', authenticate, requireRoles('driver'), mobileController.driverParcelCommission);
mobileRouter.post('/driver/parcels/:parcelId/pay-commission', authenticate, requireRoles('driver'), mobileController.driverPayCommission);

// ============================================================
// GARAGE ADMIN
// ============================================================

mobileRouter.put('/garage-admin/profile', authenticate, requireRoles('admin'), mobileController.updateProfile);
mobileRouter.get('/garage-admin/stats', authenticate, requireRoles('admin'), mobileController.garageStats);
mobileRouter.get('/garage-admin/parcels', authenticate, requireRoles('admin'), mobileController.garageParcels);
mobileRouter.post('/garage-admin/parcels/create', authenticate, requireRoles('admin'), mobileController.createParcel);
mobileRouter.get('/garage-admin/parcels/:parcelId', authenticate, requireRoles('admin'), mobileController.getParcelDetail);
mobileRouter.put('/garage-admin/parcels/:parcelId', authenticate, requireRoles('admin'), mobileController.updateParcel);
mobileRouter.put('/garage-admin/parcels/:parcelId/status', authenticate, requireRoles('admin'), mobileController.updateParcelStatus);
mobileRouter.get('/garage-admin/drivers', authenticate, requireRoles('admin'), mobileController.garageDrivers);
mobileRouter.get('/garage-admin/reports/daily', authenticate, requireRoles('admin'), mobileController.garageDailyReport);
mobileRouter.get('/garage-admin/reports/monthly', authenticate, requireRoles('admin'), mobileController.garageMonthlyReport);
mobileRouter.get('/garage-admin/reports/export', authenticate, requireRoles('admin'), mobileController.garageExport);

// ============================================================
// SUPER ADMIN & SUPPORT - LECTURE
// ============================================================

const supportReadRoles = requireRoles('super_admin', 'support', 'support_technique', 'support_commercial');

mobileRouter.put('/super-admin/profile', authenticate, requireRoles('super_admin', 'support'), mobileController.updateProfile);
mobileRouter.get('/super-admin/stats', authenticate, supportReadRoles, mobileController.superAdminStats);
mobileRouter.get('/super-admin/stats/advanced', authenticate, supportReadRoles, mobileController.superAdminStats);
mobileRouter.get('/super-admin/users', authenticate, supportReadRoles, mobileController.superAdminUsers);
mobileRouter.get('/super-admin/users/:userId', authenticate, supportReadRoles, mobileController.superAdminUserDetail);
mobileRouter.get('/super-admin/garages', authenticate, supportReadRoles, mobileController.superAdminGarages);
mobileRouter.get('/super-admin/garages/:garageId', authenticate, supportReadRoles, mobileController.superAdminGarageDetail);
mobileRouter.get('/super-admin/parcels', authenticate, supportReadRoles, mobileController.superAdminParcels);
mobileRouter.get('/super-admin/parcels/:parcelId', authenticate, supportReadRoles, mobileController.getParcelDetail);
mobileRouter.get('/super-admin/reports/daily', authenticate, supportReadRoles, mobileController.superAdminDailyReport);
mobileRouter.get('/super-admin/reports/monthly', authenticate, supportReadRoles, mobileController.superAdminMonthlyReport);
mobileRouter.get('/super-admin/export', authenticate, supportReadRoles, mobileController.superAdminExport);
mobileRouter.get('/super-admin/audit-logs', authenticate, supportReadRoles, mobileController.auditLogs);
mobileRouter.get('/super-admin/payments/cash-declarations', authenticate, supportReadRoles, mobileController.pendingCashDeclarations);
mobileRouter.get('/public/broadcasts', optionalAuthenticate, mobileController.getPublicBroadcasts);
mobileRouter.get('/super-admin/config', authenticate, supportReadRoles, mobileController.getSystemConfig);
mobileRouter.get('/super-admin/system/health', authenticate, supportReadRoles, mobileController.systemHealth);

// ============================================================
// SUPER ADMIN & SUPPORT - ÉCRITURE
// ============================================================

const supportWriteRoles = requireRoles('super_admin', 'support');

mobileRouter.post('/super-admin/users', authenticate, supportWriteRoles, mobileController.superAdminCreateUser);
mobileRouter.put('/super-admin/users/:userId', authenticate, supportWriteRoles, mobileController.superAdminUpdateUser);
mobileRouter.patch('/super-admin/users/:userId/role', authenticate, supportWriteRoles, mobileController.superAdminUpdateUserRole);
mobileRouter.patch('/super-admin/users/:userId/status', authenticate, supportWriteRoles, mobileController.superAdminUpdateUserStatus);
mobileRouter.delete('/super-admin/users/:userId', authenticate, supportWriteRoles, mobileController.superAdminDeleteUser);
mobileRouter.post('/super-admin/users/:userId/reset-pin', authenticate, supportWriteRoles, mobileController.superAdminResetUserPin);
mobileRouter.post('/super-admin/garages', authenticate, supportWriteRoles, mobileController.superAdminCreateGarage);
mobileRouter.put('/super-admin/garages/:garageId', authenticate, supportWriteRoles, mobileController.superAdminUpdateGarage);
mobileRouter.delete('/super-admin/garages/:garageId', authenticate, supportWriteRoles, mobileController.superAdminDeleteGarage);
mobileRouter.post('/super-admin/parcels/create', authenticate, supportWriteRoles, mobileController.createParcel);
mobileRouter.put('/super-admin/parcels/:parcelId', authenticate, supportWriteRoles, mobileController.superAdminUpdateParcel);
mobileRouter.put('/super-admin/parcels/:parcelId/status', authenticate, supportWriteRoles, mobileController.updateParcelStatus);
mobileRouter.delete('/super-admin/parcels/:parcelId', authenticate, supportWriteRoles, mobileController.cancelParcel);
mobileRouter.post('/super-admin/payments/:paymentId/validate-cash', authenticate, supportWriteRoles, mobileController.validateCashDeclaration);
mobileRouter.post('/super-admin/payments/:paymentId/reject-cash', authenticate, supportWriteRoles, mobileController.rejectCashDeclaration);
mobileRouter.put('/super-admin/config', authenticate, supportWriteRoles, mobileController.updateSystemConfig);
mobileRouter.post('/super-admin/parcels/:parcelId/confirm-cash', authenticate, supportWriteRoles, mobileController.confirmCashPayment);

// ============================================================
// BACKUPS
// ============================================================

mobileRouter.post('/super-admin/backup', authenticate, requireRoles('super_admin'), backupController.createBackup);
mobileRouter.get('/super-admin/backups', authenticate, supportReadRoles, backupController.listBackups);
mobileRouter.get('/super-admin/backups/:backupId/download', authenticate, requireRoles('super_admin'), backupController.downloadBackup);
mobileRouter.post('/super-admin/restore', authenticate, requireRoles('super_admin'), backupController.restoreBackup);

// ============================================================
// VEHICLES
// ============================================================

mobileRouter.post('/vehicles', authenticate, requireRoles('admin', 'super_admin'), mobileController.createVehicle);
mobileRouter.get('/vehicles', authenticate, requireRoles('admin', 'super_admin'), mobileController.listVehicles);
mobileRouter.patch('/vehicles/:vehicleId/status', authenticate, requireRoles('admin', 'super_admin'), mobileController.updateVehicleStatus);
mobileRouter.delete('/vehicles/:vehicleId', authenticate, requireRoles('admin', 'super_admin'), mobileController.deleteVehicle);

// ============================================================
// PUBLIC
// ============================================================

mobileRouter.get('/public/parcels/free', optionalAuthenticate, mobileController.freeParcels);
mobileRouter.get('/public/parcels/track/:trackingNumber', optionalAuthenticate, mobileController.trackParcel);
mobileRouter.get('/public/parcels/:parcelId/events', optionalAuthenticate, mobileController.publicParcelEvents);
mobileRouter.get('/public/parcels/:parcelId/bids', optionalAuthenticate, mobileController.publicParcelBids);
mobileRouter.get('/public/drivers/search', optionalAuthenticate, mobileController.searchDrivers);
mobileRouter.get('/public/drivers/garage/:garageId', optionalAuthenticate, mobileController.garagePublicDrivers);
mobileRouter.get('/public/drivers/:driverId', optionalAuthenticate, mobileController.publicDriverDetail);

// ============================================================
// PARCELS - GÉNÉRAL
// ============================================================

mobileRouter.get('/parcels/:parcelId/timeline', authenticate, mobileController.parcelTimeline);
mobileRouter.post('/parcels/:parcelId/notes', authenticate, mobileController.addParcelNote);
mobileRouter.get('/parcels/:parcelId/notes', authenticate, mobileController.getParcelNotes);
mobileRouter.get('/parcels/:parcelId/proof', authenticate, mobileController.deliveryProof);
mobileRouter.patch('/parcels/:parcelId/payment-channel', authenticate, mobileController.setParcelPaymentChannel);
mobileRouter.post('/parcels/estimate', optionalAuthenticate, mobileController.estimateParcel);

// ============================================================
// PAYMENTS
// ============================================================

mobileRouter.post('/payments/initiate', authenticate, mobileController.initiatePayment);
mobileRouter.post('/payments/:paymentId/confirm', authenticate, mobileController.confirmPayment);
mobileRouter.get('/payments/history', authenticate, mobileController.paymentHistory);

// ============================================================
// SCORE & WALLET
// ============================================================

mobileRouter.get('/score', authenticate, mobileController.getScore);
mobileRouter.get('/score/balance', authenticate, mobileController.getScoreBalance);
mobileRouter.get('/driver/wallet', authenticate, mobileController.getDriverWallet);
mobileRouter.post('/driver/wallet/withdraw', authenticate, mobileController.withdrawWallet);
mobileRouter.get('/driver/wallet/withdrawals', authenticate, mobileController.getDriverWithdrawals);
mobileRouter.delete('/driver/wallet/withdrawals/:withdrawalId', authenticate, mobileController.cancelWithdrawal);
mobileRouter.get('/score/history', authenticate, mobileController.getScoreHistory);
mobileRouter.post('/score/purchase', authenticate, mobileController.purchaseScore);
mobileRouter.post('/score/purchase/wallet', authenticate, mobileController.purchaseScoreWithWallet);
mobileRouter.post('/score/debit', authenticate, mobileController.debitScore);
mobileRouter.post('/score/credit', authenticate, mobileController.creditScore);
mobileRouter.post('/score/refund', authenticate, mobileController.refundScore);
mobileRouter.get('/score/stats', authenticate, mobileController.scoreStats);

// ============================================================
// ADDRESSES
// ============================================================

mobileRouter.get('/addresses', authenticate, mobileController.listAddresses);
mobileRouter.post('/addresses', authenticate, mobileController.createAddress);
mobileRouter.put('/addresses/:addressId', authenticate, mobileController.updateAddress);
mobileRouter.delete('/addresses/:addressId', authenticate, mobileController.deleteAddress);
mobileRouter.patch('/addresses/:addressId/default', authenticate, mobileController.setDefaultAddress);

// ============================================================
// FAVORITES
// ============================================================

mobileRouter.post('/favorites/garages/:garageId', authenticate, mobileController.addFavoriteGarage);
mobileRouter.delete('/favorites/garages/:garageId', authenticate, mobileController.removeFavoriteGarage);
mobileRouter.get('/favorites/garages', authenticate, mobileController.favoriteGarages);

// ============================================================
// MESSAGES
// ============================================================

mobileRouter.post('/messages', authenticate, mobileController.sendMessage);
mobileRouter.get('/messages/conversations', authenticate, mobileController.conversations);
mobileRouter.get('/messages/thread', authenticate, mobileController.messageThread);
mobileRouter.patch('/messages/:messageId/read', authenticate, mobileController.readMessage);
mobileRouter.patch('/messages/:messageId', authenticate, mobileController.updateMessage);
mobileRouter.delete('/messages/:messageId', authenticate, mobileController.deleteMessage);

// ============================================================
// MESSAGES - MODERATION
// ============================================================

// Admin et cellules support accedent a l'integralite des echanges pour traiter
// un signalement ; la liste des roles vit dans le controleur pour rester
// alignee avec le controle applique a la suppression.
const messageModerationRoles = requireRoles(...mobileController.MESSAGE_MODERATOR_ROLES);

mobileRouter.get(
  '/messages/admin/conversations',
  authenticate,
  messageModerationRoles,
  mobileController.moderationConversations
);
mobileRouter.get(
  '/messages/admin/thread',
  authenticate,
  messageModerationRoles,
  mobileController.moderationThread
);
mobileRouter.get(
  '/messages/admin/messages',
  authenticate,
  messageModerationRoles,
  mobileController.moderationMessages
);
// Purge groupee : un signalement porte souvent sur une rafale de messages.
mobileRouter.post(
  '/messages/admin/messages/bulk-delete',
  authenticate,
  messageModerationRoles,
  mobileController.moderationDeleteMessages
);
mobileRouter.delete(
  '/messages/admin/messages/:messageId',
  authenticate,
  messageModerationRoles,
  mobileController.moderationDeleteMessage
);
mobileRouter.post(
  '/messages/admin/messages/:messageId/restore',
  authenticate,
  messageModerationRoles,
  mobileController.moderationRestoreMessage
);

// ============================================================
// SUPPORT
// ============================================================

mobileRouter.post('/support/messages', authenticate, mobileController.createSupportMessage);
mobileRouter.get('/support/messages', authenticate, mobileController.listSupportMessages);

const supportChatRoles = requireRoles(
  'super_admin',
  'admin',
  'support',
  'support_technique',
  'support_commercial'
);

mobileRouter.get(
  '/messages/admin/support/conversations',
  authenticate,
  supportChatRoles,
  mobileController.adminSupportConversations
);

mobileRouter.get(
  '/messages/admin/support/conversations/:supportUserId/:userId',
  authenticate,
  supportChatRoles,
  mobileController.adminSupportThread
);

mobileRouter.post(
  '/messages/admin/support/reply',
  authenticate,
  supportChatRoles,
  mobileController.adminSupportReply
);

// ============================================================
// RATINGS
// ============================================================

mobileRouter.post('/ratings', authenticate, mobileController.createRating);
mobileRouter.get('/ratings/driver/:driverId', optionalAuthenticate, mobileController.driverRatings);

// ============================================================
// PAYDUNYA
// ============================================================

mobileRouter.post('/payments/paydunya/create', authenticate, paydunyaController.createPaydunyaPayment);
mobileRouter.get('/payments/paydunya/confirm/:token', authenticate, paydunyaController.confirmPaydunyaPayment);
mobileRouter.post('/payments/paydunya/ipn', paydunyaController.paydunyaIpn);
mobileRouter.get('/payments/paydunya/return', paydunyaController.paydunyaReturn);
mobileRouter.get('/payments/paydunya/cancel', paydunyaController.paydunyaCancel);
mobileRouter.post('/payments/paydunya/disburse-callback', paydunyaController.paydunyaDisburseCallback);
mobileRouter.get('/admin/payments/paydunya-config', authenticate, requireRoles('super_admin', 'support'), paydunyaController.getPaydunyaAdminConfig);
mobileRouter.put('/admin/payments/paydunya-config', authenticate, requireRoles('super_admin', 'support'), paydunyaController.updatePaydunyaAdminConfig);

// ============================================================
// COUPONS & SEARCH
// ============================================================

mobileRouter.get('/coupons/available', authenticate, mobileController.availableCoupons);
mobileRouter.get('/search/parcels', authenticate, mobileController.searchParcels);

// ============================================================
// IDENTITY VERIFICATION
// ============================================================

mobileRouter.post('/identity/verify', authenticate, mobileController.createIdentityVerification);
mobileRouter.post('/identity/upload', authenticate, mobileController.identityUpload);
mobileRouter.get('/identity/status', authenticate, mobileController.identityStatus);

// ============================================================
// ADVERTISEMENTS
// ============================================================

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
mobileRouter.post(
  '/advertisements/:advertisementId/offers/:offerId/accept',
  authenticate,
  requireRoles('driver', 'super_admin'),
  mobileController.acceptAdvertisementOffer
);
mobileRouter.post('/advertisements/:advertisementId/offers/:offerId/reject', authenticate, mobileController.rejectAdvertisementOffer);
mobileRouter.post('/advertisements/:advertisementId/offers/:offerId/negotiate', authenticate, mobileController.negotiateAdvertisementOffer);

// Récupérer le colis depuis une annonce
mobileRouter.get(
  '/advertisements/:advertisementId/parcel',
  authenticate,
  mobileController.getParcelFromAdvertisement
);

// ============================================================
// WEBHOOKS
// ============================================================

mobileRouter.get('/webhooks', authenticate, requireRoles('super_admin', 'support'), mobileController.listWebhooks);
mobileRouter.post('/webhooks', authenticate, requireRoles('super_admin', 'support'), mobileController.createWebhook);
mobileRouter.delete('/webhooks/:webhookId', authenticate, requireRoles('super_admin', 'support'), mobileController.deleteWebhook);

// ============================================================
// SUPER ADMIN - FINANCE
// ============================================================

mobileRouter.get('/super-admin/finance/dashboard', authenticate, supportReadRoles, adminFinanceController.financeDashboard);

// Wallets
mobileRouter.get('/super-admin/wallets', authenticate, supportReadRoles, adminFinanceController.listWallets);
mobileRouter.get('/super-admin/wallets/:userId', authenticate, supportReadRoles, adminFinanceController.getWallet);
mobileRouter.post('/super-admin/wallets/:userId/recharge', authenticate, supportWriteRoles, adminFinanceController.rechargeWallet);
mobileRouter.post('/super-admin/wallets/:userId/debit', authenticate, supportWriteRoles, adminFinanceController.debitWallet);
mobileRouter.get('/super-admin/wallets/:userId/transactions', authenticate, supportReadRoles, adminFinanceController.walletTransactions);

// Commissions
mobileRouter.get('/super-admin/commissions/config', authenticate, supportReadRoles, adminFinanceController.getCommissionConfig);
mobileRouter.put('/super-admin/commissions/config', authenticate, supportWriteRoles, adminFinanceController.updateCommissionConfig);
mobileRouter.post('/super-admin/commissions/simulate', authenticate, supportReadRoles, adminFinanceController.simulateCommission);

// Payments
mobileRouter.get('/super-admin/payments', authenticate, supportReadRoles, adminFinanceController.listPayments);
mobileRouter.get('/super-admin/payments/:paymentId', authenticate, supportReadRoles, adminFinanceController.getPayment);

// Withdrawals
mobileRouter.get('/super-admin/withdrawals', authenticate, supportReadRoles, adminFinanceController.listPayouts);
mobileRouter.get('/super-admin/withdrawals/:withdrawalId', authenticate, supportReadRoles, adminFinanceController.getWithdrawal);
mobileRouter.post('/super-admin/withdrawals/:withdrawalId/approve', authenticate, supportWriteRoles, adminFinanceController.approveWithdrawal);
mobileRouter.post('/super-admin/withdrawals/:withdrawalId/complete', authenticate, supportWriteRoles, adminFinanceController.completeWithdrawal);
mobileRouter.post('/super-admin/withdrawals/:withdrawalId/reject', authenticate, supportWriteRoles, adminFinanceController.rejectWithdrawal);

// ============================================================
// SUPER ADMIN - REPUTATION
// ============================================================

mobileRouter.get('/super-admin/reputation/dashboard', authenticate, supportReadRoles, adminReputationController.reputationDashboard);

// Scores
mobileRouter.get('/super-admin/scores', authenticate, supportReadRoles, adminReputationController.listScores);
mobileRouter.get('/super-admin/scores/ranking', authenticate, supportReadRoles, adminReputationController.driverRanking);
mobileRouter.get('/super-admin/scores/:userId', authenticate, supportReadRoles, adminReputationController.getScore);
mobileRouter.get('/super-admin/scores/:userId/history', authenticate, supportReadRoles, adminReputationController.scoreHistory);
mobileRouter.post('/super-admin/scores/:userId/add', authenticate, supportWriteRoles, adminReputationController.addPoints);
mobileRouter.post('/super-admin/scores/:userId/remove', authenticate, supportWriteRoles, adminReputationController.removePoints);

// Driver detail (combined)
mobileRouter.get('/super-admin/drivers/:userId', authenticate, supportReadRoles, adminReputationController.driverDetail);

// ============================================================
// SUPER ADMIN - ASSISTANCES
// ============================================================

const assistanceRoles = requireRoles('super_admin', 'support', 'support_technique', 'support_commercial');

mobileRouter.get('/super-admin/assistances', authenticate, assistanceRoles, adminAssistanceController.listAssistances);
mobileRouter.post('/super-admin/assistances', authenticate, assistanceRoles, adminAssistanceController.createAssistance);
mobileRouter.get('/super-admin/assistances/users/search', authenticate, assistanceRoles, adminAssistanceController.searchAssistanceUsers);
mobileRouter.get('/super-admin/assistances/:assistanceId', authenticate, assistanceRoles, adminAssistanceController.getAssistance);
mobileRouter.put('/super-admin/assistances/:assistanceId', authenticate, assistanceRoles, adminAssistanceController.updateAssistance);
mobileRouter.delete('/super-admin/assistances/:assistanceId', authenticate, requireRoles('super_admin', 'support'), adminAssistanceController.deleteAssistance);

// ============================================================
// SUPER ADMIN - IDENTITY VERIFICATIONS (KYC)
// ============================================================

mobileRouter.get('/super-admin/identity-verifications', authenticate, supportReadRoles, adminIdentityController.listIdentityVerifications);
mobileRouter.post('/super-admin/identity-verifications/:verificationId/approve', authenticate, supportWriteRoles, adminIdentityController.approveIdentity);
mobileRouter.post('/super-admin/identity-verifications/:verificationId/reject', authenticate, supportWriteRoles, adminIdentityController.rejectIdentity);

// ============================================================
// SUPER ADMIN - EXPENSES
// ============================================================

mobileRouter.get('/super-admin/expenses', authenticate, supportReadRoles, adminExpenseController.listExpenses);
mobileRouter.post('/super-admin/expenses', authenticate, supportWriteRoles, adminExpenseController.createExpense);
mobileRouter.get('/super-admin/expenses/:expenseId', authenticate, supportReadRoles, adminExpenseController.getExpense);
mobileRouter.put('/super-admin/expenses/:expenseId', authenticate, supportWriteRoles, adminExpenseController.updateExpense);
mobileRouter.delete('/super-admin/expenses/:expenseId', authenticate, supportWriteRoles, adminExpenseController.deleteExpense);