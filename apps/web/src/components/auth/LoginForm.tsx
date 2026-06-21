/**
 * LoginForm — email + password form with loading state and error display.
 *
 * Emits onSuccess when login completes so the parent modal can close.
 */

import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../../stores/authStore';

interface LoginFormProps {
  /** Called after successful login */
  onSuccess: () => void;
  /** Switch to the register view */
  onSwitchToRegister: () => void;
}

export function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    try {
      await login(email.trim(), password);
      onSuccess();
    } catch {
      // error is set in the store
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-slate-100">Iniciar Sesión</h2>
        <p className="text-sm text-slate-400 mt-1">
          Accedé a tu cuenta de ArgentinaRadar
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-sm text-red-300 bg-red-900/30 border border-red-800/40 rounded-lg">
          {error}
        </div>
      )}

      {/* Email */}
      <div>
        <label htmlFor="login-email" className="block text-xs font-medium text-slate-400 mb-1">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) clearError();
          }}
          placeholder="tu@email.com"
          className="w-full px-3 py-2 text-sm text-slate-200 bg-slate-800/60 border border-slate-700/50 rounded-lg placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-colors"
        />
      </div>

      {/* Password */}
      <div>
        <label htmlFor="login-password" className="block text-xs font-medium text-slate-400 mb-1">
          Contraseña
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) clearError();
          }}
          placeholder="••••••••"
          className="w-full px-3 py-2 text-sm text-slate-200 bg-slate-800/60 border border-slate-700/50 rounded-lg placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-colors"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
      >
        {isLoading && (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        {isLoading ? 'Ingresando...' : 'Ingresar'}
      </button>

      {/* Switch to register */}
      <p className="text-center text-sm text-slate-400">
        ¿No tenés cuenta?{' '}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
        >
          Registrate
        </button>
      </p>
    </form>
  );
}
