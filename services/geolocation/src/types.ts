/** TypeScript interfaces matching the gazetteer JSON structure. */

export interface GazetteerLandmark {
  name: string;
  lat: number;
  lng: number;
}

export interface GazetteerCity {
  name: string;
  shortName: string | null;
  lat: number;
  lng: number;
  population?: number;
  landmarks?: GazetteerLandmark[];
}

export interface GazetteerProvince {
  name: string;
  shortName: string | null;
  centroid: { lat: number; lng: number };
  region: string;
  cities: GazetteerCity[];
}

export interface Gazetteer {
  provinces: GazetteerProvince[];
}
