/**
 * Click popup — appears when clicking a news marker on the globe.
 * Shows: full headline, 200-char summary, source, timestamp, "Leer más" link.
 */

import type { NewsItem } from '@shared/types';

interface PopupProps {
  article: NewsItem;
  x: number;
  y: number;
  onClose: () => void;
}

export function Popup({ article, x, y, onClose }: PopupProps) {
  const truncatedSummary =
    article.summary.length > 200
      ? article.summary.slice(0, 200) + '…'
      : article.summary;

  const formattedDate = new Date(article.publishedAt).toLocaleString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="absolute z-50 bg-slate-800/95 backdrop-blur-sm border border-slate-600/50 rounded-lg shadow-xl"
      style={{
        left: x + 12,
        top: y + 12,
        width: 320,
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-slate-700/50 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors cursor-pointer"
        aria-label="Cerrar"
       type="button">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>

      {/* Content */}
      <div className="p-4 pr-8">
        <h3 className="text-sm font-semibold text-white leading-snug mb-2">
          {article.title}
        </h3>

        <p className="text-xs text-slate-300 leading-relaxed mb-3">
          {truncatedSummary}
        </p>

        <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
          <span className="font-medium text-slate-300">{article.source}</span>
          <span>{formattedDate}</span>
        </div>

        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors"
        >
          Leer más
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z" />
          </svg>
        </a>
      </div>
    </div>
  );
}

