import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { EventFeed } from './EventFeed';
import { NewsFeed } from './NewsFeed';
import { PoliticalPanel } from './PoliticalPanel';
import { TrendingTopics } from './TrendingTopics';
import { EventTimeline } from '../EventTimeline';
import { useAuthStore } from '../../stores/authStore';
import { useRadarStore } from '../../stores/radarStore';
import { AuthModal } from '../auth/AuthModal';

type TabId = 'events' | 'trending' | 'political' | 'news';

interface TabDefinition {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabDefinition[] = [
  { id: 'events', label: 'Monitoreo', icon: 'radar' },
  { id: 'trending', label: 'Tendencias', icon: 'equalizer' },
  { id: 'political', label: 'Política', icon: 'filter_list' },
  { id: 'news', label: 'Noticias', icon: 'history' },
];

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<TabId>('events');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalView, setAuthModalView] = useState<'login' | 'register'>('login');

  const [alertsState, setAlertsState] = useState({
    cordoba: true,
    sanjuan: false,
    buenosaires: true,
  });

  const role = useAuthStore((s) => s.user?.role ?? null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const selectedProvince = useRadarStore((s) => s.selectedProvince);
  const clearProvinceSelection = useRadarStore((s) => s.clearProvinceSelection);

  const isVisitor = !isAuthenticated || role === 'VISITOR';

  // Force active tab to 'events' if visitor
  useEffect(() => {
    if (isVisitor && activeTab !== 'events') {
      setActiveTab('events');
    }
  }, [isVisitor, activeTab]);

  const handleTabClick = (tabId: TabId) => {
    if (isVisitor && tabId !== 'events') {
      setAuthModalView('login');
      setShowAuthModal(true);
      return;
    }
    setActiveTab(tabId);
  };

  const handleAlertToggle = (key: keyof typeof alertsState) => {
    setAlertsState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      console.log(`%c [VIP] Alerta toggled: ${key} = ${next[key]}`, 'color: #4cd7f6; font-weight: bold;');
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-surface-container-lowest/80 backdrop-blur-2xl border-r border-white/10 select-none">
      {/* Sidebar Header based on Role */}
      {isVisitor ? (
        <div className="px-6 mb-6 mt-6 shrink-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-2 h-2 rounded-full bg-error pulse-dot"></div>
            <span className="font-label-caps text-label-caps text-error tracking-[0.2em] font-inter text-[10px] font-bold">
              RESTRICTED ACCESS
            </span>
          </div>
          <h2 className="font-headline-sm text-headline-sm text-primary uppercase font-space-grotesk font-bold">
            VISITOR MODE
          </h2>
          <p className="font-label-data text-label-data text-on-surface-variant mt-1 font-jetbrains-mono">
            Data throughput: 15% (Limited)
          </p>
        </div>
      ) : role === 'VIP' ? (
        <div className="px-6 mb-6 mt-6 shrink-0">
          <h2 className="font-headline-sm text-headline-sm text-primary uppercase flex items-center gap-2 font-space-grotesk font-bold">
            <motion.span
              className="material-symbols-outlined text-primary"
              style={{ fontVariationSettings: "'FILL' 1'", display: 'inline-block' }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
            >
              radar
            </motion.span>
            CENTRO DE MANDO
          </h2>
          <p className="font-label-data text-label-data text-secondary/70 mt-1 flex items-center gap-1.5 font-jetbrains-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
            Estado: Operativo (Encrypted)
          </p>
        </div>
      ) : (
        <div className="px-6 mb-6 mt-6 shrink-0">
          <div className="flex items-center gap-3 mb-1">
            <motion.span
              className="material-symbols-outlined text-primary"
              style={{ fontVariationSettings: "'FILL' 1'", display: 'inline-block' }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
            >
              radar
            </motion.span>
            <h2 className="font-headline-sm text-headline-sm text-primary uppercase font-space-grotesk font-bold">
              CENTRO DE MANDO
            </h2>
          </div>
          <p className="font-label-data text-label-data text-secondary font-jetbrains-mono">
            Estado: Operativo (Admin)
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-col px-3 space-y-1 shrink-0" role="tablist">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const locked = isVisitor && tab.id !== 'events';
          return (
            <button
              type="button"
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabClick(tab.id)}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all cursor-pointer font-inter text-[12px] uppercase font-bold tracking-wider relative group ${
                isActive
                  ? 'bg-primary/10 border-l-4 border-primary text-primary font-bold'
                  : 'text-on-surface-variant hover:bg-surface-variant/20 hover:text-primary'
              }`}
            >
              {tab.icon === 'radar' ? (
                <motion.span
                  className="material-symbols-outlined text-primary"
                  style={{ display: 'inline-block' }}
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
                >
                  radar
                </motion.span>
              ) : (
                <span className="material-symbols-outlined">{tab.icon}</span>
              )}
              <span className="font-label-data text-label-data uppercase">{tab.label}</span>
              {locked && (
                <span className="material-symbols-outlined ml-auto text-[16px] opacity-40 group-hover:opacity-85 transition-opacity">
                  lock
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Province filter badge */}
      {selectedProvince && (
        <div className="px-5 py-2 mx-3 mt-4 bg-primary/5 border border-primary/20 rounded-lg shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-sm">location_on</span>
            <span className="text-xs font-semibold text-primary flex-1 truncate font-inter">
              {selectedProvince}
            </span>
            <button
              onClick={clearProvinceSelection}
              className="p-0.5 rounded text-on-surface-variant hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Quitar filtro de provincia"
              type="button"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden mt-4">
        {activeTab === 'events' && <EventFeed />}
        {activeTab === 'trending' && <TrendingTopics />}
        {activeTab === 'political' && <PoliticalPanel />}
        {activeTab === 'news' && <NewsFeed />}
      </div>

      {/* VIP Custom Alerts and Links */}
      {role === 'VIP' && (
        <div className="mx-3 mt-auto mb-6 p-4 rounded-xl border border-primary/20 bg-primary/5 shrink-0">
          <h3 className="font-label-caps text-label-caps text-primary mb-4 flex justify-between items-center font-inter text-[10px] font-black tracking-wider">
            ALERTAS PERSONALIZADAS
            <span className="material-symbols-outlined text-sm">notifications_active</span>
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-label-data text-on-surface-variant font-inter">Cortes en Córdoba</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={alertsState.cordoba}
                  onChange={() => handleAlertToggle('cordoba')}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-surface-variant rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-label-data text-on-surface-variant font-inter">Sismos en San Juan</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={alertsState.sanjuan}
                  onChange={() => handleAlertToggle('sanjuan')}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-surface-variant rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-label-data text-on-surface-variant font-inter">Tráfico Buenos Aires</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={alertsState.buenosaires}
                  onChange={() => handleAlertToggle('buenosaires')}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-surface-variant rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
          <button
            type="button"
            className="w-full mt-4 py-2 bg-primary text-on-primary font-label-caps text-[10px] font-black rounded hover:brightness-110 active:scale-95 transition-all cursor-pointer font-inter uppercase"
          >
            GENERAR REPORTE VIP
          </button>
        </div>
      )}

      {/* Guest/Visitor Call to Action */}
      {isVisitor && (
        <div className="mx-4 mt-auto mb-6 shrink-0">
          <div
            onClick={() => {
              setAuthModalView('register');
              setShowAuthModal(true);
            }}
            className="relative overflow-hidden glass-panel p-6 rounded-lg border border-primary/30 group cursor-pointer hover:border-primary transition-all hover:shadow-[0_0_15px_rgba(76,215,246,0.1)]"
          >
            <div className="absolute -right-4 -top-4 opacity-10">
              <span className="material-symbols-outlined text-[80px] text-primary">verified_user</span>
            </div>
            <span className="font-label-caps text-label-caps text-primary mb-2 block font-inter text-[10px] font-black tracking-widest">
              MEJORAR ACCESO
            </span>
            <p className="font-body-md text-on-surface leading-tight mb-4 font-medium font-inter text-[12px]">
              Accedé a Búsquedas Semánticas y Alertas Push.
            </p>
            <button
              className="w-full py-2 bg-primary text-on-primary font-label-caps text-label-caps font-inter text-[10px] font-black tracking-wider rounded-sm hover:shadow-[0_0_15px_rgba(76,215,246,0.4)] transition-all uppercase cursor-pointer"
              type="button"
            >
              REGISTRARSE
            </button>
          </div>
        </div>
      )}

      {/* Admin Dashboard Quick Link */}
      {role === 'ADMIN' && (
        <div className="px-4 mt-auto mb-6 shrink-0">
          <Link
            to="/admin"
            className="w-full py-3 bg-primary text-on-primary font-bold font-label-caps text-[11px] rounded hover:brightness-110 active:scale-95 transition-all mb-4 flex items-center justify-center gap-2 font-inter uppercase"
          >
            <span className="material-symbols-outlined text-sm">dashboard</span>
            VER DASHBOARD ADMIN
          </Link>
        </div>
      )}

      {/* Prioritized Support or General Support */}
      {!isVisitor && (
        <div className="px-4 py-3 border-t border-white/5 shrink-0">
          <a
            className="flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:text-white transition-all font-inter text-xs"
            href="#"
          >
            <span className="material-symbols-outlined text-lg">support_agent</span>
            <span className="font-label-data text-label-data uppercase tracking-wider font-bold">
              {role === 'VIP' ? 'SOPORTE PRIORITARIO' : 'SOPORTE'}
            </span>
          </a>
        </div>
      )}

      {/* Event Timeline overlay if active */}
      <EventTimeline />

      {/* Self-contained AuthModal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialView={authModalView} />
    </div>
  );
}
