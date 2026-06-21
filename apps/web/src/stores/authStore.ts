/**
 * Auth store with JWT token management and role-based user state.
 *
 * Persists the access token in localStorage under 'argentinaradar_token'
 * and the refresh token under 'argentinaradar_refresh'.
 *
 * API calls go through services/authApi.ts to the auth service on :3010.
 */

import { create } from 'zustand';
import {
  loginUser as apiLogin,
  registerUser as apiRegister,
  logoutUser as apiLogout,
  refreshTokenApi,
  fetchCurrentUser,
  type AuthUserData,
} from '../services/authApi';

// ─── Token persistence ───────────────────────────────────────────────

const TOKEN_KEY = 'argentinaradar_token';
const REFRESH_KEY = 'argentinaradar_refresh';

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

function setStoredRefreshToken(token: string | null) {
  if (token) {
    localStorage.setItem(REFRESH_KEY, token);
  } else {
    localStorage.removeItem(REFRESH_KEY);
  }
}

/** Decode a JWT payload without a library (browser-safe base64url). */
function decodeJWTPayload(token: string): { exp: number } | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** Milliseconds until the token expires (returns 0 if unreadable). */
export function getTokenExpiresIn(token: string): number {
  const decoded = decodeJWTPayload(token);
  if (!decoded?.exp) return 0;
  return decoded.exp * 1000 - Date.now();
}

// ─── Types ───────────────────────────────────────────────────────────

export type UserRole = 'VISITOR' | 'VIP' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

function toAuthUser(data: AuthUserData): AuthUser {
  return { id: data.id, email: data.email, role: data.role };
}

// ─── Store ───────────────────────────────────────────────────────────

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  /** Loading during login/register API calls */
  isLoading: boolean;
  /** Loading during initial auth check on app mount */
  isInitializing: boolean;
  /** User-facing error message */
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshTokenAction: () => Promise<void>;
  /** Fetch /me using the stored token. Does NOT set isInitializing. */
  getCurrentUser: () => Promise<void>;
  /**
   * Called once on app mount: reads stored token and fetches the
   * current user if one exists. Sets isInitializing while running.
   */
  initializeAuth: () => Promise<void>;
  clearError: () => void;
}

const storedToken = getStoredToken();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: storedToken,
  isAuthenticated: false,
  isLoading: false,
  isInitializing: !!storedToken,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await apiLogin(email, password);
      setStoredToken(res.accessToken);
      if (res.refreshToken) setStoredRefreshToken(res.refreshToken);
      set({
        user: toAuthUser(res.user),
        token: res.accessToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al iniciar sesión';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  register: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await apiRegister(email, password);
      setStoredToken(res.accessToken);
      if (res.refreshToken) setStoredRefreshToken(res.refreshToken);
      set({
        user: toAuthUser(res.user),
        token: res.accessToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrarse';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  logout: async () => {
    const { token } = get();
    try {
      if (token) {
        // Fire-and-forget: we clear local state regardless of API success
        await apiLogout(token).catch(() => {});
      }
    } finally {
      setStoredToken(null);
      setStoredRefreshToken(null);
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    }
  },

  refreshTokenAction: async () => {
    const refresh = getStoredRefreshToken();
    if (!refresh) {
      // No refresh token means we can't refresh — force logout
      setStoredToken(null);
      set({ user: null, token: null, isAuthenticated: false });
      return;
    }
    try {
      const res = await refreshTokenApi(refresh);
      setStoredToken(res.accessToken);
      if (res.refreshToken) setStoredRefreshToken(res.refreshToken);
      set({ token: res.accessToken });
    } catch {
      // Refresh failed — clear everything and force re-login
      setStoredToken(null);
      setStoredRefreshToken(null);
      set({ user: null, token: null, isAuthenticated: false });
    }
  },

  getCurrentUser: async () => {
    const { token } = get();
    if (!token) {
      set({ isInitializing: false });
      return;
    }
    try {
      const userData = await fetchCurrentUser(token);
      set({
        user: toAuthUser(userData),
        isAuthenticated: true,
        isInitializing: false,
        error: null,
      });
    } catch {
      // Token is invalid — clear it
      setStoredToken(null);
      setStoredRefreshToken(null);
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isInitializing: false,
        error: null,
      });
    }
  },

  initializeAuth: async () => {
    const token = getStoredToken();
    if (!token) {
      set({ isInitializing: false });
      return;
    }
    set({ token, isInitializing: true });
    try {
      const userData = await fetchCurrentUser(token);
      set({
        user: toAuthUser(userData),
        token,
        isAuthenticated: true,
        isInitializing: false,
        error: null,
      });
    } catch {
      setStoredToken(null);
      setStoredRefreshToken(null);
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isInitializing: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
