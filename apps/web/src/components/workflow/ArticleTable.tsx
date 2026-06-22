/**
 * ArticleTable — Ingest phase: list of articles with filters and search.
 *
 * Columns: title, source, category, date, status
 * Filters: by source, category, status
 * Search: by text (title/summary)
 * Click on article → shows detail in a side panel
 */

import { useState, useEffect, useCallback } from 'react';
import { API } from '@shared/apiConfig';

const ADMIN_API = API.admin;

// ── Types ──────────────────────────────────────────────────────────────

interface ArticleItem {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  url: string;
  category: string | null;
  published_at: string | null;
  ingested_at: string;
  location: string | null;
  status: string;
  quality_score: number | null;
  engagement_score: number | null;
  relevance_score: number | null;
  ai_scores: Record<string, unknown> | null;
}

interface ArticlesResponse {
  total: number;
  items: ArticleItem[];
}

interface SourceDef {
  source: string;
  count: number;
}

interface CategoryDef {
  category: string | null;
  count: number;
}

// ── Status config ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; icon: string }> = {
  ingested:         { color: 'text-sky-400',   icon: 'cloud_download' },
  geolocated:       { color: 'text-amber-400',  icon: 'location_on' },
  filtered:         { color: 'text-blue-400',   icon: 'psychology' },
  pending_approval: { color: 'text-violet-400', icon: 'pending_actions' },
  published:        { color: 'text-emerald-400',icon: 'check_circle' },
  auto_published:   { color: 'text-emerald-400',icon: 'auto_awesome' },
  discarded:        { color: 'text-red-400',    icon: 'delete' },
};

const DEFAULT_STATUS = { color: 'text-slate-400', icon: 'description' };

// ── Helpers ────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Component ──────────────────────────────────────────────────────────

export function ArticleTable() {
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  // Filter options
  const [sources, setSources] = useState<SourceDef[]>([]);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<ArticleItem | null>(null);

  // ── Fetch filter options ──────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch(`${ADMIN_API}/api/admin/articles/sources`).then((r) => r.json()),
      fetch(`${ADMIN_API}/api/admin/articles/categories`).then((r) => r.json()),
    ])
      .then(([srcData, catData]) => {
        setSources(srcData.sources ?? []);
        setCategories(catData.categories ?? []);
      })
      .catch(() => { /* silent */ });
  }, []);

  // ── Fetch articles ────────────────────────────────────────────────

  const loadArticles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (source) params.set('source', source);
      if (category) params.set('category', category);
      if (search) params.set('search', search);
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));

      const resp = await fetch(`${ADMIN_API}/api/admin/articles?${params}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as ArticlesResponse;
      setArticles(data.items);
      setTotal(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, source, category, search, page]);

  useEffect(() => { void loadArticles(); }, [loadArticles]);

  const totalPages = Math.ceil(total / pageSize);

  // ── Status badge ──────────────────────────────────────────────────

  function StatusBadge({ s }: { s: string }) {
    const cfg = STATUS_CONFIG[s] ?? DEFAULT_STATUS;
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded font-jetbrains-mono ${cfg.color} bg-slate-700/40`}>
        <span className="material-symbols-outlined text-[10px]" aria-hidden="true">{cfg.icon}</span>
        {s.replace(/_/g, ' ')}
      </span>
    );
  }

  // ── Article Detail Panel ──────────────────────────────────────────

  if (selectedArticle) {
    return (
      <div className="flex-1 flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setSelectedArticle(null)}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-primary transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_back</span>
          Volver a la lista
        </button>

        <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-6">
          <h2 className="text-xl font-bold text-white mb-2">{selectedArticle.title}</h2>
          <div className="flex flex-wrap gap-3 text-xs text-slate-500 font-mono mb-4">
            <span>📌 {selectedArticle.source}</span>
            {selectedArticle.category && <span>🏷️ {selectedArticle.category}</span>}
            <span>📅 {formatDate(selectedArticle.ingested_at)}</span>
            <StatusBadge s={selectedArticle.status} />
          </div>

          {selectedArticle.summary && (
            <p className="text-sm text-slate-300 leading-relaxed mb-4">{selectedArticle.summary}</p>
          )}

          {selectedArticle.url && (
            <a
              href={selectedArticle.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">open_in_new</span>
              Ver artículo original
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Main list ─────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-4">
      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" aria-hidden="true">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Buscar artículos..."
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary/50"
            aria-label="Search articles"
          />
        </div>

        {/* Status filter */}
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-primary/50"
          aria-label="Filter by status"
        >
          <option value="">All status</option>
          <option value="ingested">Ingested</option>
          <option value="geolocated">Geolocated</option>
          <option value="filtered">Filtered</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="published">Published</option>
          <option value="discarded">Discarded</option>
        </select>

        {/* Source filter */}
        <select
          value={source}
          onChange={(e) => { setSource(e.target.value); setPage(0); }}
          className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-primary/50"
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.source} value={s.source}>{s.source} ({s.count})</option>
          ))}
        </select>

        {/* Category filter */}
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(0); }}
          className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-primary/50"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category ?? ''}>{c.category} ({c.count})</option>
          ))}
        </select>
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-700/30 bg-slate-900/40">
        {loading && (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-slate-700/20 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="p-6 text-center text-sm text-red-400 font-mono">{error}</div>
        )}

        {!loading && !error && articles.length === 0 && (
          <div className="p-12 text-center text-sm text-slate-500">No se encontraron artículos</div>
        )}

        {!loading && articles.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/90 backdrop-blur-sm">
              <tr className="border-b border-slate-700/30 text-[10px] text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Título</th>
                <th className="px-4 py-3 text-left w-28">Fuente</th>
                <th className="px-4 py-3 text-left w-24">Categoría</th>
                <th className="px-4 py-3 text-left w-20">Fecha</th>
                <th className="px-4 py-3 text-left w-28">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/20">
              {articles.map((article) => (
                <tr
                  key={article.id}
                  onClick={() => setSelectedArticle(article)}
                  className="hover:bg-slate-700/20 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p className="text-sm text-slate-200 font-medium truncate max-w-[400px]" title={article.title}>
                      {article.title}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono">{article.source}</td>
                  <td className="px-4 py-3">
                    {article.category ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 capitalize">
                        {article.category}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-500 font-mono whitespace-nowrap">
                    {formatDate(article.ingested_at)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge s={article.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
          <span>{total} artículos · Página {page + 1} de {totalPages}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1 rounded bg-slate-700/40 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              ← Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded bg-slate-700/40 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
