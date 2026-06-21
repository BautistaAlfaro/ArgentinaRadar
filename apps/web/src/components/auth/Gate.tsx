/**
 * Gate — role-based route guard.
 *
 * Wraps children and only renders them when the current user has the
 * required role. Shows a fallback message otherwise.
 *
 * In development, clicking "Login as Admin" / "Login as VIP" buttons
 * in the fallback sets the mock user. When the real auth system is
 * integrated (Phase 3), this component reads from useAuthStore.
 */

import { useState } from 'react';
import { useAuthStore, type UserRole } from '../../stores/authStore';

interface GateProps {
  /** Minimum role required to see children */
  role: UserRole;
  /** Content to render when authorized */
  children: React.ReactNode;
  /** Optional fallback content when unauthorized (default: login prompt) */
  fallback?: React.ReactNode;
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  VISITOR: 0,
  VIP: 1,
  ADMIN: 2,
};

export function Gate({ role, children, fallback }: GateProps) {
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role ?? 'VISITOR';
  const loginAsAdmin = useAuthStore((s) => s.loginAsAdmin);
  const loginAsVip = useAuthStore((s) => s.loginAsVip);
  const [showDevTools, setShowDevTools] = useState(false);

  const hasAccess = ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[role];

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className="flex items-center justify-center h-screen bg-slate-900">
      <div className="text-center max-w-md mx-auto p-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-8 h-8 text-slate-400"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-200 mb-2">
          Acceso restringido
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Necesitas permisos de <span className="text-blue-400 font-medium">{role}</span> para acceder a esta sección.
        </p>

        <button
          onClick={() => setShowDevTools(!showDevTools)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          {showDevTools ? 'Ocultar' : 'Mostrar'} opciones de desarrollo
        </button>

        {showDevTools && (
          <div className="mt-4 space-y-2">
            <button
              onClick={loginAsAdmin}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer"
            >
              Login como ADMIN (dev)
            </button>
            <button
              onClick={loginAsVip}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors cursor-pointer"
            >
              Login como VIP (dev)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
