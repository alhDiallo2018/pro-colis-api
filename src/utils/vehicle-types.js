import { ValidationError } from './errors.js';

export const VEHICLE_TYPES = Object.freeze([
  { value: 'motorcycle', label: 'Moto (2 roues)', aliases: ['moto', '2 roues', '2roues', 'motorbike', 'scooter'] },
  { value: 'truck', label: 'Camion', aliases: ['camion'] },
  { value: 'van', label: 'Fourgonnette', aliases: ['fourgonnette', 'fourgon'] },
  { value: 'tricycle', label: 'Tricycle', aliases: [] },
  { value: 'bus', label: 'Bus (Tata, horaire…)', aliases: ['tata', 'horaire', 'minibus', 'autobus'] },
  { value: 'gp', label: 'GP', aliases: [] }
]);

// Les anciennes saisies libres restent lisibles ; les nouvelles écritures
// utilisent des codes stables communs aux clients et aux filtres de recherche.
export function normalizeVehicleType(value, path = 'body.type') {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const type = VEHICLE_TYPES.find(t => t.value === text || t.aliases.includes(text));
  if (!type) throw new ValidationError([{ path, message: 'Choisissez moto, camion, fourgonnette, tricycle, bus ou GP' }]);
  return type.value;
}

export function vehicleTypeFilter(value) {
  const type = VEHICLE_TYPES.find(t => t.value === normalizeVehicleType(value, 'query.vehicleType'));
  return { OR: [type.value, ...type.aliases].map(name => ({ type: { equals: name, mode: 'insensitive' } })) };
}
