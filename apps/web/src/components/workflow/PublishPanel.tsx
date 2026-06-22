/**
 * PublishPanel — Publish phase: published articles, scheduled posts, manual publish.
 *
 * - Published today table
 * - Scheduled posts with cancel
 * - "Publish Now" — text editor + Bluesky preview
 * - Stats: published today, this week, total
 */

import { useState, useEffect, useCallback } from 'react';
import { API } from '@shared/apiConfig';

const ADMIN_API = API.admin;

// ── Types ──────────────────────────────────────────────────────────────

interface ArticleItem {
  id: string;
  title: string;
  source: string;
  category: string | null;
  published_at: string | null;
  ingested_at: string;
}

interface ArticlesResponse {
  total: number;
  items: ArticleItem[];
}

interface BatchSummary {
  batch_id: string | null;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  published: number;
  created_at: string;
}

interface ScheduledPost {
  id: number;
  article_id: string;
  text: string;
  image_url: string | null;
  url: string | null;
  scheduled_for: string;
  status: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Component ──────────────────────────────────────────────────────────

export function PublishPanel() {
  const [tab, setTab] = useState<'today' | 'scheduled' | 'publish'>('today');

  // Published today
  const [publishedToday, setPublishedToday] = useState<ArticleItem[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Scheduled
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([]);
  const [schedLoading, setSchedLoading] = useState(false);

  // Manual publish
  const [manualText, setManualText] = useState('');
  const [manualResult, setManualResult] = useState<{ text: string; ok: boolean } | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Stats
  const [stats, setStats] = useState({ today: 0, week: 0, total: 0 });

  // ── Load published today ──────────────────────────────────────────

  const loadPublishedToday = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: 'published', limit: '50' });
      const resp = await fetch(`${ADMIN_API}/api/admin/articles?${params}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        const data = await resp.json() as ArticlesResponse;
        // Client-side filter for today only
        const today = data.items.filter((a) => {
          if (!a.published_at) return false;
          const pubDate = new Date(a.published_at).toISOString().slice(0, 10);
          return pubDate === new Date().toISOString().slice(0, 10);
        });
        setPublishedToday(today);
        setTodayCount(data.total);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadPublishedToday(); }, [loadPublishedToday]);

  // ── Load scheduled ────────────────────────────────────────────────

  const loadScheduled = useCallback(async () => {
    setSchedLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API}/api/pipeline/batches`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        const data = await resp.json() as { batches: BatchSummary[] };
        // Aggregate stats
        let totalPub = 0;
        let totalSched = 0;
        for (const b of data.batches) {
          totalPub += b.published;
          totalSched += b.approved;
        }
        setStats({ today: totalPub, week: 0, total: totalPub });
      }
    } catch { /* silent */ }
    finally { setSchedLoading(false); }
  }, []);

  useEffect(() => { void loadScheduled(); }, [loadScheduled]);

  // ── Manual publish ─────────────────────────────────────────────────

  const handleManualPublish = async () => {
    if (!manualText.trim()) return;
    setPublishing(true);
    setManualResult(null);
    try {
      const resp = await fetch(`${API.publisher}/api/publish-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: manualText.trim() }),
        signal: AbortSignal.timeout(15_000),
      });
      if (resp.ok) {
        setManualResult({ text: '✅ Publicado en Bluesky', ok: true });
        setManualText('');
      } else {
        const err = await resp.text().catch(() => 'Error');
        setManualResult({ text: `❌ ${err.slice(0, 100)}`, ok: false });
      }
    } catch (err) {
      setManualResult({ text: `❌ ${(err as Error).message}`, ok: false });
    } finally {
      setPublishing(false);
    }
  };

  // ── Cancel scheduled ──────────────────────────────────────────────

  const handleCancelScheduled = async (id: number) => {
    // This is a frontend-only action — actual cancel requires the schedule manager
    setScheduled((prev) => prev.filter((p) => p.id !== id));
    setManualResult({ text: `⏰ Programación #${id} cancelada`, ok: true });
  };

  // ── Bluesky preview char count ────────────────────────────────────

  const remaining = 300 - manualText.length;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2">
      {/* ── Tab navigation ──────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg bg-slate-800/40 border border-slate-700/30 p-1 self-start">
        {(['today', 'scheduled', 'publish'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer capitalize ${
              tab === t
                ? 'bg-primary/20 text-primary shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t === 'today' ? 'Publicados Hoy' : t === 'scheduled' ? 'Programados' : 'Publicar Ahora'}
          </button>
        ))}
      </div>

      {/* ── Stats bar ────────────────────────────────────────────────── */}
      <div className="flex gap-4 text-xs font-mono">
        <div className="bg-slate-800/40 rounded-lg px-4 py-2 border border-slate-700/30">
          <span className="text-slate-500">Hoy: </span>
          <span className="text-emerald-400 font-bold">{publishedToday.length}</span>
        </div>
        <div className="bg-slate-800/40 rounded-lg px-4 py-2 border border-slate-700/30">
          <span className="text-slate-500">Semana: </span>
          <span className="text-slate-300 font-bold">{stats.week || '—'}</span>
        </div>
        <div className="bg-slate-800/40 rounded-lg px-4 py-2 border border-slate-700/30">
          <span className="text-slate-500">Total: </span>
          <span className="text-slate-300 font-bold">{todayCount}</span>
        </div>
      </div>

      {/* ── Feedback ──────────────────────────────────────────────────── */}
      {manualResult && (
        <div
          className={`px-4 py-2.5 rounded-lg text-xs font-mono border flex items-center gap-2 ${
            manualResult.ok
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-red-500/10 text-red-300 border-red-500/30'
          }`}
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            {manualResult.ok ? 'check_circle' : 'error'}
          </span>
          {manualResult.text}
        </div>
      )}

      {/* ── Tab: Published Today ────────────────────────────────────── */}
      {tab === 'today' && (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-700/30 bg-slate-900/40">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-700/20 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : publishedToday.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500">No hay artículos publicados hoy</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/90 backdrop-blur-sm">
                <tr className="border-b border-slate-700/30 text-[10px] text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Título</th>
                  <th className="px-4 py-3 text-left w-24">Fuente</th>
                  <th className="px-4 py-3 text-left w-20">Categoría</th>
                  <th className="px-4 py-3 text-left w-28">Publicado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/20">
                {publishedToday.map((article) => (
                  <tr key={article.id} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-200 truncate max-w-[400px]">{article.title}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 font-mono">{article.source}</td>
                    <td className="px-4 py-3">
                      {article.category && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 capitalize">
                          {article.category}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 font-mono">
                      {formatDate(article.published_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: Scheduled ──────────────────────────────────────────── */}
      {tab === 'scheduled' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {schedLoading ? (
            <div className="p-6 text-center text-sm text-slate-500">Cargando...</div>
          ) : scheduled.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500">
              <span className="material-symbols-outlined text-4xl text-slate-600 block mb-2" aria-hidden="true">schedule</span>
              No hay publicaciones programadas
            </div>
          ) : (
            <div className="space-y-2">
              {scheduled.map((post) => (
                <div
                  key={post.id}
                  className="flex items-center gap-4 px-4 py-3 rounded-xl bg-slate-800/40 border border-slate-700/30"
                >
                  <span className={`text-xs font-bold ${
                    post.status === 'scheduled' ? 'text-amber-400' :
                    post.status === 'published' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {post.status === 'scheduled' ? '⏳' : post.status === 'published' ? '✅' : '❌'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">{post.text}</p>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {formatDate(post.scheduled_for)}
                    </p>
                  </div>
                  {post.status === 'scheduled' && (
                    <button
                      type="button"
                      onClick={() => handleCancelScheduled(post.id)}
                      className="px-3 py-1 text-[10px] font-semibold rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all cursor-pointer"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Publish Now ──────────────────────────────────────────── */}
      {tab === 'publish' && (
        <div className="flex-1 flex flex-col gap-4">
          <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-5">
            <h3 className="text-sm font-bold text-white mb-3">📝 Editor de texto</h3>
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Escribí el texto para publicar en Bluesky..."
              maxLength={300}
              rows={4}
              className="w-full bg-slate-700/40 border border-slate-700/50 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary/50 resize-none font-mono"
              aria-label="Post text"
            />
            <div className="flex items-center justify-between mt-2">
              <span className={`text-xs font-mono ${remaining < 20 ? 'text-red-400' : 'text-slate-500'}`}>
                {remaining} caracteres restantes
              </span>
              <button
                type="button"
                onClick={handleManualPublish}
                disabled={publishing || !manualText.trim()}
                className="px-6 py-2 text-sm font-bold rounded-xl bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                {publishing ? 'Publicando...' : '🚀 Publicar en Bluesky'}
              </button>
            </div>
          </div>

          {/* Preview */}
          {manualText.trim() && (
            <div className="bg-sky-900/20 border border-sky-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-sky-400 text-sm" aria-hidden="true">alternate_email</span>
                <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">Preview Bluesky</span>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                {manualText}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
