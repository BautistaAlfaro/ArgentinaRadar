/**
 * Gazetteer matcher — matches extracted tokens against the Argentine gazetteer.
 *
 * Priority: landmark > city > province.
 * All variations and abbreviations are handled via lookup maps, not token expansion.
 */

import fs from 'fs';
import path from 'path';
import type { Gazetteer, GazetteerProvince, GazetteerCity, GazetteerLandmark } from './types.js';

const GAZETTEER_PATH = path.resolve(process.cwd(), 'shared', 'gazetteer', 'argentina.json');

let _gazetteer: Gazetteer | null = null;

function getGazetteer(): Gazetteer {
  if (_gazetteer) return _gazetteer;
  const raw = fs.readFileSync(GAZETTEER_PATH, 'utf-8');
  _gazetteer = JSON.parse(raw) as Gazetteer;
  return _gazetteer;
}

export interface MatchResult {
  province: string;
  provinceCentroid: { lat: number; lng: number };
  city: string | null;
  cityLatLng: { lat: number; lng: number } | null;
  landmark: string | null;
  landmarkLatLng: { lat: number; lng: number } | null;
  matchType: 'landmark' | 'city' | 'province' | 'none';
}

/**
 * Global lookup maps built lazily from the gazetteer.
 * Each entry is keyed by a normalized name (all lowercase).
 */
interface CityEntry { province: GazetteerProvince; city: GazetteerCity }
interface LandmarkEntry { province: GazetteerProvince; city: GazetteerCity; landmark: GazetteerLandmark }

let _cityMap: Map<string, CityEntry> | null = null;
let _landmarkMap: Map<string, LandmarkEntry> | null = null;
let _provinceMap: Map<string, GazetteerProvince> | null = null;

/** Additional aliases for cities (abbreviations, alternate names). */
const CITY_ALIASES: Record<string, string> = {
  caba: 'Buenos Aires',
  'bs as': 'Buenos Aires',
  'bs.as': 'Buenos Aires',
  'capital federal': 'Buenos Aires',
  'capital': 'Buenos Aires',
  'city': 'Buenos Aires',
  'city porteña': 'Buenos Aires',
  'porteña': 'Buenos Aires',
  cba: 'Córdoba',
  mza: 'Mendoza',
  nqn: 'Neuquén',
  tucumán: 'San Miguel de Tucumán',
  tuc: 'San Miguel de Tucumán',
  jujuy: 'San Salvador de Jujuy',
  catamarca: 'San Fernando del Valle de Catamarca',
  bariloche: 'San Carlos de Bariloche',
  'san nicolás': 'San Nicolás de los Arroyos',
  'san nicolas': 'San Nicolás de los Arroyos',
  uruguay: 'Concepción del Uruguay',
  mdq: 'Mar del Plata',
  mdp: 'Mar del Plata',
};

/** Additional aliases for provinces. */
const PROVINCE_ALIASES: Record<string, string> = {
  caba: 'Ciudad Autónoma de Buenos Aires',
  'capital federal': 'Ciudad Autónoma de Buenos Aires',
  'bs as': 'Buenos Aires',
  'bs.as': 'Buenos Aires',
  cba: 'Córdoba',
  mza: 'Mendoza',
  nqn: 'Neuquén',
  sgo: 'Santiago del Estero',
  tdf: 'Tierra del Fuego',
};

function buildLookupMaps(): {
  cityMap: Map<string, CityEntry>;
  landmarkMap: Map<string, LandmarkEntry>;
  provinceMap: Map<string, GazetteerProvince>;
} {
  if (_cityMap && _landmarkMap && _provinceMap) {
    return { cityMap: _cityMap, landmarkMap: _landmarkMap, provinceMap: _provinceMap };
  }

  const data = getGazetteer();
  const cityMap = new Map<string, CityEntry>();
  const landmarkMap = new Map<string, LandmarkEntry>();
  const provinceMap = new Map<string, GazetteerProvince>();

  for (const province of data.provinces) {
    // Province entries
    provinceMap.set(province.name.toLowerCase(), province);
    if (province.shortName?.toLowerCase()) {
      provinceMap.set(province.shortName.toLowerCase(), province);
    }

    for (const city of province.cities) {
      // City entries
      cityMap.set(city.name.toLowerCase(), { province, city });
      if (city.shortName) {
        cityMap.set(city.shortName.toLowerCase(), { province, city });
      }

      // Landmark entries
      if (city.landmarks) {
        for (const lm of city.landmarks) {
          landmarkMap.set(lm.name.toLowerCase(), { province, city, landmark: lm });
        }
      }
    }
  }

  // Add city aliases
  for (const [alias, canonical] of Object.entries(CITY_ALIASES)) {
    const entry = cityMap.get(canonical.toLowerCase());
    if (entry) {
      cityMap.set(alias.toLowerCase(), entry);
    }
  }

  // Add province aliases
  for (const [alias, canonical] of Object.entries(PROVINCE_ALIASES)) {
    const entry = provinceMap.get(canonical.toLowerCase());
    if (entry) {
      provinceMap.set(alias.toLowerCase(), entry);
    }
  }

  _cityMap = cityMap;
  _landmarkMap = landmarkMap;
  _provinceMap = provinceMap;

  return { cityMap, landmarkMap, provinceMap };
}

