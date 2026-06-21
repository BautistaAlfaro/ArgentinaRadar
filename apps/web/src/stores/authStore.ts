/**
 * Minimal auth store stub for route protection.
 *
 * This is a lightweight placeholder until Phase 3 (real auth with
 * JWT + refresh tokens) is implemented. It stores a mock admin user
 * so the Gate component can demonstrate role-based access control
 * in development.
 *
 * Replace with full authStore from tasks 3.2–3.4 when ready.
 */

import { create } from 'zustand';

export type UserRole = 'VISITOR' | 'VIP' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  role: UserRole | null;
  /** Dev-only: auto-login as admin */
  loginAsAdmin: () => void;
  /** Dev-only: auto-login as VIP */
  loginAsVip: () => void;
  /** Dev-only: logout */
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  role: null,

  loginAsAdmin: () =>
    set({
      user: { id: 'dev-admin', email: 'admin@argentinaradar.dev', role: 'ADMIN' },
      isAuthenticated: true,
      role: 'ADMIN',
    }),

  loginAsVip: () =>
    set({
      user: { id: 'dev-vip', email: 'vip@argentinaradar.dev', role: 'VIP' },
      isAuthenticated: true,
      role: 'VIP',
    }),

  logout: () =>
    set({ user: null, isAuthenticated: false, role: null }),
}));
