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

/**
 * Dette de commission impayée : le chauffeur ne peut plus accepter de nouveau
 * colis tant que `commissionDebt` n'est pas réglé. Expose un code stable et le
 * montant dû afin que le mobile affiche un message métier explicite.
 */
export class CommissionDebtRequiredError extends AppError {
  constructor(debtAmount) {
    const amount = Number(debtAmount || 0);
    super(
      `Vous avez une dette de commission de ${amount} FCFA. Veuillez la régler avant d'accepter un nouveau colis.`,
      {
        statusCode: 403,
        code: 'COMMISSION_DEBT_REQUIRED',
        details: [{ path: 'commissionDebt', message: `Dette impayée : ${amount} FCFA` }]
      }
    );
    this.commissionDebt = amount;
  }
}

/**
 * Le plafond de dette configuré (`commission.debtLimit`) serait dépassé par la
 * création d'une nouvelle dette.
 */
export class DebtLimitExceededError extends AppError {
  constructor(message = 'Plafond de commission impayée atteint. Régularisez votre dette avant toute nouvelle livraison.') {
    super(message, { statusCode: 409, code: 'DEBT_LIMIT_EXCEEDED' });
  }
}

/**
 * L'annulation n'est plus autorisée pour ce colis (statut livré, ou le statut
 * courant n'appartient pas aux statuts autorisés par la configuration).
 */
export class CancellationNotAllowedError extends AppError {
  constructor(message = "Ce colis ne peut plus être annulé à ce stade.") {
    super(message, { statusCode: 409, code: 'CANCELLATION_NOT_ALLOWED' });
  }
}

/**
 * Le colis est déjà annulé : toute tentative supplémentaire (double clic,
 * rejeu réseau) est rejetée sans écrire la moindre donnée financière.
 */
export class ParcelAlreadyCancelledError extends AppError {
  constructor(message = 'Ce colis a déjà été annulé.') {
    super(message, { statusCode: 409, code: 'PARCEL_ALREADY_CANCELLED' });
  }
}

/**
 * Une règle d'annulation requise est absente ou invalide dans la configuration
 * (ex. responsabilité partagée sans clé de répartition). Le serveur refuse
 * d'inventer une valeur financière.
 */
export class CancellationConfigurationError extends AppError {
  constructor(message = 'Règle d’annulation manquante ou invalide dans la configuration.') {
    super(message, { statusCode: 500, code: 'CONFIGURATION_ERROR' });
  }
}

/**
 * Le motif d'annulation fourni est absent ou ne correspond à aucun motif
 * configuré (`cancellation.reasons`). Plutôt que de retomber sur une valeur
 * exonérante, le serveur refuse l'annulation : la responsabilité ne doit
 * jamais être contournée par un `reason` inconnu ou vide.
 */
export class InvalidCancellationReasonError extends AppError {
  constructor(message = 'Motif d’annulation manquant ou invalide.') {
    super(message, { statusCode: 422, code: 'CANCELLATION_REASON_REQUIRED' });
  }
}

/**
 * Un motif exonérant (`force_majeure`, `platform_issue`, ou tout motif configuré
 * avec `responsibility=exempt`) est réservé au support/admin. Un CLIENT ou un
 * DRIVER qui tente de l'utiliser directement (même en appelant l'API) est rejeté
 * ici : l'auto-exonération est impossible. La voie d'exonération structurelle
 * (annulation à un stade libre, sans motif) reste autorisée.
 */
export class CancellationExemptReasonForbiddenError extends AppError {
  constructor(message = 'Ce motif d’annulation est réservé au support.') {
    super(message, { statusCode: 403, code: 'CANCELLATION_EXEMPT_REASON_FORBIDDEN' });
  }
}

/**
 * Le client a atteint le seuil configuré (`cancellation.clientDebtLimit`) de
 * pénalités d'annulation impayées. Créer un nouveau colis lui est refusé tant
 * que sa dette n'est pas réglée. Expose le montant dû pour un message métier.
 */
export class CancellationDebtLimitExceededError extends AppError {
  constructor(debtAmount) {
    const amount = Number(debtAmount || 0);
    super(
      `Vous avez ${amount} FCFA de pénalités d'annulation impayées. Veuillez les régler avant de créer un nouveau colis.`,
      {
        statusCode: 403,
        code: 'CANCELLATION_DEBT_LIMIT_EXCEEDED',
        details: [{ path: 'clientDebt', message: `Pénalités impayées : ${amount} FCFA` }]
      }
    );
    this.clientDebt = amount;
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
