/**
 * Sidebar with tabbed panels.
 *
 * Four tabs:
 *   1. Eventos (EventFeed — default)
 *   2. Tendencias (TrendingTopics)
 *   3. Política (PoliticalPanel)
 *   4. Noticias (NewsFeed)
 *
 * Uses a simple tab UI built with Tailwind.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EventFeed } from './EventFeed';
import { NewsFeed } from './NewsFeed';
import { PoliticalPanel } from './PoliticalPanel';
import { TrendingTopics } from './TrendingTopics';
import { EventTimeline } from '../EventTimeline';
import { useAuthStore } from '../../stores/authStore';
import { useRadarStore } from '../../stores/radarStore';

type TabId = 'events' | 'trending' | 'political' | 'news';

interface TabDefinition {
  id: TabId;
  label: string;
}

const TABS: TabDefinition[] = [
  { id: 'events', label: 'Eventos' },
  { id: 'trending', label: 'Tendencias' },
  { id: 'political', label: 'Política' },
  { id: 'news', label: 'Noticias' },
];

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<TabId>('events');
  const role = useAuthStore((s) => s.user?.role ?? null);
  const selectedProvince = useRadarStore((s) => s.selectedProvince);
  const clearProvinceSelection = useRadarStore((s) => s.clearProvinceSelection);

  const handleKeyDown = (e: React.KeyboardEvent, tabId: TabId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveTab(tabId);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-slate-700/50 shrink-0" role="tablist">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab.id)}
              className={`flex-1 text-xs font-medium py-2.5 px-2 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/40 ${
                isActive
                  ? 'text-slate-100 border-b-2 border-blue-500 bg-slate-700/30'
                  : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent hover:bg-slate-700/20'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Province filter badge */}
      {selectedProvince && (
        <div className="px-3 py-2 bg-blue-900/30 border-b border-blue-800/30 shrink-0">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-400 shrink-0">
              <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zm-1.032-9.814a2.5 2.5 0 112.682 0A2.5 2.5 0 018.66 9.12z" clipRule="evenodd" />
            </svg>
            <span className="text-xs font-medium text-blue-300 flex-1 truncate">
              {selectedProvince}
            </span>
            <button
              onClick={clearProvinceSelection}
              className="p-0.5 rounded text-blue-400 hover:text-white hover:bg-blue-700/50 transition-colors cursor-pointer"
              aria-label="Quitar filtro de provincia"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'events' && <EventFeed />}
        {activeTab === 'trending' && <TrendingTopics />}
        {activeTab === 'political' && <PoliticalPanel />}
        {activeTab === 'news' && <NewsFeed />}
      </div>

      {/* Admin link — only visible for ADMIN role */}
      {role === 'ADMIN' && (
        <Link
          to="/admin"
          className="flex items-center gap-2 px-4 py-2.5 mx-3 mb-2 text-xs font-medium text-slate-400 bg-slate-700/30 hover:bg-slate-700/50 hover:text-slate-200 rounded-lg transition-colors border border-slate-600/30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M9.664 1.319a.75.75 0 01.672 0 41.059 41.059 0 018.198 5.324.75.75 0 01-.326 1.275 43.603 43.603 0 00-8.11 2.628.75.75 0 01-.596 0A43.627 43.627 0 001.5 7.918a.75.75 0 01-.327-1.275 41.06 41.06 0 018.49-5.324zM10 2.066a41.86 41.86 0 00-7.493 4.747 42.273 42.273 0 007.493 2.598 42.273 42.273 0 007.493-2.598A41.86 41.86 0 0010 2.066zM10 18.52a39.254 39.254 0 01-7.262-2.033.75.75 0 01.524-1.406 37.766 37.766 0 006.738 1.886.75.75 0 01.514.886.75.75 0 01-.514.667z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M10 18.52a.75.75 0 01.514-.667 37.766 37.766 0 006.738-1.886.75.75 0 01.524 1.406A39.254 39.254 0 0110 18.52z" clipRule="evenodd" />
            <path d="M10 13.292a.75.75 0 01.075.001 41.947 41.947 0 007.356-2.193.75.75 0 01.524 1.405A43.447 43.447 0 0110 14.792a43.447 43.447 0 01-7.955-2.288.75.75 0 01.525-1.405 41.947 41.947 0 007.355 2.192A.75.75 0 0110 13.292z" />
          </svg>
          Admin Dashboard
        </Link>
      )}

      {/* Overlay timeline when an event is selected */}
      <EventTimeline />
    </div>
  );
}


