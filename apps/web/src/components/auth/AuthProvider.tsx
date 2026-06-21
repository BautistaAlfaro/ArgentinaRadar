/**
 * AuthProvider — initializes auth state on mount and schedules
 * automatic token refresh 1 minute before expiry.
 *
 * Shows a loading spinner while the initial auth check runs.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useAuthStore, getTokenExpiresIn } from '../../stores/authStore';

interface AuthProviderProps {
  children: ReactNode;
}

/** Refresh margin: 60 seconds before expiry. */
const REFRESH_MARGIN_MS = 60_000;

export function AuthProvider({ children }: AuthProviderProps) {
  const initializeAuth = useAuthStore((s) => s.initializeAuth);
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const token = useAuthStore((s) => s.token);
  const refreshTokenAction = useAuthStore((s) => s.refreshTokenAction);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Initialize on mount ─────────────────────────────────────────
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // ─── Schedule auto-refresh based on token expiry ──────────────────
  useEffect(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }

    if (!token) return;

    const expiresIn = getTokenExpiresIn(token);

    // If already expired or about to expire within the margin, refresh now
    if (expiresIn <= REFRESH_MARGIN_MS) {
      refreshTokenAction();
      return;
    }

    // Schedule refresh 1 minute before expiry
    const delay = expiresIn - REFRESH_MARGIN_MS;
    refreshTimer.current = setTimeout(() => {
      refreshTokenAction();
    }, delay);

    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [token, refreshTokenAction]);

  // ─── Loading state ────────────────────────────────────────────────
  if (isInitializing) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Inicializando...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
