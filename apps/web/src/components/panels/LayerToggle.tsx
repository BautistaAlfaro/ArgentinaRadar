import { useRadarStore, type LayerId } from '../../stores/radarStore';

const LAYER_DEFINITIONS: { id: LayerId; label: string; description: string }[] = [
  { id: 'provinces', label: 'Provincias', description: 'Límites provinciales' },
  { id: 'news', label: 'Noticias', description: 'Marcadores de noticias' },
  { id: 'weather', label: 'Clima', description: 'Alertas meteorológicas' },
  { id: 'economic', label: 'Económico', description: 'Indicadores económicos' },
  { id: 'alerts', label: 'Alertas', description: 'Alertas de emergencia' },
  { id: 'infrastructure', label: 'Infraestructura', description: 'Gasoductos, puertos, represas' },
  { id: 'flights', label: 'Vuelos', description: 'Tráfico aéreo en vivo' },
];

export function LayerToggle() {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const toggleLayer = useRadarStore((s) => s.toggleLayer);

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
        Capas del Mapa
      </h2>

      <div className="space-y-2">
        {LAYER_DEFINITIONS.map((layer) => {
          const isActive = activeLayers.has(layer.id);

          return (
            <label
              key={layer.id}
              className="flex items-start gap-3 p-2 rounded-md hover:bg-slate-700/40 transition-colors cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={isActive}
                onChange={() => toggleLayer(layer.id)}
                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-2 focus:ring-blue-500/30 cursor-pointer"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                  {layer.label}
                </span>
                <span className="text-xs text-slate-500">
                  {layer.description}
                </span>
              </div>
            </label>
          );
        })}
      </div>

      {/* Legend for provinces layer */}
      <div className="mt-6 pt-4 border-t border-slate-700/50">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Leyenda
        </h3>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block w-4 h-2 rounded bg-blue-500/30 border border-blue-400/50" />
          <span>Provincias (al hacer clic selecciona)</span>
        </div>
      </div>
    </div>
  );
}
