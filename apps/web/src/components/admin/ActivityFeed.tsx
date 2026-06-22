/**
 * ActivityFeed — Recent articles list with status, source, category badge, and timestamp.
 *
 * Shows the last 20 ingested articles with relative timestamps and visual indicators.
 */

import { LazyMotion, domAnimation, m as motion } from 'framer-motion';

interface ActivityItem {
  id: string;
  title: string;
  source: string;
  category: string | null;
  status: string;
  publishedAt: string | null;
  ingestedAt: string;
}

interface ActivityFeedProps {
  items: ActivityItem[] | null;
  isLoading: boolean;
}

// ─── Status config ───────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; icon: string }> = {
  ingested:        { color: 'text-sky-400',   icon: 'download' },
  geolocated:      { color: 'text-amber-400',  icon: 'location_on' },
  filtered:        { color: 'text-blue-400',   icon: 'psychology' },
  pending_approval:{ color: 'text-violet-400', icon: 'pending_actions' },
  published:       { color: 'text-emerald-400',icon: 'check_circle' },
  discarded:       { color: 'text-red-400',    icon: 'delete' },
};

const DEFAULT_STATUS = { color: 'text-slate-400', icon: 'description' };

// ─── Helpers ─────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min}min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

function truncate(title: string, max = 55): string {
  if (title.length <= max) return title;
  return title.slice(0, max) + '…';
}

// ─── Sub-component ───────────────────────────────────────────────────

function ActivityRow({ item, index }: { item: ActivityItem; index: number }) {
  const sc = STATUS_CONFIG[item.status] ?? DEFAULT_STATUS;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.02 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700/30 transition-colors group"
    >
      {/* Status icon */}
      <span className="material-symbols-outlined text-base shrink-0" aria-hidden="true">{sc.icon}</span>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate group-hover:text-white transition-colors" title={item.title}>
          {truncate(item.title)}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-slate-500">{item.source}</span>
          <span className="text-[9px] text-slate-600">·</span>
          <span className={`text-[11px] font-medium capitalize ${sc.color}`}>
            {item.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Category badge */}
      {item.category && (
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 capitalize shrink-0">
          {item.category}
        </span>
      )}

      {/* Timestamp */}
      <span className="text-[11px] text-slate-600 shrink-0 font-mono">
        {timeAgo(item.ingestedAt)}
      </span>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export function ActivityFeed({ items, isLoading }: ActivityFeedProps) {
  if (isLoading) {
    return (
      <section className="glass-panel rounded-xl p-5">
        <div className="h-5 w-32 bg-slate-700 rounded animate-pulse mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <div className="w-5 h-5 bg-slate-700 rounded animate-pulse" />
              <div className="flex-1">
                <div className="h-4 bg-slate-700 rounded animate-pulse w-full mb-1" />
                <div className="h-3 bg-slate-700/30 rounded animate-pulse w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!items || items.length === 0) {
    return (
      <section className="glass-panel rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-400 mb-3">Recent Activity</h3>
        <p className="text-xs text-slate-500">No recent articles found.</p>
      </section>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-xl p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white tracking-tight">
            Recent Activity
          </h3>
          <span className="text-[11px] text-slate-500">{Math.min(items.length, 5)} de {items.length}</span>
        </div>

        <div className="divide-y divide-slate-700/30">
          {items.slice(0, 5).map((item, idx) => (
            <ActivityRow key={item.id} item={item} index={idx} />
          ))}
        </div>
      </motion.section>
    </LazyMotion>
  );
}