/** Stop words to skip for single-token location candidates. */
const STOP_WORDS = new Set([
  'a', 'al', 'ante', 'bajo', 'con', 'contra', 'de', 'del', 'desde', 'durante',
  'en', 'entre', 'hacia', 'hasta', 'la', 'las', 'el', 'los', 'lo', 'le', 'les',
  'para', 'por', 'según', 'sin', 'sobre', 'tras', 'y', 'e', 'o', 'u', 'ni',
  'que', 'como', 'más', 'pero', 'su', 'sus', 'un', 'una', 'se', 'no',
]);

/**
 * Tokenize text: lowercase, split on punctuation/whitespace.
 * Keeps ALL tokens for n-gram matching of multi-word names.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[¿?!¡;:.,()\[\]{}"''–—·•…/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
}

/**
 * Build n-grams without removing stop words first,
 * so multi-word names like "la plata", "san miguel de tucumán" are preserved.
 * Unigrams are filtered (stop words + short words removed), but
 * bigrams/trigrams/4-grams include all original tokens.
 */
function extractNgrams(tokens: string[]): string[] {
  const ngrams: string[] = [];
  // Unigrams: only keep actual location candidates
  for (const t of tokens) {
    if (t.length >= 3 && !STOP_WORDS.has(t) && /^[a-záéíóúñü0-9]+$/.test(t)) {
      ngrams.push(t);
    }
  }
  // Bigrams
  for (let i = 0; i < tokens.length - 1; i++) {
    ngrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  // Trigrams
  for (let i = 0; i < tokens.length - 2; i++) {
    ngrams.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  // 4-grams (for longer names like "san nicolás de los arroyos")
  for (let i = 0; i < tokens.length - 3; i++) {
    ngrams.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]} ${tokens[i + 3]}`);
  }
  return ngrams;
}

/**
 * Match text against the gazetteer.
 */
export function matchTokens(text: string): MatchResult {
  const { cityMap, landmarkMap, provinceMap } = buildLookupMaps();
  const rawTokens = tokenize(text);
  const ngrams = extractNgrams(rawTokens);

  // Priority 1: Landmark match (via direct substring in raw text)
  // This catches landmarks even when they span punctuation
  const lowerText = text.toLowerCase();
  const landmarkResults: Array<{ ng: string; entry: LandmarkEntry }> = [];

  for (const [key, entry] of landmarkMap.entries()) {
    if (lowerText.includes(key)) {
      landmarkResults.push({ ng: key, entry });
    }
  }

  // Pick the longest matching landmark (most specific)
  if (landmarkResults.length > 0) {
    landmarkResults.sort((a, b) => b.ng.length - a.ng.length);
    const best = landmarkResults[0];
    return {
      province: best.entry.province.name,
      provinceCentroid: best.entry.province.centroid,
      city: best.entry.city.name,
      cityLatLng: { lat: best.entry.city.lat, lng: best.entry.city.lng },
      landmark: best.entry.landmark.name,
      landmarkLatLng: { lat: best.entry.landmark.lat, lng: best.entry.landmark.lng },
      matchType: 'landmark',
    };
  }

  // Priority 2: City match via n-grams
  for (const ng of ngrams) {
    const city = cityMap.get(ng);
    if (city) {
      return {
        province: city.province.name,
        provinceCentroid: city.province.centroid,
        city: city.city.name,
        cityLatLng: { lat: city.city.lat, lng: city.city.lng },
        landmark: null,
        landmarkLatLng: null,
        matchType: 'city',
      };
    }
  }

  // Priority 3: Province match via n-grams
  for (const ng of ngrams) {
    const prov = provinceMap.get(ng);
    if (prov) {
      return {
        province: prov.name,
        provinceCentroid: prov.centroid,
        city: null,
        cityLatLng: null,
        landmark: null,
        landmarkLatLng: null,
        matchType: 'province',
      };
    }
  }

  // No match — return default Argentina centroid
  return {
    province: '',
    provinceCentroid: { lat: -38.4, lng: -63.6 },
    city: null,
    cityLatLng: null,
    landmark: null,
    landmarkLatLng: null,
    matchType: 'none',
  };
}
