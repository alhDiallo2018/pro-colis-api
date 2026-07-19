import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authRateLimit } from '../../middlewares/rate-limit.middleware.js';
import { loginWithPinSchema, refreshSchema, registerSchema, sendOtpSchema, verifyOtpSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, verifyEmailSchema, resendVerificationSchema } from './auth.validators.js';
import * as authController from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimit, validate(registerSchema), authController.register);
authRouter.post('/login', authRateLimit, validate(loginWithPinSchema), authController.loginWithPin);
authRouter.post('/login-with-pin', authRateLimit, validate(loginWithPinSchema), authController.loginWithPin);
authRouter.post('/refresh', authRateLimit, validate(refreshSchema), authController.refresh);
authRouter.post('/send-otp', authRateLimit, validate(sendOtpSchema), authController.sendOtp);
authRouter.post('/verify-otp', authRateLimit, validate(verifyOtpSchema), authController.verifyOtp);
authRouter.get('/me', authenticate, authController.me);
authRouter.post('/forgot-password', authRateLimit, validate(forgotPasswordSchema), authController.forgotPassword);
authRouter.post('/reset-password', authRateLimit, validate(resetPasswordSchema), authController.resetPassword);
authRouter.post('/change-password', authenticate, authRateLimit, validate(changePasswordSchema), authController.changePassword);
authRouter.post('/verify-email', authRateLimit, validate(verifyEmailSchema), authController.verifyEmail);
authRouter.post('/resend-verification', authRateLimit, validate(resendVerificationSchema), authController.resendVerification);
