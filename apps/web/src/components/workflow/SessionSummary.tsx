/**
 * SessionSummary — Night runner session dashboard component.
 *
 * Shows:
 *   - Current running session with animated progress bar
 *   - Elapsed time, ETA, articles per minute pace
 *   - Last 10 completed sessions in a stats table
 *
 * Endpoints:
 *   GET /api/admin/sessions
 *   GET /api/admin/sessions/current
 */

import { useQuery } from '@tanstack/react-query';
import { m as motion } from 'framer-motion';
import { API } from '@shared/apiConfig';

const ADMIN_API = API.admin;

// ── Types ──────────────────────────────────────────────────────────────

interface SessionSummary {
  id: number;
  started_at: string;
  ended_at: string | null;
  articles_processed: number;
  articles_published: number;
  articles_failed: number;
  images_generated: number;
  status: string;
}

interface CurrentSession extends SessionSummary {
  elapsed_minutes: number;
  elapsed_seconds: number;
  pace: number; // articles per minute
}

interface SessionsResponse {
  sessions: SessionSummary[];
}

interface CurrentSessionResponse {
  session: CurrentSession | null;
}

// ── Hooks ──────────────────────────────────────────────────────────────

function useSessions() {
  return useQuery<SessionsResponse>({
    queryKey: ['admin', 'sessions'],
    queryFn: async () => {
      const resp = await fetch(`${ADMIN_API}/api/admin/sessions`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
}

function useCurrentSession() {
  return useQuery<CurrentSessionResponse>({
    queryKey: ['admin', 'sessions', 'current'],
    queryFn: async () => {
      const resp = await fetch(`${ADMIN_API}/api/admin/sessions/current`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 10_000,
    staleTime: 2_000,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatDuration(minutes: number, seconds: number): string {
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('es-AR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Components ─────────────────────────────────────────────────────────

function CurrentSessionCard({ session }: { session: CurrentSession }) {
  const totalArticles = session.articles_processed || 0;
  const published = session.articles_published || 0;
  const failed = session.articles_failed || 0;
  const images = session.images_generated || 0;

  // Estimate completion progress — if pace > 0, estimate time remaining
  const estimatedTotal = published + failed;
  const progressPct = estimatedTotal > 0
    ? Math.min(100, Math.round((published / estimatedTotal) * 100))
    : 0;

  return (
    <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Sesión Actual #{session.id}
        </h3>
        <span className="text-[10px] font-mono text-slate-400">
          {formatDuration(session.elapsed_minutes, session.elapsed_seconds)}
        </span>
      </div>

      {/* Animated progress bar */}
      <div className="w-full h-2 bg-slate-700/50 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center">
          <div className="text-lg font-bold text-white">{totalArticles}</div>
          <div className="text-[9px] text-slate-500 font-mono">Procesados</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-emerald-400">{published}</div>
          <div className="text-[9px] text-slate-500 font-mono">Publicados</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-red-400">{failed}</div>
          <div className="text-[9px] text-slate-500 font-mono">Fallidos</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-sky-400">{images}</div>
          <div className="text-[9px] text-slate-500 font-mono">Imágenes</div>
        </div>
      </div>

      {/* Pace */}
      {session.pace > 0 && (
        <div className="text-[10px] font-mono text-slate-500 text-center">
          ~{session.pace} arts/min · {progressPct}% completado
        </div>
      )}
    </div>
  );
}

function SessionsTable({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-6 text-slate-500 text-sm">
        No hay sesiones registradas
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-slate-500 border-b border-slate-700/20">
            <th className="text-left py-2 px-1">#</th>
            <th className="text-left py-2 px-1">Inicio</th>
            <th className="text-center py-2 px-1">Proc.</th>
            <th className="text-center py-2 px-1">Pub.</th>
            <th className="text-center py-2 px-1">Fallos</th>
            <th className="text-center py-2 px-1">Imgs</th>
            <th className="text-center py-2 px-1">Estado</th>
          </tr>
        </thead>
        <tbody>
          {sessions.slice(0, 10).map((s) => (
            <tr
              key={s.id}
              className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors"
            >
              <td className="py-2 px-1 text-slate-400">{s.id}</td>
              <td className="py-2 px-1 text-slate-300">{formatDateTime(s.started_at)}</td>
              <td className="py-2 px-1 text-center text-white">{s.articles_processed}</td>
              <td className="py-2 px-1 text-center text-emerald-400">{s.articles_published}</td>
              <td className="py-2 px-1 text-center text-red-400">{s.articles_failed}</td>
              <td className="py-2 px-1 text-center text-sky-400">{s.images_generated}</td>
              <td className="py-2 px-1 text-center">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    s.status === 'running'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : s.status === 'completed'
                      ? 'bg-slate-600/30 text-slate-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {s.status === 'running' ? 'En curso' : s.status === 'completed' ? 'Completado' : 'Fallido'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function SessionSummary() {
  const { data: sessionsData, isLoading: sessionsLoading } = useSessions();
  const { data: currentData, isLoading: currentLoading } = useCurrentSession();

  const sessions = sessionsData?.sessions ?? [];
  const currentSession = currentData?.session ?? null;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-sky-400">
            history
          </span>
          Sesiones Nocturnas
        </h2>
        {currentLoading && (
          <span className="text-[10px] text-slate-500 font-mono animate-pulse">
            Cargando...
          </span>
        )}
      </div>

      {/* Current session */}
      {currentSession ? (
        <CurrentSessionCard session={currentSession} />
      ) : !currentLoading ? (
        <div className="bg-slate-800/20 border border-dashed border-slate-700/30 rounded-xl p-4 text-center">
          <span className="text-slate-500 text-xs">
            No hay sesión nocturna activa
          </span>
        </div>
      ) : null}

      {/* Previous sessions */}
      <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-3">
        <h3 className="text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-wider">
          Últimas sesiones
        </h3>
        {sessionsLoading ? (
          <div className="text-center py-4 text-slate-500 text-xs animate-pulse">
            Cargando sesiones...
          </div>
        ) : (
          <SessionsTable sessions={sessions} />
        )}
      </div>
    </div>
  );
}
