import { Layout } from './components/Layout';
import { MapView } from './components/MapView';
import { LayerToggle } from './components/panels/LayerToggle';
import { NewsFeed } from './components/panels/NewsFeed';

export function App() {
  return (
    <Layout
      header={
        <header className="flex items-center h-14 px-6 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/50 shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-white">
            ArgentinaRadar
          </h1>
          <span className="ml-3 text-xs text-slate-400 font-mono">
            Monitoreo en vivo
          </span>
        </header>
      }
      sidebar={
        <aside className="w-[320px] shrink-0 bg-slate-800/60 border-r border-slate-700/50 overflow-y-auto">
          <NewsFeed />
        </aside>
      }
      map={<MapView />}
      ticker={
        <footer className="h-12 bg-slate-800/80 backdrop-blur-sm border-t border-slate-700/50 shrink-0 flex items-center px-4">
          <span className="text-xs text-slate-500">
            ArgentinaRadar v0.1.0 — Desarrollando...
          </span>
        </footer>
      }
    />
  );
}
