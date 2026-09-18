/**
 * Retourne un vrai libellé géographique ou `null` pour les valeurs purement
 * techniques produites par d'anciens clients (position générique ou lat/lng).
 */
export function meaningfulLocationLabel(value) {
  if (value === undefined || value === null) return null;
  const label = String(value).trim();
  if (!label) return null;

  const normalized = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (['ma position', 'position actuelle', 'current location'].includes(normalized)) return null;

  const coordinateOnly = /^[-+]?\d{1,3}(?:[.,]\d+)?\s*[,;]\s*[-+]?\d{1,3}(?:[.,]\d+)?$/;
  return coordinateOnly.test(label) ? null : label;
}
