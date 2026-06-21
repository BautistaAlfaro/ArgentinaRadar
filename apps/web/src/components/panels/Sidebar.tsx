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
import { TrendingTopics } from './TrendingTopics';
import { EventTimeline } from '../EventTimeline';

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
        {activeTab === 'trending' && <TrendingTopics />}
        {activeTab === 'news' && <NewsFeed />}
      </div>

      {/* Overlay timeline when an event is selected */}
      <EventTimeline />
    </div>
  );
}


