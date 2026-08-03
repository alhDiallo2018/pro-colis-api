export class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details = [] } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.publicMessage = message;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentification requise') {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acces refuse') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Ressource introuvable') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflit de donnees') {
    super(message, { statusCode: 409, code: 'CONFLICT' });
  }
}

export class ValidationError extends AppError {
  constructor(details = [], message = 'Donnees invalides') {
    super(message, { statusCode: 422, code: 'VALIDATION_ERROR', details });
  }
}

export class InvalidObservabilityQueryError extends AppError {
  constructor(message = 'Filtres d observabilite invalides', details = []) {
    super(message, {
      statusCode: 400,
      code: 'INVALID_OBSERVABILITY_QUERY',
      details
    });
  }
}

export class ObservabilityUnavailableError extends AppError {
  constructor(message = 'Service d observabilite indisponible') {
    super(message, {
      statusCode: 503,
      code: 'OBSERVABILITY_UNAVAILABLE'
    });
  }
}

/**
 * Translate low-level errors (mainly Prisma) into a client-friendly AppError.
 * Returns the original error if it is already an AppError, or null when the
 * error is unknown (caller falls back to a generic 500).
 */
export function normalizeError(error) {
  if (error instanceof AppError) return error;

  // Constraint / lookup failures from the database.
  if (error?.name === 'PrismaClientKnownRequestError') {
    const meta = error.meta || {};
    if (error.code === 'P2002') {
      const fields = Array.isArray(meta.target) ? meta.target.join(', ') : meta.target;
      return new ConflictError(fields ? `Valeur deja utilisee : ${fields}` : 'Cette valeur existe deja');
    }
    if (error.code === 'P2003') {
      const field = meta.field_name || meta.constraint;
      return new ValidationError(
        field ? [{ path: String(field), message: 'Reference introuvable' }] : [],
        'Reference invalide (zone, chauffeur ou colis introuvable)'
      );
    }
    if (error.code === 'P2025') {
      return new NotFoundError(typeof meta.cause === 'string' ? meta.cause : 'Ressource introuvable');
    }
  }

  // Wrong type, unknown field, or invalid enum value (e.g. type "food").
  if (error?.name === 'PrismaClientValidationError') {
    const argMatch = error.message?.match(/(?:Unknown argument|Invalid value for argument|Argument)\s+`([^`]+)`/);
    const field = argMatch?.[1];
    return new ValidationError(
      field ? [{ path: field, message: 'Valeur non autorisee pour ce champ' }] : [],
      field ? `Champ « ${field} » invalide` : 'Donnees invalides'
    );
  }

  return null;
}
