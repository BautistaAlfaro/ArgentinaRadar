/**
 * ApprovalPanel — Replaces Telegram approval completely.
 *
 * Displays pending articles with:
 *   - Generated image (thumbnail, click to expand)
 *   - Title, source, category, date
 *   - AI scores (political, economic, social, urgency)
 *   - Tweet preview (formatted for Bluesky)
 *   - Buttons: Approve (publishes now) | Reject | Skip
 *   - Batch mode: Select All + Approve Selected
 *
 * After approve/reject → loads next article automatically.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '@shared/apiConfig';

const ADMIN_API = API.admin;

// ── Types ──────────────────────────────────────────────────────────────

interface AiScores {
  political?: number;
  economic?: number;
  social?: number;
  urgency?: number;
  quality?: number;
  relevance?: number;
  combined?: number;
}

interface QueuedArticle {
  id: string;
  article_id: string;
  draft_tweet: string;
  image_url: string | null;
  status: string;
  created_at: string;
  title: string | null;
  source: string | null;
  url: string | null;
  category: string | null;
  ai_scores: AiScores | null;
}

interface ApprovalQueueResponse {
  total: number;
  items: QueuedArticle[];
}

// ── Fetch pending approvals ────────────────────────────────────────────

function usePendingApprovals() {
  return useQuery<ApprovalQueueResponse>({
    queryKey: ['admin', 'pending-approvals'],
    queryFn: async () => {
      const resp = await fetch(`${ADMIN_API}/api/pipeline/approval-queue?status=pending`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
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

function scoreBar(value: number | undefined, max = 10): string {
  const v = Math.min(Math.max(value ?? 0, 0), max);
  const filled = Math.round((v / max) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ── Score Display ──────────────────────────────────────────────────────

function ScoreRow({ label, value, max = 10, color = 'text-blue-400' }: {
  label: string;
  value: number | undefined;
  max?: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono">
      <span className="text-slate-500 w-16 shrink-0">{label}</span>
      <span className={`${color} font-bold w-6 text-right`}>{(value ?? 0).toFixed(1)}</span>
      <span className="text-slate-700 text-[9px]">{scoreBar(value, max)}</span>
    </div>
  );
}

// ── Tweet Preview ──────────────────────────────────────────────────────

function TweetPreview({ text }: { text: string }) {
  return (
    <div className="bg-sky-900/20 border border-sky-500/20 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-sky-400 text-sm" aria-hidden="true">alternate_email</span>
        <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">Bluesky Preview</span>
      </div>
      <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap break-words font-mono text-[13px]">
        {text}
      </p>
      <p className="text-[10px] text-slate-600 mt-1">{text.length}/300 caracteres</p>
    </div>
  );
}

// ── Image Modal ────────────────────────────────────────────────────────

function ImageModal({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl cursor-pointer"
        aria-label="Close preview"
      >
        <span className="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function ApprovalPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = usePendingApprovals();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const items = data?.items ?? [];
  const currentItem = items[currentIndex] ?? null;

  // Reset index when list changes
  useEffect(() => {
    setCurrentIndex(0);
    setSelectedIds(new Set());
  }, [items.length]);

  // ── Approval mutation ─────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: async (articleId: string) => {
      const resp = await fetch(`${ADMIN_API}/api/admin/articles/${encodeURIComponent(articleId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: () => {
      setActionMsg({ text: '✅ Aprobado y publicado en Bluesky', ok: true });
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'workflow-stats'] });
    },
    onError: (err: Error) => {
      setActionMsg({ text: `❌ Error: ${err.message}`, ok: false });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (articleId: string) => {
      const resp = await fetch(`${ADMIN_API}/api/admin/articles/${encodeURIComponent(articleId)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: () => {
      setActionMsg({ text: '❌ Rechazado', ok: true });
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'workflow-stats'] });
    },
    onError: (err: Error) => {
      setActionMsg({ text: `❌ Error: ${err.message}`, ok: false });
    },
  });

  const batchApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const resp = await fetch(`${ADMIN_API}/api/admin/articles/batch-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: (data) => {
      setActionMsg({ text: `✅ ${data.approved} aprobados, ${data.published} publicados`, ok: true });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'workflow-stats'] });
    },
    onError: (err: Error) => {
      setActionMsg({ text: `❌ Error: ${err.message}`, ok: false });
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────

  const handleApprove = useCallback((articleId: string) => {
    setActionMsg({ text: '⏳ Publicando...', ok: true });
    approveMutation.mutate(articleId);
  }, [approveMutation]);

  const handleReject = useCallback((articleId: string) => {
    rejectMutation.mutate(articleId);
  }, [rejectMutation]);

  const handleSkip = useCallback(() => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, items.length]);

  const handleSelectAll = useCallback(() => {
    const pendings = items.filter((i) => i.status === 'pending').map((i) => i.article_id);
    setSelectedIds(new Set(pendings));
  }, [items]);

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBatchApprove = useCallback(() => {
    if (selectedIds.size === 0) return;
    setActionMsg({ text: `⏳ Aprobando ${selectedIds.size} artículos...`, ok: true });
    batchApproveMutation.mutate(Array.from(selectedIds));
  }, [selectedIds, batchApproveMutation]);

  // ── Render ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-slate-500 text-sm animate-pulse">Cargando artículos pendientes...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-red-400 text-sm font-mono">Error: {(error as Error).message}</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <span className="material-symbols-outlined text-5xl text-emerald-500/40" aria-hidden="true">fact_check</span>
        <p className="text-slate-500 text-sm">No hay artículos pendientes de aprobación</p>
        <p className="text-slate-600 text-[11px]">Los nuevos artículos aparecerán aquí automáticamente</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-4">
      {/* ── Action feedback ──────────────────────────────────────────── */}
      {actionMsg && (
        <div
          className={`px-4 py-2.5 rounded-lg text-xs font-mono border flex items-center gap-2 ${
            actionMsg.ok
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-red-500/10 text-red-300 border-red-500/30'
          }`}
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            {actionMsg.ok ? 'check_circle' : 'error'}
          </span>
          {actionMsg.text}
        </div>
      )}

      {/* ── Progress bar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
        <span>{currentIndex + 1} de {items.length} pendientes</span>
        <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500/50 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / items.length) * 100}%` }}
          />
        </div>
      </div>

      {/* ── Batch toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-1">
        <button
          type="button"
          onClick={handleSelectAll}
          className="text-[11px] text-on-surface-variant hover:text-primary transition-colors underline-offset-2 hover:underline cursor-pointer"
        >
          Select All ({items.filter((i) => i.status === 'pending').length})
        </button>
        <span className="text-slate-600" aria-hidden="true">|</span>
        <button
          type="button"
          onClick={() => setSelectedIds(new Set())}
          className="text-[11px] text-on-surface-variant hover:text-primary transition-colors underline-offset-2 hover:underline cursor-pointer"
        >
          Deselect All
        </button>
        {selectedIds.size > 0 && (
          <>
            <span className="text-[11px] text-slate-500 font-mono">{selectedIds.size} selected</span>
            <button
              type="button"
              onClick={handleBatchApprove}
              disabled={batchApproveMutation.isPending}
              className="ml-auto px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {batchApproveMutation.isPending ? 'Aprobando...' : `Approve ${selectedIds.size}`}
            </button>
          </>
        )}
      </div>

      {/* ── Current article card ──────────────────────────────────────── */}
      {currentItem && (
        <div className="flex-1 flex gap-6 min-h-0 overflow-y-auto">
          {/* Left: Image + Scores */}
          <div className="w-72 shrink-0 flex flex-col gap-4">
            {/* Image */}
            {currentItem.image_url ? (
              <button
                type="button"
                onClick={() => setExpandedImage(currentItem.image_url!)}
                className="block cursor-pointer"
                aria-label="Expand image"
              >
                <img
                  src={currentItem.image_url}
                  alt={currentItem.title ?? 'Article image'}
                  className="w-full rounded-xl border border-slate-700/30 object-cover aspect-[4/3] hover:opacity-90 transition-opacity"
                />
              </button>
            ) : (
              <div className="w-full aspect-[4/3] rounded-xl bg-slate-800 border border-slate-700/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-4xl text-slate-600" aria-hidden="true">image</span>
              </div>
            )}

            {/* AI Scores */}
            {currentItem.ai_scores && (
              <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/30">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">AI Scores</p>
                <div className="space-y-1">
                  <ScoreRow label="Política" value={currentItem.ai_scores.political} color="text-red-400" />
                  <ScoreRow label="Econ." value={currentItem.ai_scores.economic} color="text-emerald-400" />
                  <ScoreRow label="Social" value={currentItem.ai_scores.social} color="text-blue-400" />
                  <ScoreRow label="Urgencia" value={currentItem.ai_scores.urgency} color="text-amber-400" />
                  <ScoreRow label="Calidad" value={currentItem.ai_scores.quality} max={10} color="text-violet-400" />
                </div>
              </div>
            )}
          </div>

          {/* Right: Details + Actions */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            {/* Title + meta */}
            <div>
              <h2 className="text-lg font-bold text-white mb-1">{currentItem.title ?? 'Sin título'}</h2>
              <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                <span>{currentItem.source}</span>
                {currentItem.category && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="capitalize text-slate-400">{currentItem.category}</span>
                  </>
                )}
                <span className="text-slate-600">·</span>
                <span>{formatDate(currentItem.created_at)}</span>
              </div>
            </div>

            {/* Tweet Preview */}
            <TweetPreview text={currentItem.draft_tweet} />

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleApprove(currentItem.article_id)}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">check</span>
                {approveMutation.isPending ? 'Publicando...' : '✅ Approve'}
              </button>

              <button
                type="button"
                onClick={() => handleReject(currentItem.article_id)}
                disabled={rejectMutation.isPending || approveMutation.isPending}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">close</span>
                ❌ Reject
              </button>

              <button
                type="button"
                onClick={handleSkip}
                disabled={currentIndex >= items.length - 1}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-slate-700/40 text-slate-400 border border-slate-700/30 hover:bg-slate-700/60 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">skip_next</span>
                ⏭️ Skip
              </button>
            </div>

            {/* Source link */}
            {currentItem.url && (
              <a
                href={currentItem.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-500 hover:text-primary transition-colors underline-offset-2 hover:underline mt-1 inline-flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">open_in_new</span>
                Ver artículo original
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Image expand modal ─────────────────────────────────────────── */}
      {expandedImage && (
        <ImageModal
          src={expandedImage}
          alt="Article image"
          onClose={() => setExpandedImage(null)}
        />
      )}
    </div>
  );
}
