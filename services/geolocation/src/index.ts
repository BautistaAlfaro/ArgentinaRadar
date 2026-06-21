/**
 * Geolocation Engine — Main Entry
 *
 * Primary export: geolocate(text) → ExtractedLocation
 * Used by the REST API server and for direct programmatic use.
 *
 * Usage:
 *   import { geolocate } from './index.js';
 *   const loc = geolocate("Manifestación en Plaza de Mayo");
 *   console.log(loc); // { province: "CABA", city: "Buenos Aires", ... }
 */

import { extractLocation } from './extractor.js';

export { extractLocation as geolocate };
export type { ExtractedLocation } from './extractor.js';
export { scoreMatch } from './scorer.js';
export { matchTokens } from './matcher.js';
