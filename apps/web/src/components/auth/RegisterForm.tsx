/**
 * RegisterForm — email + password + confirm password form.
 *
 * Validates email format, password length (>= 8), and password match
 * on the client before submitting. Auto-logs in on success.
 */

import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../../stores/authStore';

interface RegisterFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterForm({ onSuccess, onSwitchToLogin }: RegisterFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const register = useAuthStore((s) => s.register);
  const isLoading = useAuthStore((s) => s.isLoading);
  const apiError = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const validate = (): string | null => {
    if (!EMAIL_RE.test(email.trim())) return 'El email no es válido';
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
    if (password !== confirmPassword) return 'Las contraseñas no coinciden';
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }

    try {
      await register(email.trim(), password);
      onSuccess();
    } catch {
      // error is set in the store
    }
  };

  const displayError = validationError ?? apiError;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-slate-100">Crear Cuenta</h2>
        <p className="text-sm text-slate-400 mt-1">
          Registrate para acceder a funciones exclusivas
        </p>
      </div>

      {/* Error */}
      {displayError && (
        <div className="px-3 py-2 text-sm text-red-300 bg-red-900/30 border border-red-800/40 rounded-lg">
          {displayError}
        </div>
      )}

      {/* Email */}
      <div>
        <label htmlFor="reg-email" className="block text-xs font-medium text-slate-400 mb-1">
          Email
        </label>
        <input
          id="reg-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setValidationError(null);
            if (apiError) clearError();
          }}
          placeholder="tu@email.com"
          className="w-full px-3 py-2 text-sm text-slate-200 bg-slate-800/60 border border-slate-700/50 rounded-lg placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-colors"
        />
      </div>

      {/* Password */}
      <div>
        <label htmlFor="reg-password" className="block text-xs font-medium text-slate-400 mb-1">
          Contraseña
        </label>
        <input
          id="reg-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setValidationError(null);
            if (apiError) clearError();
          }}
          placeholder="Mínimo 8 caracteres"
          className="w-full px-3 py-2 text-sm text-slate-200 bg-slate-800/60 border border-slate-700/50 rounded-lg placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-colors"
        />
      </div>

      {/* Confirm password */}
      <div>
        <label htmlFor="reg-confirm" className="block text-xs font-medium text-slate-400 mb-1">
          Confirmar contraseña
        </label>
        <input
          id="reg-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setValidationError(null);
            if (apiError) clearError();
          }}
          placeholder="Repetí la contraseña"
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
        {isLoading ? 'Creando cuenta...' : 'Crear Cuenta'}
      </button>

      {/* Switch to login */}
      <p className="text-center text-sm text-slate-400">
        ¿Ya tenés cuenta?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
        >
          Iniciá sesión
        </button>
      </p>
    </form>
  );
}
