import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Layout } from './components/Layout';
import { MapView } from './components/MapView';
import { Sidebar } from './components/panels/Sidebar';
import { EconomicTicker } from './components/panels/EconomicTicker';
import { ArgentinaTitle } from './components/ArgentinaTitle';
import { AdminDashboard } from './pages/AdminDashboard';
import { Gate } from './components/auth/Gate';

function MainLayout() {
  return (
    <>
      <ArgentinaTitle />
      <Layout
        header={
          <header className="flex items-center h-14 px-6 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/50 shrink-0">
            <Link to="/" className="hover:opacity-80 transition-opacity">
              <h1 className="text-xl font-bold tracking-tight text-white">
                ArgentinaRadar
              </h1>
            </Link>
            <span className="ml-3 text-xs text-slate-400 font-mono">
              Monitoreo en vivo
            </span>
            <nav className="ml-auto flex items-center gap-4">
              <Link
                to="/admin"
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Admin
              </Link>
            </nav>
          </header>
        }
        sidebar={
          <aside className="w-[320px] shrink-0 bg-slate-800/60 border-r border-slate-700/50 overflow-y-auto">
            <Sidebar />
          </aside>
        }
        map={<MapView />}
        ticker={<EconomicTicker />}
      />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />} />
        <Route
          path="/admin"
          element={
            <Gate role="ADMIN">
              <AdminDashboard />
            </Gate>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
