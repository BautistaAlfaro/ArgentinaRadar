/**
 * Sidebar with tabbed panels.
 *
 * Three tabs:
 *   1. Eventos (EventFeed — default)
 *   2. Tendencias (placeholder)
 *   3. Noticias (NewsFeed)
 *
 * Uses a simple tab UI built with Tailwind.
 */

import { useState } from 'react';
import { EventFeed } from './EventFeed';
import { NewsFeed } from './NewsFeed';

type TabId = 'events' | 'trending' | 'news';

interface TabDefinition {
  id: TabId;
  label: string;
}

const TABS: TabDefinition[] = [
  { id: 'events', label: 'Eventos' },
  { id: 'trending', label: 'Tendencias' },
  { id: 'news', label: 'Noticias' },
];

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<TabId>('events');

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

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'events' && <EventFeed />}
        {activeTab === 'trending' && <TrendingPlaceholder />}
        {activeTab === 'news' && <NewsFeed />}
      </div>
    </div>
  );
}

// ─── Placeholder for Tendencias tab ───────────────────────────────

function TrendingPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-8 h-8 text-slate-600 mb-3"
      >
        <path
          fillRule="evenodd"
          d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
          clipRule="evenodd"
        />
      </svg>
      <p className="text-xs text-slate-500">Tendencias próximamente</p>
    </div>
  );
}
