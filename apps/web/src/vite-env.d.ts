/// <reference types="vite/client" />

declare module '*.geojson' {
  const value: Record<string, unknown>;
  export default value;
}
