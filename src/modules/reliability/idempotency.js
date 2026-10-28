import { createHash } from "node:crypto";
import { ConflictError, ValidationError } from "../../utils/errors.js";

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export function requestFingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function validateRequestId(value) {
  if (value == null) return null; // Compatibilité avec les anciennes applications.
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ValidationError([
      { path: "requestId", message: "Identifiant de demande invalide" },
    ]);
  }
  return value;
}

// Le verrou transactionnel PostgreSQL protège plusieurs processus API, pas
// seulement une instance Node. Le résultat et l'opération sont commis ensemble.
// Une panne avant commit libère la clé ; après commit la reprise rend le résultat.
export async function once(tx, actorId, scope, requestId, payload, operation) {
  const key = validateRequestId(requestId);
  if (!key) return operation();
  const fingerprint = requestFingerprint(payload);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actorId}:${scope}:${key}`}, 0))`;
  const where = { actorId_scope_requestId: { actorId, scope, requestId: key } };
  const previous = await tx.operationRequest.findUnique({ where });
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new ConflictError(
        "Cette demande a déjà été envoyée avec un autre contenu. Reprenez la demande initiale.",
      );
    return previous.result;
  }
  const result = await operation();
  await tx.operationRequest.create({
    data: { actorId, scope, requestId: key, fingerprint, result },
  });
  return result;
}
