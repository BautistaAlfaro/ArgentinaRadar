/**
 * UserMenu — header component that shows a login button or user dropdown.
 *
 * - Not logged in: "Iniciar Sesión" button → opens AuthModal
 * - Logged in: Avatar (first letter) + dropdown with profile link and logout
 */

import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { AuthModal } from './AuthModal';

export function UserMenu() {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  // Close dropdown on Escape
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDropdown(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showDropdown]);

  if (!isAuthenticated || !user) {
    return (
      <>
        <button
          onClick={() => setShowAuthModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/40 rounded-lg transition-colors cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path
              fillRule="evenodd"
              d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
              clipRule="evenodd"
            />
          </svg>
          Iniciar Sesión
        </button>

        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </>
    );
  }

  const initials = user.email.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown((prev) => !prev)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-700/40 transition-colors cursor-pointer"
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-blue-600/80 flex items-center justify-center text-xs font-semibold text-white">
          {initials}
        </div>
        <span className="text-xs text-slate-300 max-w-[100px] truncate hidden sm:block">
          {user.email}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-150 ${
            showDropdown ? 'rotate-180' : ''
          }`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-slate-800 border border-slate-700/50 rounded-xl shadow-xl py-1 z-50">
          {/* User info */}
          <div className="px-3 py-2 border-b border-slate-700/30">
            <p className="text-sm font-medium text-slate-200 truncate">{user.email}</p>
            <div className="flex items-center gap-1.5 mt-1">
              {user.role === 'ADMIN' && (
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300 bg-amber-900/30 border border-amber-700/40 rounded">
                  Admin
                </span>
              )}
              <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                {user.role}
              </span>
            </div>
          </div>

          {/* Menu items */}
          <button
            disabled
            className="w-full px-3 py-2 text-left text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-700/30 transition-colors cursor-not-allowed flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
            </svg>
            Mi Perfil
            <span className="ml-auto text-[10px] text-slate-600">Pronto</span>
          </button>

          <div className="border-t border-slate-700/30 my-1" />

          {/* Logout */}
          <button
            onClick={() => {
              setShowDropdown(false);
              logout();
            }}
            className="w-full px-3 py-2 text-left text-xs text-red-400 hover:text-red-300 hover:bg-slate-700/30 transition-colors cursor-pointer flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path
                fillRule="evenodd"
                d="M17 4.25A2.25 2.25 0 0014.75 2h-5.5A2.25 2.25 0 007 4.25v2a.75.75 0 001.5 0v-2a.75.75 0 01.75-.75h5.5a.75.75 0 01.75.75v11.5a.75.75 0 01-.75.75h-5.5a.75.75 0 01-.75-.75v-2a.75.75 0 00-1.5 0v2A2.25 2.25 0 009.25 18h5.5A2.25 2.25 0 0017 15.75V4.25z"
                clipRule="evenodd"
              />
              <path
                fillRule="evenodd"
                d="M1 10a.75.75 0 01.75-.75h9.546l-1.048-.943a.75.75 0 111.004-1.114l2.5 2.25a.75.75 0 010 1.114l-2.5 2.25a.75.75 0 11-1.004-1.114l1.048-.943H1.75A.75.75 0 011 10z"
                clipRule="evenodd"
              />
            </svg>
            Cerrar Sesión
          </button>
        </div>
      )}
    </div>
  );
}
