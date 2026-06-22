/**
 * ServiceCards — Health status cards for critical backend services.
 *
 * Checks each service by hitting its /health endpoint and shows
 * a green/red status indicator with port info.
 */

import { LazyMotion, domAnimation, m as motion } from 'framer-motion';

interface ServiceInfo {
  name: string;
  port: number;
  status: 'up' | 'down';
  label: string;
}

interface ServiceCardsProps {
  services: ServiceInfo[] | null;
  isLoading: boolean;
}

const SERVICE_ICONS: Record<string, string> = {
  rss:      'rss_feed',
  ai:       'psychology',
  bluesky:  'flutter_dash',
  telegram: 'send',
};

function capitalize(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function ServiceCard({ svc, index }: { svc: ServiceInfo; index: number }) {
  const isUp = svc.status === 'up';
  const icon = SERVICE_ICONS[svc.name] ?? 'settings';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className={`
        relative rounded-xl border p-4 transition-all duration-200
        ${isUp
          ? 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40'
          : 'border-red-500/20 bg-red-500/5 hover:border-red-500/40'
        }
      `}
    >
      <div className="flex items-start gap-3">
        {/* Status dot */}
        <div className="relative mt-1">
          <span
            className={`block w-3 h-3 rounded-full ${
              isUp
                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
                : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
            }`}
          />
          {/* Pulse ring for up services */}
          {isUp && (
            <span className="absolute inset-0 w-3 h-3 rounded-full bg-emerald-500 animate-ping opacity-30" />
          )}
        </div>

        {/* Icon */}
        <span className="material-symbols-outlined text-xl shrink-0 text-primary" aria-hidden="true">{icon}</span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-200 truncate">
            {svc.label}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {svc.port > 0 && (
              <span className="text-[11px] text-slate-500 font-mono">
                :{svc.port}
              </span>
            )}
            <span
              className={`text-[11px] font-medium ${
                isUp ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {isUp ? '● ONLINE' : '○ OFFLINE'}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ServiceCards({ services, isLoading }: ServiceCardsProps) {
  if (isLoading) {
    return <div className="flex gap-1.5"><div className="w-16 h-5 bg-slate-700/30 rounded animate-pulse" /></div>;
  }

  if (!services || services.length === 0) return null;

  const upCount = services.filter((s) => s.status === 'up').length;

  const SVC_ICONS: Record<string, string> = {
    'news-ingestion': '📡', 'publisher': '🚀', 'ai-processor': '🧠',
    'admin': '⚙️', 'web': '🌐', 'ollama': '🦙',
  };
  const SVC_LABEL: Record<string, string> = {
    'news-ingestion': 'News', 'publisher': 'Pub', 'ai-processor': 'AI',
    'admin': 'Admin', 'web': 'Web', 'ollama': 'Ollama',
  };

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-slate-500">{upCount}/{services.length}</span>
      {services.map((svc) => (
        <span key={svc.name}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px]
            ${svc.status === 'up' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' : 'border-red-500/20 bg-red-500/5 text-red-400'}`}
        >
          <span className={`w-1 h-1 rounded-full ${svc.status === 'up' ? 'bg-emerald-400' : 'bg-red-500'}`} />
          <span>{SVC_ICONS[svc.name] || '•'}</span>
          <span>{SVC_LABEL[svc.name] || svc.name}</span>
        </span>
      ))}
    </span>
  );
}
