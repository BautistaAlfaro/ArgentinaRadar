import { useRadarStore, type LayerId } from '../../stores/radarStore';

const LAYER_DEFINITIONS: { id: LayerId; label: string; description: string }[] = [
  { id: 'provinces', label: 'Provincias', description: 'Límites provinciales' },
  { id: 'borders', label: 'Países', description: 'Fronteras de Sudamérica y Antártida Argentina' },
  { id: 'news', label: 'Noticias', description: 'Marcadores de noticias' },
  { id: 'events', label: 'Eventos', description: 'Eventos agrupados por tema e impacto' },
  { id: 'weather', label: 'Clima', description: 'Alertas meteorológicas' },
  { id: 'earthquakes', label: 'Sismos', description: 'Terremotos activos (USGS)' },
  { id: 'fires', label: 'Incendios', description: 'Focos de calor (NASA FIRMS)' },
  { id: 'economic', label: 'Económico', description: 'Indicadores económicos' },
  { id: 'alerts', label: 'Alertas', description: 'Alertas de emergencia' },
  { id: 'infrastructure', label: 'Infraestructura', description: 'Gasoductos, puertos, represas' },
  { id: 'flights', label: 'Vuelos', description: 'Tráfico aéreo en vivo' },
  { id: 'security', label: 'Inseguridad', description: 'Estadísticas de seguridad por provincia' },
  { id: 'protests', label: 'Protestas 🚧', description: 'Cortes y manifestaciones activos' },
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

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-slate-700/50">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Leyenda
        </h3>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-4 h-2 rounded bg-blue-500/30 border border-blue-400/50" />
            <span>Provincias</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-6 h-0 border-t border-dashed border-slate-400" />
            <span>Fronteras internacionales</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-4 h-4 rounded-sm bg-blue-400/20 border border-blue-400/50" />
            <span>Antártida Argentina (reclamo)</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-2 h-2 rounded-sm bg-amber-400/40 border border-amber-400/60" />
            <span>Islas Malvinas</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-yellow-400/40 border border-yellow-400/60" />
            <span>Alerta amarilla</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-orange-500/40 border border-orange-500/60" />
            <span>Alerta naranja</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-red-500/40 border border-red-500/60" />
            <span>Alerta roja</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-green-400" />
            <span>Sismo M3–4.9</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-amber-400" />
            <span>Sismo M5–6.9</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-red-400" />
            <span>Sismo M7+</span>
          </div>
          {/* Protest legend */}
          <div className="mt-3 pt-2 border-t border-slate-700/30">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Protestas</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#ef4444' }} />
            <span>Corte total</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#f97316' }} />
            <span>Corte parcial</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#eab308' }} />
            <span>Marcha</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#3b82f6' }} />
            <span>Piquete</span>
          </div>
        </div>
      </div>
    </div>
  );
}
