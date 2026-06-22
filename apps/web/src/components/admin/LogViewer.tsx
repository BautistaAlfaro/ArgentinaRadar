/**
 * LogViewer — Structured log viewer for the admin dashboard.
 *
 * Fetches logs from the news-ingestion API with filtering by service,
 * level, and text search. Auto-refreshes every 5 seconds with
 * color-coded log levels and pagination.
 */

import { API } from '@shared/apiConfig';
import { useEffect, useRef, useReducer, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────

interface LogEntry {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
  data: string | null;
}

interface LogsResponse {
  items: LogEntry[];
  total: number;
  limit: number;
  offset: number;
  services: string[];
}

// ─── Color map ─────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<string, { bg: string; text: string; badge: string }> = {
  debug: { bg: 'bg-slate-700/40', text: 'text-cyan-300', badge: 'bg-cyan-700/60 text-cyan-200' },
  info:  { bg: 'bg-slate-700/20', text: 'text-green-300', badge: 'bg-green-700/60 text-green-200' },
  warn:  { bg: 'bg-amber-900/20', text: 'text-amber-300', badge: 'bg-amber-700/60 text-amber-200' },
  error: { bg: 'bg-red-900/30',  text: 'text-red-300',   badge: 'bg-red-700/60 text-red-200' },
};

const LEVEL_BADGE_LABELS: Record<string, string> = {
  debug: 'DEBUG',
  info:  'INFO',
  warn:  'WARN',
  error: 'ERROR',
};

// ─── API ───────────────────────────────────────────────────────────────

const NEWS_SERVICE_API = API.news;

// ─── Helpers (module scope — stable, no re-render cost) ────────────────

function formatTimestamp(ts: string): string {
  const d = new Date(ts + 'Z');
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: 'numeric',
    month: 'short',
  });
}

function renderData(data: string | null): string {
  if (!data) return '';
  try {
    const parsed = JSON.parse(data);
    return JSON.stringify(parsed);
  } catch {
    return data;
  }
}

