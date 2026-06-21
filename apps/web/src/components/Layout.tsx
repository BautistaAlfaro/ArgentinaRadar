import { type ReactNode } from 'react';
import { useRadarStore } from '../stores/radarStore';

interface LayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  map: ReactNode;
  ticker?: ReactNode;
}

export function Layout({ header, sidebar, map, ticker }: LayoutProps) {
  const sidebarCollapsed = useRadarStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useRadarStore((s) => s.toggleSidebar);

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-on-surface overflow-hidden">
      {header}

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div
          className={`${
            sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-[320px]'
          } shrink-0 bg-surface-container-lowest/80 border-r border-white/10 backdrop-blur-2xl transition-[width] duration-200 relative`}
        >
          <div className="w-[320px] h-full overflow-y-auto">
            {sidebar}
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative min-w-0">
          {map}
        </div>

        {/* Collapse toggle button */}
        <button
          onClick={toggleSidebar}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-6 h-12 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded-r-md flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
          aria-label={sidebarCollapsed ? 'Abrir panel lateral' : 'Cerrar panel lateral'}
         type="button">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-4 h-4 transition-transform duration-200 ${
              sidebarCollapsed ? 'rotate-180' : ''
            }`}
          >
            <path
              fillRule="evenodd"
              d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {ticker}
    </div>
  );
}

