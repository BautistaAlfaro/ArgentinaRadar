/**
 * NLP Location Extraction Engine
 *
 * Tokenizes article title + summary and matches against the Argentine gazetteer.
 * Handles Spanish abbreviations and variations.
 *
 * Usage:
 *   const result = extractLocation("Manifestación en Plaza de Mayo en CABA");
 *   // → { province: "Ciudad Autónoma de Buenos Aires", city: "Buenos Aires",
 *   //     landmark: "Plaza de Mayo", lat: -34.608, lng: -58.372, confidence: 0.95 }
 */

import { scoreMatch } from './scorer.js';
import { matchTokens } from './matcher.js';

export interface ExtractedLocation {
  province: string;
  city: string | null;
  neighborhood: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
  confidence: number;
  label: string | null; // "Ubicación aproximada" for low confidence
}

/**
 * Extract location from article text.
 *
 * @param text — Combined article text (title + " " + summary) to analyze
 * @returns Structured location with coordinates and confidence
 */
export function extractLocation(text: string): ExtractedLocation {
  if (!text || text.trim().length === 0) {
    return {
      province: '',
      city: null,
      neighborhood: null,
      landmark: null,
      lat: -38.4,
      lng: -63.6,
      confidence: 0,
      label: 'Ubicación aproximada',
    };
  }

  // Attempt match against gazetteer
  const match = matchTokens(text);
  const confidence = scoreMatch(match);

  // Determine coordinates: landmark > city > province > default
  let lat: number;
  let lng: number;
  let label: string | null = null;

  if (match.matchType === 'landmark' && match.landmarkLatLng) {
    lat = match.landmarkLatLng.lat;
    lng = match.landmarkLatLng.lng;
  } else if (match.matchType === 'city' && match.cityLatLng) {
    lat = match.cityLatLng.lat;
    lng = match.cityLatLng.lng;
  } else if (match.matchType === 'province' || confidence > 0) {
    lat = match.provinceCentroid.lat;
    lng = match.provinceCentroid.lng;
    if (confidence < 0.5) {
      label = 'Ubicación aproximada';
    }
  } else {
    lat = -38.4;
    lng = -63.6;
    label = 'Ubicación aproximada';
  }

  if (confidence < 0.5 && !label) {
    label = 'Ubicación aproximada';
  }

  return {
    province: match.matchType !== 'none' ? match.province : '',
    city: match.city,
    neighborhood: null,
    landmark: match.landmark,
    lat,
    lng,
    confidence,
    label,
  };
}
