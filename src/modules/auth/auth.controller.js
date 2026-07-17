import { ok, fail } from '../../utils/api-response.js';
import { serializeUser } from '../../utils/user-serializer.js';
import * as authService from './auth.service.js';
import { sendOtpSms, sendOtpEmail, isBrevoConfigured } from '../../utils/brevo.js';

export async function register(req, res) {
  try {
    // Critical flow: writes user, score and audit data, so errors are logged with request context.
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
    // PIN authentication is sensitive: never log the submitted PIN or token values.
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