async function fetchLogs(params: {
  service?: string;
  level?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<LogsResponse> {
  const query = new URLSearchParams();
  if (params.service) query.set('service', params.service);
  if (params.level) query.set('level', params.level);
  if (params.search) query.set('search', params.search);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));

  const resp = await fetch(`${NEWS_SERVICE_API}/api/admin/logs?${query.toString()}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    return { items: [], total: 0, limit: 50, offset: 0, services: [] };
  }
  return resp.json();
}

// ─── Sub-components ─────────────────────────────────────────────────────

function LogDataCell({ data }: { data: string | null }) {
  const text = renderData(data);
  return (
    <td className="px-4 py-2 text-slate-500 font-mono text-xs truncate max-w-[200px]" title={text}>
      {text}
    </td>
  );
}

// ─── Reducer ─────────────────────────────────────────────────────────

interface LogViewerState {
  logs: LogEntry[];
  total: number;
  services: string[];
  filterService: string;
  filterLevel: string;
  search: string;
  page: number;
  autoRefresh: boolean;
}

type LogViewerAction =
  | { type: 'SET_RESULT'; items: LogEntry[]; total: number; services: string[] }
  | { type: 'SET_FILTER'; filter: { service?: string; level?: string; search?: string } }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'TOGGLE_AUTO_REFRESH' };

function logViewerReducer(state: LogViewerState, action: LogViewerAction): LogViewerState {
  switch (action.type) {
    case 'SET_RESULT':
      return {
        ...state,
        logs: action.items,
        total: action.total,
        services: action.services.length > 0 ? action.services : state.services,
      };
    case 'SET_FILTER':
      return {
        ...state,
        filterService: action.filter.service ?? state.filterService,
        filterLevel: action.filter.level ?? state.filterLevel,
        search: action.filter.search ?? state.search,
        page: 0,
      };
    case 'SET_PAGE':
      return { ...state, page: action.page };
    case 'TOGGLE_AUTO_REFRESH':
      return { ...state, autoRefresh: !state.autoRefresh };
  }
}

// ─── Component ─────────────────────────────────────────────────────────

interface LogViewerProps {
  limit?: number;
  compact?: boolean;
}

export function LogViewer({ limit = 50 }: LogViewerProps) {
  const [state, dispatch] = useReducer(logViewerReducer, {
    logs: [],
    total: 0,
    services: [],
    filterService: '',
    filterLevel: '',
    search: '',
    page: 0,
    autoRefresh: true,
  });

  const { logs, total, services, filterService, filterLevel, search, page, autoRefresh } = state;
  const pageSize = limit;

  // Ref to hold latest filter values so auto-refresh doesn't re-subscribe
  const filtersRef = useRef({ filterService, filterLevel, search, page });
  filtersRef.current = { filterService, filterLevel, search, page };

  const loadLogs = useCallback(async (
    svc: string,
    lvl: string,
    srch: string,
    pg: number,
  ) => {
    try {
      const result = await fetchLogs({
        service: svc || undefined,
        level: lvl || undefined,
        search: srch || undefined,
        limit: pageSize,
        offset: pg * pageSize,
      });
      dispatch({
        type: 'SET_RESULT',
        items: result.items,
        total: result.total,
        services: result.services,
      });
    } catch {
      // Silently handle fetch errors
    }
  }, [pageSize]);

  // Load on mount and when filters/page change
  useEffect(() => {
    loadLogs(filterService, filterLevel, search, page);
  }, [filterService, filterLevel, search, page, loadLogs]);

  // Keep ref to latest loadLogs so interval doesn't re-subscribe
  const loadLogsRef = useRef(loadLogs);
  loadLogsRef.current = loadLogs;

  // Auto-refresh — reads from stable refs, never re-subscribes
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      const f = filtersRef.current;
      loadLogsRef.current(f.filterService, f.filterLevel, f.search, f.page);
    }, 5000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Service Logs</h2>
          <span className="text-xs text-slate-500">
            {total} entries
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: 'TOGGLE_AUTO_REFRESH' })}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
              autoRefresh
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </button>
          <button
            type="button"
            onClick={() => loadLogs(filterService, filterLevel, search, page)}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-600 transition-all cursor-pointer"
          >
            Refresh now
          </button>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        {/* Service filter */}
        <select
          value={filterService}
          onChange={(e) => dispatch({ type: 'SET_FILTER', filter: { service: e.target.value } })}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500"
          aria-label="Filter by service"
        >
          <option value="">All services</option>
          {services.map((svc) => (
            <option key={svc} value={svc}>{svc}</option>
          ))}
        </select>

        {/* Level filter */}
        <select
          value={filterLevel}
          onChange={(e) => dispatch({ type: 'SET_FILTER', filter: { level: e.target.value } })}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500"
          aria-label="Filter by log level"
        >
          <option value="">All levels</option>
          <option value="debug">DEBUG</option>
          <option value="info">INFO</option>
          <option value="warn">WARN</option>
          <option value="error">ERROR</option>
        </select>

        {/* Search */}
        <input
          type="text"
          aria-label="Search log messages"
          placeholder="Search in messages..."
          value={search}
          onChange={(e) => dispatch({ type: 'SET_FILTER', filter: { search: e.target.value } })}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-blue-500 min-w-[200px]"
        />
      </div>

      {/* ── Log table ────────────────────────────────────────────── */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 overflow-hidden">
        {logs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No log entries found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left w-28">Time</th>
                  <th className="px-4 py-2.5 text-left w-20">Level</th>
                  <th className="px-4 py-2.5 text-left w-36">Service</th>
                  <th className="px-4 py-2.5 text-left">Message</th>
                  <th className="px-4 py-2.5 text-left w-48">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {logs.map((entry) => {
                  const colors = LEVEL_COLORS[entry.level] ?? LEVEL_COLORS.info;
                  return (
                    <tr key={entry.id} className={`${colors.bg} hover:bg-slate-700/30 transition-colors`}>
                      <td className="px-4 py-2 text-slate-400 font-mono text-xs whitespace-nowrap">
                        {formatTimestamp(entry.timestamp)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${colors.badge}`}>
                          {LEVEL_BADGE_LABELS[entry.level] ?? entry.level.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-300 font-mono text-xs whitespace-nowrap">
                        {entry.service}
                      </td>
                      <td className={`px-4 py-2 ${colors.text} text-xs`}>
                        {entry.message}
                      </td>
                      <LogDataCell data={entry.data} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Page {page + 1} of {totalPages} ({total} total entries)
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => dispatch({ type: 'SET_PAGE', page: Math.max(0, page - 1) })}
              className="px-3 py-1 text-xs rounded-md bg-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => dispatch({ type: 'SET_PAGE', page: Math.min(totalPages - 1, page + 1) })}
              className="px-3 py-1 text-xs rounded-md bg-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
