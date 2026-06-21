/**
 * Gate — role-based route guard.
 *
 * Usage:
 *   <Gate requiredRole="ADMIN">        → only ADMIN
 *   <Gate requiredRole="VIP">          → VIP or ADMIN
 *   <Gate>                     → any authenticated user
 *
 * When access is denied, shows an "Access Denied" panel with a
 * login button that opens the AuthModal.
 */

import { useState } from 'react';
import { useAuthStore, type UserRole } from '../../stores/authStore';
import { AuthModal } from './AuthModal';

interface GateProps {
  /** Minimum role required to see children. Omit to protect any authenticated user. */
  requiredRole?: UserRole;
  /** Content to render when authorized */
  children: React.ReactNode;
  /** Optional custom fallback when unauthorized (default: access denied panel) */
  fallback?: React.ReactNode;
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  VISITOR: 0,
  VIP: 1,
  ADMIN: 2,
};

export function Gate({ requiredRole, children, fallback }: GateProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  let hasAccess: boolean;
  if (requiredRole) {
    const userRole = user?.role ?? 'VISITOR';
    hasAccess = ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
  } else {
    hasAccess = isAuthenticated;
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <>
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
            {requiredRole ? (
              <>
                Necesitas permisos de{' '}
                <span className="text-blue-400 font-medium">{requiredRole}</span>{' '}
                para acceder a esta sección.
              </>
            ) : (
              'Iniciá sesión para acceder a esta sección.'
            )}
          </p>

          <button
            onClick={() => setShowAuthModal(true)}
            className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer"
          >
            Iniciar Sesión
          </button>
        </div>
      </div>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </>
  );
}
