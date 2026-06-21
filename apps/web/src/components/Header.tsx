import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { AuthModal } from './auth/AuthModal';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

export function Header() {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalView, setAuthModalView] = useState<'login' | 'register'>('login');
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

  const handleOpenLogin = () => {
    setAuthModalView('login');
    setShowAuthModal(true);
  };

  const role = user?.role ?? null;
  const location = useLocation();
  const isHomeActive = location.pathname === '/';
  const isMarketsActive = location.pathname === '/markets';

  // Render Guest (VISITOR) Header
  if (!isAuthenticated || !user) {
    return (
      <>
        <nav className="fixed top-0 w-full z-50 bg-surface-container/70 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-primary/5 flex justify-between items-center px-margin-desktop h-16 shrink-0">
          <div className="flex items-center gap-8">
            <Link to="/" className="hover:opacity-85 transition-opacity flex items-center gap-2">
              <motion.img
                src="/logo-radar.png"
                alt="Radar Icon"
                className="h-10 w-auto object-contain"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
              />
              <img src="/logo-letras.png" alt="Argentina Radar" className="h-6 w-auto object-contain" />
            </Link>
            <div className="hidden md:flex items-center gap-6">
              <Link className={`font-label-caps text-label-caps py-2 font-inter text-[11px] font-bold tracking-wider transition-colors ${
                isHomeActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'
              }`} to="/">
                Monitoreo
              </Link>
              <Link className={`font-label-caps text-label-caps py-2 font-inter text-[11px] font-bold tracking-wider transition-colors ${
                isMarketsActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'
              }`} to="/markets">
                Mercados
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Locked Search Bar */}
            <div className="relative group cursor-not-allowed hidden sm:block" onClick={handleOpenLogin}>
              <div className="flex items-center bg-surface-container-lowest border border-white/10 px-4 h-10 w-80 rounded-sm opacity-60">
                <span className="material-symbols-outlined text-on-surface-variant text-[20px] mr-3">lock</span>
                <span className="text-on-surface-variant font-label-caps text-label-caps font-inter text-[11px] font-bold tracking-wider">
                  Login to search semantically
                </span>
              </div>
            </div>
            {/* Login button */}
            <button
              onClick={handleOpenLogin}
              className="flex items-center gap-2 px-4 h-10 bg-primary text-on-primary font-label-caps text-label-caps font-inter text-[11px] font-bold tracking-wider rounded-sm hover:brightness-110 transition-all active:scale-95 cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">account_circle</span>
              <span className="uppercase">INGRESAR</span>
            </button>
          </div>
        </nav>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialView={authModalView} />
      </>
    );
  }

  // Render VIP Header
  if (role === 'VIP') {
    return (
      <>
        <header className="fixed top-0 w-full z-50 bg-surface-container/70 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-primary/5 h-16 flex justify-between items-center px-margin-desktop shrink-0">
          <div className="flex items-center gap-8">
            <Link to="/" className="hover:opacity-85 transition-opacity flex items-center gap-2">
              <motion.img
                src="/logo-radar.png"
                alt="Radar Icon"
                className="h-10 w-auto object-contain"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
              />
              <img src="/logo-letras.png" alt="Argentina Radar" className="h-6 w-auto object-contain" />
            </Link>
            <div className="hidden md:flex items-center gap-4 shrink-0">
              <Link className={`font-label-caps text-label-caps py-2 font-inter text-[11px] font-bold tracking-wider transition-colors ${
                isHomeActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'
              }`} to="/">
                Monitoreo
              </Link>
              <Link className={`font-label-caps text-label-caps py-2 font-inter text-[11px] font-bold tracking-wider transition-colors ${
                isMarketsActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'
              }`} to="/markets">
                Mercados
              </Link>
            </div>
            {/* UNLOCKED SEMANTIC SEARCH */}
            <div className="relative hidden lg:block group">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-primary text-lg pointer-events-none group-focus-within:animate-pulse">
                search
              </span>
              <input
                className="bg-surface-container-lowest border border-white/10 rounded-lg pl-10 pr-4 py-2 w-[400px] font-label-data text-label-data text-on-surface focus:border-primary/50 focus:ring-0 transition-all outline-none"
                placeholder="Búsqueda Semántica VIP (e.g. 'Eventos de riesgo en Vaca Muerta')"
                type="text"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 bg-primary/20 text-primary text-[9px] px-1.5 py-0.5 rounded border border-primary/30 font-bold font-jetbrains-mono">
                AI ENABLED
              </span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div
              className="flex items-center gap-3 bg-white/5 pr-4 pl-1 py-1 rounded-full border border-white/10 cursor-pointer hover:bg-white/10 transition-colors relative"
              onClick={() => setShowDropdown((prev) => !prev)}
              ref={dropdownRef}
            >
              <div className="relative">
                <img
                  className="w-8 h-8 rounded-full border border-primary/50 object-cover"
                  alt="Operative"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAN9e_t-UtqCQKmTWXFWviaBTaWz5Nv0_CXWnKNkcuoxzSbYImVEoUSVJX2YPqP2Qlok8uOxLlMM2J_1dhVAj1plblepx3nsZNEm0lfAlyM9cxLpv7QnfI6nPjdWfedQgl3tgn1RkxB0_dwFZ60D1ifIcd9luAJtI6mjRjJ299uRpfTn953qLY99aeoo50hi6y8lgcdsIpdr6FfAlOXl_VGdaRXFP0DsdOHvP06k7pyGRRdtQ_GgbmppXgTDCN6gV_PPKrg1QUzNR50"
                />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-secondary rounded-full border-2 border-surface-container"></div>
              </div>
              <div className="flex flex-col text-left">
                <div className="flex items-center gap-1.5">
                  <span className="font-label-caps text-label-caps text-on-surface font-inter text-[11px] font-bold tracking-wider truncate max-w-[100px]">
                    {user.email.split('@')[0]}
                  </span>
                  <span className="bg-secondary text-on-secondary text-[9px] px-1.5 py-0.2 rounded-sm font-black tracking-tighter">
                    VIP
                  </span>
                </div>
                <span className="text-[10px] text-primary/70 font-label-data">Nivel: S-Class</span>
              </div>

              {/* Dropdown Menu */}
              {showDropdown && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-surface-container-high border border-white/10 rounded-xl shadow-xl py-1 z-50 text-on-surface">
                  <div className="px-3 py-2 border-b border-white/5">
                    <p className="text-xs font-semibold text-slate-400 font-inter">Usuario</p>
                    <p className="text-xs font-mono truncate text-primary">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDropdown(false);
                      logout();
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-red-400 hover:text-red-300 hover:bg-white/5 transition-colors cursor-pointer flex items-center gap-2 font-inter"
                  >
                    <span className="material-symbols-outlined text-[16px]">logout</span>
                    Cerrar Sesión
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 text-on-surface-variant">
              <button className="material-symbols-outlined hover:text-primary transition-colors cursor-pointer" type="button">
                pulse_alert
              </button>
              <button className="material-symbols-outlined hover:text-primary transition-colors cursor-pointer" type="button">
                settings
              </button>
              <button className="material-symbols-outlined hover:text-primary transition-colors cursor-pointer" type="button">
                account_circle
              </button>
            </div>
          </div>
        </header>
      </>
    );
  }

  // Render Admin Header
  return (
    <>
      <nav className="fixed top-0 w-full z-50 bg-surface-container/70 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-primary/5 flex justify-between items-center px-margin-desktop h-16 shrink-0 text-on-surface animate-none">
        <div className="flex items-center gap-6">
          <Link to="/" className="hover:opacity-85 transition-opacity flex items-center gap-2">
            <motion.img
              src="/logo-radar.png"
              alt="Radar Icon"
              className="h-10 w-auto object-contain"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
            />
            <img src="/logo-letras.png" alt="Argentina Radar" className="h-6 w-auto object-contain" />
          </Link>
          <div className="h-6 w-px bg-white/10"></div>
          <Link className={`font-label-caps text-label-caps py-5 font-inter text-[11px] font-bold tracking-wider transition-colors ${
            isHomeActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'
          }`} to="/">
            Monitoreo
          </Link>
          <Link className={`font-label-caps text-label-caps py-5 font-inter text-[11px] font-bold tracking-wider transition-colors ${
            isMarketsActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'
          }`} to="/markets">
            Mercados
          </Link>
          <div className="h-6 w-px bg-white/10"></div>
          <Link className={`font-label-caps text-label-caps py-5 font-inter text-[11px] font-bold tracking-wider transition-colors ${
            location.pathname.startsWith('/admin') ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'
          }`} to="/admin">
            PANEL DE ADMINISTRACIÓN
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/admin"
            className="px-4 py-1.5 bg-primary/10 border border-primary/30 text-primary font-label-caps text-[10px] rounded hover:bg-primary hover:text-on-primary transition-all flex items-center gap-2 font-inter font-bold tracking-wider"
          >
            <span className="material-symbols-outlined text-sm">terminal</span>
            CONSOLA ADMIN
          </Link>
          <button className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors cursor-pointer" type="button">
            pulse_alert
          </button>
          <button className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors cursor-pointer" type="button">
            settings
          </button>
          <div
            className="flex items-center gap-3 pl-4 border-l border-white/10 cursor-pointer relative"
            onClick={() => setShowDropdown((prev) => !prev)}
            ref={dropdownRef}
          >
            <div className="text-right hidden sm:block text-left">
              <p className="font-label-caps text-[10px] text-primary font-bold mb-0.5 tracking-wider font-inter">
                ADMIN PRIVILEGES
              </p>
              <p className="font-label-data text-label-data text-on-surface leading-none font-jetbrains-mono">
                {user.email.split('@')[0]}
              </p>
            </div>
            <div className="relative">
              <img
                className="w-10 h-10 rounded-full border border-primary/50 object-cover"
                alt="Admin Operative"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCzg2uPtkBD1RGNgTKhEiljiClzRkH-WQDlD0jboAAfh_Eq6fTMDY-mq_7noTps9hlwBugaUuufQy_nFXOp6F7gMExnpKIgkjIleknAr59Kjl4nbZo7tOVGhPA-UFgYdW8haLbO8INPvEkHtznvZtcQ0YyfIv6Gt-rFyXiJffx91Jlf8foaekV3vyyyY_LAhSFc2kZespY8eRoAyfwAmRQs9v2UA49pBnw2V9Q-R7BTS8OJqZK3lTGzFTIdkhWlRPTFvSqm-n5tZsjX"
              />
              <div className="absolute -bottom-1 -right-1 bg-primary text-on-primary text-[8px] font-bold px-1 rounded border border-background">
                ADMIN
              </div>
            </div>

            {/* Dropdown Menu */}
            {showDropdown && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-surface-container-high border border-white/10 rounded-xl shadow-xl py-1 z-50 text-on-surface">
                <div className="px-3 py-2 border-b border-white/5">
                  <p className="text-xs font-semibold text-slate-400 font-inter">Administrador</p>
                  <p className="text-xs font-mono truncate text-primary">{user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowDropdown(false);
                    logout();
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-red-400 hover:text-red-300 hover:bg-white/5 transition-colors cursor-pointer flex items-center gap-2 font-inter"
                >
                  <span className="material-symbols-outlined text-[16px]">logout</span>
                  Cerrar Sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}
