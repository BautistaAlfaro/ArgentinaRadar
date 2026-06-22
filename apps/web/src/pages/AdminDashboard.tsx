/**
 * AdminDashboard — Unified admin control center.
 *
 * Renders the ControlCenter with live monitoring, service status,
 * pipeline, charts, activity feed, and system logs — no tabs.
 */

import { ControlCenter } from './ControlCenter';

export function AdminDashboard() {
  return (
    <div className="min-h-screen bg-surface-base text-on-surface relative">
      <div className="scanline"></div>
      <header className="sticky top-0 z-30 bg-surface-container/70 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-primary/5">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="font-headline-sm text-headline-sm font-bold text-primary tracking-tight uppercase font-space-grotesk">
              Admin Dashboard
            </h1>
            <p className="font-label-data text-label-data text-on-surface-variant mt-0.5 font-jetbrains-mono">
              Control center con monitoreo en vivo, acciones y estadísticas
            </p>
          </div>
        </div>
      </header>
      <div className="p-6">
        <ControlCenter />
      </div>
    </div>
  );
}
