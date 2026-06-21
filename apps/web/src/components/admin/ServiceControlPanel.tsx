/**
 * ServiceControlPanel — ON/OFF toggle grid for all backend services.
 *
 * Polls service status every 5s and allows ADMIN users to start/stop
 * individual services or all services at once via the backend PM2 API.
 *
 * Special handling:
 *   - hermes-bridge (Telegram Bot) is displayed prominently at the top.
 *   - All other services are arranged in a responsive 3-4 column grid.
 *   - Last action timestamp is tracked client-side per service.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LazyMotion, domAnimation, m as motion } from 'framer-motion';
import {
  useServices,
} from '../../hooks/useAdminData';
import {
  startService,
  stopService,
  startAllServices,
  stopAllServices,
  type ServiceStatus,
} from '../../services/adminApi';

// ─── Types ───────────────────────────────────────────────────────────

type ActionState = 'idle' | 'loading' | 'success' | 'error';

interface ServiceAction {
  state: ActionState;
  error?: string;
  timestamp?: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const TELEGRAM_SERVICE = 'hermes-bridge';

const STATUS_LED: Record<string, { className: string; label: string }> = {
  running: { className: 'bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]', label: 'Running' },
  stopped: { className: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]', label: 'Stopped' },
  unknown: { className: 'bg-slate-500', label: 'Unknown' },
};

const SERVICE_ICONS: Record<string, string> = {
  'web-app':           'public',
  'news-ingestion':    'rss_feed',
  'geolocation':       'location_on',
  'ai-processor':      'psychology',
  'event-detector':    'bolt',
  'trend-analyzer':    'trending_up',
  'twitter-publisher': 'send',
  'hermes-bridge':     'smart_toy',
  'economic-data':     'payments',
  'alerts':            'notifications',
  'night-owl':         'bedtime',
  'auth':              'lock',
};

// ─── Helpers ─────────────────────────────────────────────────────────

function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ago`;
}

function capitalize(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── ServiceCard ─────────────────────────────────────────────────────

interface ServiceCardProps {
  service: ServiceStatus;
  action: ServiceAction;
  onToggle: (name: string, currentStatus: string) => void;
}

function ServiceCard({ service, action, onToggle }: ServiceCardProps) {
  const isTelegram = service.name === TELEGRAM_SERVICE;
  const led = STATUS_LED[service.status] ?? STATUS_LED.unknown;
  const isRunning = service.status === 'running';
  const isLoading = action.state === 'loading';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`
        relative rounded-xl border
        ${isTelegram
          ? 'border-blue-500/40 bg-blue-900/15 col-span-full md:col-span-2 lg:col-span-3'
          : 'border-slate-700/50 bg-slate-800/60'
        }
        p-4 transition-all duration-200
        hover:border-slate-600/60
      `}
    >
      {isTelegram && (
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full bg-blue-600 text-[10px] font-semibold text-white uppercase tracking-wider">
          Telegram Bot
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        {/* Left: icon + info */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Status LED */}
          <span
            className={`w-3 h-3 rounded-full shrink-0 transition-all duration-500 ${led.className}`}
            title={led.label}
          />

          {/* Icon */}
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0" aria-hidden="true">
            {SERVICE_ICONS[service.name] ?? 'settings'}
          </span>

          {/* Details */}
          <div className="min-w-0">
            <p className={`text-sm font-semibold truncate ${isTelegram ? 'text-blue-300' : 'text-slate-200'}`}>
              {capitalize(service.name)}
            </p>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">
              {service.description}
              {service.type === 'python' && ' (Python)'}
              {service.type === 'web' && ' (Vite)'}
            </p>
            <p className="text-[10px] text-slate-600 mt-0.5 font-mono">
              Port {service.port ?? '—'} · {led.label}
            </p>
          </div>
        </div>

        {/* Right: toggle + timestamp */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {/* ON/OFF Toggle */}
          <button
            type="button"
            disabled={isLoading}
            onClick={() => onToggle(service.name, service.status)}
            className={`
              relative inline-flex h-7 w-12 items-center rounded-full
              transition-colors duration-200 focus:outline-none focus:ring-2
              focus:ring-blue-500/50 focus:ring-offset-1 focus:ring-offset-slate-900
              ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              ${isRunning
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-slate-700 hover:bg-slate-600'
              }
            `}
            role="switch"
            aria-checked={isRunning}
            aria-label={`${isRunning ? 'Stop' : 'Start'} ${service.name}`}
          >
            <span
              className={`
                inline-block h-5 w-5 rounded-full bg-white shadow-sm
                transition-transform duration-200
                ${isRunning ? 'translate-x-6' : 'translate-x-1'}
                ${isLoading ? 'animate-pulse' : ''}
              `}
            />
          </button>

          {/* Last action timestamp */}
          <span className="text-[10px] text-slate-600 whitespace-nowrap">
            {action.timestamp ? formatTimestamp(action.timestamp) : '—'}
          </span>

          {/* Error message */}
          {action.state === 'error' && action.error && (
            <span className="text-[9px] text-red-400 max-w-[120px] text-right leading-tight mt-0.5">
              {action.error}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Telegram Status Section ─────────────────────────────────────────

function TelegramStatus({ services }: { services: ServiceStatus[] }) {
  const tg = services.find((s) => s.name === TELEGRAM_SERVICE);
  if (!tg) return null;

  const isRunning = tg.status === 'running';
  const led = STATUS_LED[tg.status] ?? STATUS_LED.unknown;

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-900/10 p-5 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-[28px] text-blue-400" aria-hidden="true">smart_toy</span>
          <div>
            <h3 className="text-base font-bold text-blue-300">
              Telegram Bot
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2.5 h-2.5 rounded-full ${led.className} transition-all duration-500`} />
              <span className={`text-xs font-medium ${isRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
                {isRunning ? 'ONLINE' : 'OFFLINE'}
              </span>
              {isRunning && (
                <span className="text-[11px] text-slate-500">
                  · Port {tg.port} active
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-right">
          <p className="text-[11px] text-slate-500">
            {isRunning ? 'Listening for events' : 'Not connected'}
          </p>
          <p className="text-[10px] text-slate-600 mt-0.5 font-mono">
            Status checked: {formatTimestamp(tg.lastChecked)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export function ServiceControlPanel() {
  const { data, isLoading, isError, error } = useServices();
  const [actions, setActions] = useState<Record<string, ServiceAction>>({});
  const actionTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const services = data?.services ?? [];

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = actionTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, [actionTimers]);

  // ─── Toggle handler ──────────────────────────────────────────────

  const handleToggle = useCallback(async (name: string, currentStatus: string) => {
    // Clear any existing timer for this service
    if (actionTimers.current[name]) {
      clearTimeout(actionTimers.current[name]);
    }

    setActions((prev) => ({
      ...prev,
      [name]: { state: 'loading' },
    }));

    try {
      if (currentStatus === 'running') {
        await stopService(name);
      } else {
        await startService(name);
      }

      setActions((prev) => ({
        ...prev,
        [name]: {
          state: 'success',
          timestamp: new Date().toISOString(),
        },
      }));

      // Reset to idle after 3 seconds
      actionTimers.current[name] = setTimeout(() => {
        setActions((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Command failed';
      setActions((prev) => ({
        ...prev,
        [name]: {
          state: 'error',
          error: msg,
          timestamp: new Date().toISOString(),
        },
      }));

      // Auto-clear error after 8 seconds
      actionTimers.current[name] = setTimeout(() => {
        setActions((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }, 8000);
    }
  }, []);

  // ─── Bulk handlers ───────────────────────────────────────────────

  const handleStartAll = useCallback(async () => {
    setActions((prev) => ({
      ...prev,
      _bulk: { state: 'loading' },
    }));
    try {
      await startAllServices();
      setActions((prev) => ({
        ...prev,
        _bulk: { state: 'success', timestamp: new Date().toISOString() },
      }));
      actionTimers.current._bulk = setTimeout(() => {
        setActions((prev) => {
          const next = { ...prev };
          delete next._bulk;
          return next;
        });
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Command failed';
      setActions((prev) => ({
        ...prev,
        _bulk: { state: 'error', error: msg, timestamp: new Date().toISOString() },
      }));
      actionTimers.current._bulk = setTimeout(() => {
        setActions((prev) => {
          const next = { ...prev };
          delete next._bulk;
          return next;
        });
      }, 8000);
    }
  }, []);

  const handleStopAll = useCallback(async () => {
    setActions((prev) => ({
      ...prev,
      _bulk: { state: 'loading' },
    }));
    try {
      await stopAllServices();
      setActions((prev) => ({
        ...prev,
        _bulk: { state: 'success', timestamp: new Date().toISOString() },
      }));
      actionTimers.current._bulk = setTimeout(() => {
        setActions((prev) => {
          const next = { ...prev };
          delete next._bulk;
          return next;
        });
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Command failed';
      setActions((prev) => ({
        ...prev,
        _bulk: { state: 'error', error: msg, timestamp: new Date().toISOString() },
      }));
      actionTimers.current._bulk = setTimeout(() => {
        setActions((prev) => {
          const next = { ...prev };
          delete next._bulk;
          return next;
        });
      }, 8000);
    }
  }, []);

  // ─── Loading state ───────────────────────────────────────────────

  if (isLoading && services.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-6 w-36 bg-slate-800 rounded-lg animate-pulse" />
          <div className="flex gap-2">
            <div className="h-8 w-24 bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-8 w-24 bg-slate-800 rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // ─── Split services: Telegram bot separate ───────────────────────

  const telegramService = services.find((s) => s.name === TELEGRAM_SERVICE);
  const otherServices = services.filter((s) => s.name !== TELEGRAM_SERVICE);

  const bulkAction = actions._bulk;
  const isBulkLoading = bulkAction?.state === 'loading';

  return (
    <LazyMotion features={domAnimation}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-5"
      >
        {/* ── Header + Bulk Controls ────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Service Control
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage all ArgentinaRadar backend services · Status polls every 5s
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Error display for bulk action */}
            {bulkAction?.state === 'error' && (
              <span className="text-[11px] text-red-400 max-w-[200px] text-right">
                {bulkAction.error}
              </span>
            )}

            <button
              type="button"
              disabled={isBulkLoading}
              onClick={handleStopAll}
              className={`
                px-4 py-2 text-xs font-medium rounded-lg transition-all
                ${isBulkLoading
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer hover:bg-red-600'
                }
                bg-red-700 text-white border border-red-600/50
                focus:outline-none focus:ring-2 focus:ring-red-500/50
              `}
              aria-label="Stop all services"
            >
              {isBulkLoading ? 'Stopping…' : 'Stop All'}
            </button>

            <button
              type="button"
              disabled={isBulkLoading}
              onClick={handleStartAll}
              className={`
                px-4 py-2 text-xs font-medium rounded-lg transition-all
                ${isBulkLoading
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer hover:bg-emerald-600'
                }
                bg-emerald-700 text-white border border-emerald-600/50
                focus:outline-none focus:ring-2 focus:ring-emerald-500/50
              `}
              aria-label="Start all services"
            >
              {isBulkLoading ? 'Starting…' : 'Start All'}
            </button>
          </div>
        </div>

        {/* ── Error banner ──────────────────────────────────────────── */}
        {isError && (
          <div className="rounded-xl border border-red-500/30 bg-red-900/20 p-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-400 shrink-0">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
              </svg>
              <p className="text-xs text-red-300">
                Failed to fetch service status: {error instanceof Error ? error.message : 'Backend unreachable'}
              </p>
            </div>
          </div>
        )}

        {/* ── Online/Offline count ──────────────────────────────────── */}
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {services.filter((s) => s.status === 'running').length} running
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {services.filter((s) => s.status === 'stopped').length} stopped
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            {services.filter((s) => s.status === 'unknown').length} unknown
          </span>
        </div>

        {/* ── Telegram Bot (prominent) ──────────────────────────────── */}
        {telegramService && (
          <TelegramStatus services={services} />
        )}

        {/* ── Service Cards Grid ────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {otherServices.map((svc) => (
            <ServiceCard
              key={svc.name}
              service={svc}
              action={actions[svc.name] ?? { state: 'idle' }}
              onToggle={handleToggle}
            />
          ))}
        </div>

        {/* ── Footer/help ───────────────────────────────────────────── */}
        <p className="text-[10px] text-slate-700 text-center pt-2">
          Status is detected by checking each service port.
          Commands are executed via PM2 on the server.
        </p>
      </motion.div>
    </LazyMotion>
  );
}
