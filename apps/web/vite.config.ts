import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

/** Small plugin to import .geojson files as JSON modules */
function geojsonPlugin() {
  const fileRegex = /\.geojson$/;
  return {
    name: 'vite-plugin-geojson',
    transform(code: string, id: string) {
      if (fileRegex.test(id)) {
        try {
          JSON.parse(code);
          return { code: `export default ${code}`, map: null };
        } catch {
          return null;
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), geojsonPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../shared'),
    },
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
      process.env.VITE_API_BASE_URL || 'http://localhost',
    ),
  },
  server: {
    port: 5173,
    host: true,
  },
});
