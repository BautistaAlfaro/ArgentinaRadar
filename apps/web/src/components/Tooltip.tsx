/**
 * Hover tooltip — appears when hovering a news marker.
 * Shows headline (≤80 chars) + source name.
 */

import type { NewsItem } from '@shared/types';

interface TooltipProps {
  article: NewsItem;
  x: number;
  y: number;
}

export function Tooltip({ article, x, y }: TooltipProps) {
  const truncatedHeadline =
    article.title.length > 80
      ? article.title.slice(0, 80) + '…'
      : article.title;

  return (
    <div
      className="pointer-events-none absolute z-50 bg-slate-800/95 backdrop-blur-sm border border-slate-600/50 rounded-lg px-3 py-2 shadow-xl"
      style={{
        left: x + 12,
        top: y + 12,
        maxWidth: 280,
      }}
    >
      <p className="text-sm font-medium text-slate-100 leading-snug">
        {truncatedHeadline}
      </p>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-xs text-slate-400">{article.source}</span>
        <SourceIcon />
      </div>
    </div>
  );
}

function SourceIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="w-3 h-3 text-slate-500"
    >
      <path d="M3.196 12.87l-.825.483a.75.75 0 000 1.294l7.25 4.25a.75.75 0 00.758 0l7.25-4.25a.75.75 0 000-1.294l-.825-.484-5.666 3.322a2.25 2.25 0 01-2.276 0L3.196 12.87z" />
      <path d="M3.196 8.87l-.825.483a.75.75 0 000 1.294l7.25 4.25a.75.75 0 00.758 0l7.25-4.25a.75.75 0 000-1.294l-.825-.484-5.666 3.322a2.25 2.25 0 01-2.276 0L3.196 8.87z" />
      <path d="M10.38 1.103a.75.75 0 00-.76 0l-7.25 4.25a.75.75 0 000 1.294l7.25 4.25a.75.75 0 00.76 0l7.25-4.25a.75.75 0 000-1.294l-7.25-4.25z" />
    </svg>
  );
}
