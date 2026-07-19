import { ok, fail } from '../../utils/api-response.js';
import { serializeUser } from '../../utils/user-serializer.js';
import * as authService from './auth.service.js';
import { sendOtpSms, sendOtpEmail, isBrevoConfigured } from '../../utils/brevo.js';

export async function register(req, res) {
  try {
    const result = await authService.registerUser(req.validated.body);
    return ok(res, {
      status: 201,
      message: 'Compte cree',
      data: result
    });
  } catch (error) {
    req.log.error(
      {
        error,
        action: 'auth.register',
        requestId: req.requestId,
        phone: req.validated?.body?.phone
      },
      'Failed to register user'
    );

    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible de creer le compte',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export async function loginWithPin(req, res) {
  try {
    const result = await authService.loginWithPin(req.validated.body);
    return ok(res, {
      message: 'Connexion effectuee',
      data: result
    });
  } catch (error) {
    req.log.error(
      {
        error,
        action: 'auth.loginWithPin',
        requestId: req.requestId,
        identifier: req.validated?.body?.identifier
      },
      'Failed to login with PIN'
    );

    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible de se connecter',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export async function refresh(req, res) {
  try {
    const result = await authService.refreshAccessToken(req.validated.body.refreshToken);
    return ok(res, {
      message: 'Token renouvele',
      data: result
    });
  } catch (error) {
    req.log.error(
      {
        error,
        action: 'auth.refresh',
        requestId: req.requestId
      },
      'Failed to refresh token'
    );

    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible de renouveler la session',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export function me(req, res) {
  return ok(res, {
    message: 'Utilisateur courant',
    data: {
      user: serializeUser(req.user)
    }
  });
}

export async function sendOtp(req, res) {
  try {
    const { phone, email, purpose } = req.validated.body;
    const { code } = await authService.sendOtp({ phone, email, purpose });

    if (isBrevoConfigured()) {
      if (phone) {
        sendOtpSms({ phone, code, purpose }).catch(() => {});
      }
      if (email) {
        sendOtpEmail({ email, code, purpose }).catch(() => {});
      }
    }

    return ok(res, {
      message: isBrevoConfigured()
        ? 'Code envoye'
        : `Code genere (Brevo non configure) : ${code}`,
      data: isBrevoConfigured() ? { sent: true } : { code }
    });
  } catch (error) {
    req.log.error(
      { error, action: 'auth.sendOtp', requestId: req.requestId },
      'Failed to send OTP'
    );
    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible d\'envoyer le code',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export async function verifyOtp(req, res) {
  try {
    const { phone, email, code, purpose } = req.validated.body;
    const result = await authService.verifyOtp({ phone, email, code, purpose });

    return ok(res, {
      message: 'Code verifie',
      data: result
    });
  } catch (error) {
    req.log.error(
      { error, action: 'auth.verifyOtp', requestId: req.requestId },
      'Failed to verify OTP'
    );
    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Code invalide',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export async function forgotPassword(req, res) {
  try {
    const { identifier } = req.validated.body;
    const { code, phone, email } = await authService.forgotPassword({ identifier });

    if (isBrevoConfigured()) {
      if (phone) {
        sendOtpSms({ phone, code, purpose: 'reset-password' }).catch(() => {});
      }
      if (email) {
        sendOtpEmail({ email, code, purpose: 'reset-password' }).catch(() => {});
      }
    }

    return ok(res, {
      message: isBrevoConfigured()
        ? 'Code de reinitialisation envoye'
        : `Code genere (Brevo non configure) : ${code}`,
      data: isBrevoConfigured() ? { sent: true } : { code }
    });
  } catch (error) {
    req.log.error(
      { error, action: 'auth.forgotPassword', requestId: req.requestId, identifier: req.validated?.body?.identifier },
      'Failed to process forgot password'
    );
    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible de traiter la demande',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export async function resetPassword(req, res) {
  try {
    const { identifier, otpCode, newPassword } = req.validated.body;
    const result = await authService.resetPassword({ identifier, otpCode, newPassword });

    return ok(res, {
      message: 'Mot de passe reinitialise',
      data: result
    });
  } catch (error) {
    req.log.error(
      { error, action: 'auth.resetPassword', requestId: req.requestId, identifier: req.validated?.body?.identifier },
      'Failed to reset password'
    );
    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible de reinitialiser le mot de passe',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.validated.body;
    const result = await authService.changePassword({
      userId: req.user.id,
      currentPassword,
      newPassword
    });

    return ok(res, {
      message: 'Mot de passe modifie',
      data: result
    });
  } catch (error) {
    req.log.error(
      { error, action: 'auth.changePassword', requestId: req.requestId, userId: req.user?.id },
      'Failed to change password'
    );
    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible de changer le mot de passe',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export async function verifyEmail(req, res) {
  try {
    const { email, otpCode } = req.validated.body;
    const result = await authService.verifyEmail({ email, otpCode });

    return ok(res, {
      message: 'Email verifie',
      data: result
    });
  } catch (error) {
    req.log.error(
      { error, action: 'auth.verifyEmail', requestId: req.requestId, email: req.validated?.body?.email },
      'Failed to verify email'
    );
    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible de verifier l\'email',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}

export async function resendVerification(req, res) {
  try {
    const { identifier } = req.validated.body;
    const { code, phone, email } = await authService.resendVerification({ identifier });

    if (isBrevoConfigured()) {
      if (phone) {
        sendOtpSms({ phone, code, purpose: 'verification' }).catch(() => {});
      }
      if (email) {
        sendOtpEmail({ email, code, purpose: 'verification' }).catch(() => {});
      }
    }

    return ok(res, {
      message: isBrevoConfigured()
        ? 'Code de verification renvoye'
        : `Code genere (Brevo non configure) : ${code}`,
      data: isBrevoConfigured() ? { sent: true } : { code }
    });
  } catch (error) {
    req.log.error(
      { error, action: 'auth.resendVerification', requestId: req.requestId, identifier: req.validated?.body?.identifier },
      'Failed to resend verification'
    );
    return fail(res, {
      status: error.statusCode || 500,
      message: error.publicMessage || 'Impossible de renvoyer la verification',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || []
    });
  }
}
