import { useMemo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { MapView } from './components/MapView';
import { Sidebar } from './components/panels/Sidebar';
import { ProvinceDetailPanel } from './components/panels/ProvinceDetailPanel';
import { EconomicTicker } from './components/panels/EconomicTicker';
import { ArgentinaTitle } from './components/ArgentinaTitle';
import { AdminDashboard } from './pages/AdminDashboard';
import { Markets } from './pages/Markets';
import { Gate } from './components/auth/Gate';
import { AuthProvider } from './components/auth/AuthProvider';
import { Header } from './components/Header';
import { ToastProvider } from '@shared/Toast';
import { ToastContainer } from './components/ui/ToastContainer';

function MainLayout() {
  const sidebar = useMemo(() => <Sidebar />, []);
  const map = useMemo(() => <MapView />, []);
  const ticker = useMemo(() => <EconomicTicker />, []);

  return (
    <>
      <ArgentinaTitle />
      <Layout
        header={<Header />}
        sidebar={sidebar}
        map={map}
        ticker={ticker}
      />
      <ProvinceDetailPanel />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<MainLayout />} />
            <Route path="/markets" element={<Markets />} />
            <Route
              path="/admin"
              element={
                <Gate requiredRole="ADMIN">
                  <AdminDashboard />
                </Gate>
              }
            />
          </Routes>
          <ToastContainer />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
