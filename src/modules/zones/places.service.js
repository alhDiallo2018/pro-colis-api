import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

function unavailable(providerStatus) {
  const error = new AppError('La recherche de lieux est temporairement indisponible. Réessayez dans un instant.', {
    statusCode: 503, code: 'PLACES_UNAVAILABLE'
  });
  // Seul un statut technique est journalisé, jamais la réponse ou l'URL Google.
  error.providerStatus = providerStatus;
  return error;
}

/** Ne jamais propager une URL Google ou son corps d'erreur : ils peuvent
 * contenir la clé serveur. Le contrôleur journalise seulement l'erreur sûre. */
async function googleRequest(url, options = {}) {
  if (!env.GOOGLE_MAPS_API_KEY) throw unavailable('NOT_CONFIGURED');
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw unavailable(response.status);
    const data = await response.json();
    if (data.error || (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status))) throw unavailable('PROVIDER_REJECTED');
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable(error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR');
  }
}

export async function autocomplete(input, sessionToken) {
  const data = await googleRequest('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY },
    // Aucun filtre pays/type ni restriction de rayon : villes, quartiers,
    // adresses et repères du monde entier restent recherchables.
    body: JSON.stringify({ input, languageCode: 'fr', sessionToken })
  });
  return (data.suggestions ?? []).flatMap(({ placePrediction: p }) => p ? [{
    place_id: p.placeId,
    description: p.text?.text ?? '',
    structured_formatting: {
      main_text: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary_text: p.structuredFormat?.secondaryText?.text ?? ''
    }
  }] : []);
}

export async function placeDetails(placeId, sessionToken) {
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set('languageCode', 'fr');
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
  const place = await googleRequest(url, {
    headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,addressComponents,location' }
  });
  // Contrat commun conservé pour les parseurs d'adresses web et Flutter,
  // indépendamment du format camelCase de Places API (New).
  return {
    place_id: place.id,
    name: place.displayName?.text,
    formatted_address: place.formattedAddress,
    address_components: (place.addressComponents ?? []).map(c => ({
      long_name: c.longText, short_name: c.shortText, types: c.types
    })),
    geometry: { location: { lat: place.location?.latitude, lng: place.location?.longitude } }
  };
}

export async function reverseGeocode(latitude, longitude) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.search = new URLSearchParams({ latlng: `${latitude},${longitude}`, language: 'fr', key: env.GOOGLE_MAPS_API_KEY });
  const data = await googleRequest(url);
  const first = data.results?.[0];
  if (!first) return null;
  // L'adresse décrit le point touché ; sa géométrie Google ne doit jamais
  // déplacer ce point vers le centre d'une rue ou d'une commune.
  return { ...first, geometry: { location: { lat: latitude, lng: longitude } } };
}
