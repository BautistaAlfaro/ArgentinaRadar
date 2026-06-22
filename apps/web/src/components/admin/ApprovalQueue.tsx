/**
 * ApprovalQueue — Batch tweet draft review panel.
 *
 * Layout:
 *   Left column  — batch list with per-status counts
 *   Right column — item list for the selected batch, with checkboxes
 *
 * Actions:
 *   Approve Selected   — sets status='approved' for checked pending items
 *   Reject Selected    — sets status='rejected' for checked pending items
 *   Publish Approved   — sets status='published' for all approved items in batch
 */

import { useState, useEffect, useCallback } from 'react';

const ADMIN_API = 'http://localhost:3012';

// ── Types ──────────────────────────────────────────────────────────────

interface BatchSummary {
  batch_id: string | null;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  published: number;
  created_at: string;
}

interface QueueItem {
  id: number;
  article_id: number;
  tweet_draft: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  published_at: string | null;
  tweet_id: string | null;
  batch_id: string | null;
  title: string | null;
  source: string | null;
  url: string | null;
}

type FilterStatus = 'pending' | 'approved' | 'rejected' | 'published';

// ── Helpers ────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortBatchId(batchId: string | null): string {
  if (!batchId) return '(no batch)';
  return batchId.length > 20 ? batchId.slice(0, 20) + '...' : batchId;
}

// ── Sub-components ─────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const map: Record<string, string> = {
    pending:   'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    approved:  'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    rejected:  'bg-red-500/20 text-red-300 border border-red-500/30',
    published: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  };
  const cls = map[status] ?? 'bg-slate-500/20 text-slate-300 border border-slate-500/30';
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded font-jetbrains-mono ${cls}`}>
      {status}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function ApprovalQueue() {
  // ─ Batches state ─
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  // ─ Selected batch + filter ─
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');

  // ─ Items state ─
  const [items, setItems] = useState<QueueItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // ─ Selection ─
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // ─ Action state ─
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // ── Load batches ────────────────────────────────────────────────────

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    setBatchesError(null);
    try {
      const resp = await fetch(`${ADMIN_API}/api/pipeline/batches`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { batches: BatchSummary[] };
      setBatches(data.batches);
    } catch (err) {
      setBatchesError((err as Error).message);
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  useEffect(() => { void loadBatches(); }, [loadBatches]);

  // ── Load items ──────────────────────────────────────────────────────

  const loadItems = useCallback(async (batchId: string | null, status: FilterStatus) => {
    setItemsLoading(true);
    setItemsError(null);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ status });
      if (batchId) params.set('batch', batchId);
      const resp = await fetch(`${ADMIN_API}/api/pipeline/approval-queue?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { total: number; items: QueueItem[] };
      setItems(data.items);
    } catch (err) {
      setItemsError((err as Error).message);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems(selectedBatch, filterStatus);
  }, [selectedBatch, filterStatus, loadItems]);

  // ── Selection helpers ───────────────────────────────────────────────

  function toggleItem(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(items.map((i) => i.id)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  // ── Actions ─────────────────────────────────────────────────────────

  async function handleApproveOrReject(action: 'approve' | 'reject') {
    if (selected.size === 0) return;
    setActionLoading(true);
    setActionMessage(null);
    try {
      const resp = await fetch(`${ADMIN_API}/api/pipeline/approve-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { approved: number; rejected: number };
      const count = action === 'approve' ? data.approved : data.rejected;
      setActionMessage({ text: `${action === 'approve' ? 'Approved' : 'Rejected'} ${count} item(s)`, ok: true });
      await loadItems(selectedBatch, filterStatus);
      await loadBatches();
    } catch (err) {
      setActionMessage({ text: (err as Error).message, ok: false });
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePublish() {
    const approvedIds = items
      .filter((i) => i.status === 'approved')
      .map((i) => i.id);

    if (approvedIds.length === 0) {
      setActionMessage({ text: 'No approved items in this batch to publish', ok: false });
      return;
    }

    setActionLoading(true);
    setActionMessage(null);
    try {
      const resp = await fetch(`${ADMIN_API}/api/pipeline/publish-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: approvedIds }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { published: number };
      setActionMessage({ text: `Published ${data.published} item(s) to DB`, ok: true });
      await loadItems(selectedBatch, filterStatus);
      await loadBatches();
    } catch (err) {
      setActionMessage({ text: (err as Error).message, ok: false });
    } finally {
      setActionLoading(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  const STATUS_FILTERS: FilterStatus[] = ['pending', 'approved', 'rejected', 'published'];

  return (
    <div className="flex gap-2 h-full">

      {/* ─── Left: Batch list ────────────────────────────────────────── */}
      <aside className="glass-panel rounded-xl p-4 w-64 shrink-0 flex flex-col gap-2 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white tracking-tight">Batches</h3>
          <button
            type="button"
            onClick={() => void loadBatches()}
            className="text-on-surface-variant hover:text-primary transition-colors"
            title="Refresh batches"
            aria-label="Refresh batches"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
          </button>
        </div>

        {batchesLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 bg-slate-700/30 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {batchesError && (
          <p className="text-xs text-red-400 font-mono">{batchesError}</p>
        )}

        {/* "All batches" option */}
        {!batchesLoading && (
          <button
            type="button"
            onClick={() => setSelectedBatch(null)}
            className={`text-left px-3 py-2 rounded-lg border transition-all text-xs ${
              selectedBatch === null
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-white/10 text-on-surface-variant hover:border-white/20 hover:text-white'
            }`}
          >
            <div className="font-semibold mb-1">All batches</div>
            <div className="text-[10px] font-mono text-slate-500">
              {batches.reduce((s, b) => s + b.total, 0)} total items
            </div>
          </button>
        )}

        {batches.map((batch) => (
          <button
            key={batch.batch_id ?? '__null__'}
            type="button"
            onClick={() => setSelectedBatch(batch.batch_id)}
            className={`text-left px-3 py-2 rounded-lg border transition-all ${
              selectedBatch === batch.batch_id
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-white/10 text-on-surface-variant hover:border-white/20 hover:text-white'
            }`}
          >
            <div className="text-xs font-semibold truncate mb-1" title={batch.batch_id ?? undefined}>
              {shortBatchId(batch.batch_id)}
            </div>
            <div className="text-[10px] font-jetbrains-mono text-slate-500">
              {formatDate(batch.created_at)}
            </div>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {batch.pending > 0 && (
                <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded font-bold">
                  {batch.pending} pending
                </span>
              )}
              {batch.approved > 0 && (
                <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1 py-0.5 rounded font-bold">
                  {batch.approved} approved
                </span>
              )}
              {batch.published > 0 && (
                <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.5 rounded font-bold">
                  {batch.published} published
                </span>
              )}
              {batch.rejected > 0 && (
                <span className="text-[9px] bg-red-500/20 text-red-300 px-1 py-0.5 rounded font-bold">
                  {batch.rejected} rejected
                </span>
              )}
            </div>
          </button>
        ))}

        {!batchesLoading && batches.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-4">No batches found</p>
        )}
      </aside>

      {/* ─── Right: Item list ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">

        {/* ── Toolbar ────────────────────────────────────────────── */}
        <div className="glass-panel rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">

          {/* Status filter tabs */}
          <div className="flex rounded border border-white/10 bg-surface-container-lowest/80 p-0.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-all cursor-pointer font-inter ${
                  filterStatus === s
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Selection controls */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={selectAll}
              className="text-[11px] text-on-surface-variant hover:text-primary transition-colors underline-offset-2 hover:underline"
            >
              Select All
            </button>
            <span className="text-slate-600">|</span>
            <button
              type="button"
              onClick={deselectAll}
              className="text-[11px] text-on-surface-variant hover:text-primary transition-colors underline-offset-2 hover:underline"
            >
              Deselect All
            </button>
            {selected.size > 0 && (
              <span className="text-[11px] text-slate-500 font-mono">
                {selected.size} selected
              </span>
            )}
          </div>

          {/* Action buttons */}
          {filterStatus === 'pending' && (
            <>
              <button
                type="button"
                disabled={selected.size === 0 || actionLoading}
                onClick={() => void handleApproveOrReject('approve')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <span className="material-symbols-outlined text-sm">check</span>
                Approve Selected
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || actionLoading}
                onClick={() => void handleApproveOrReject('reject')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <span className="material-symbols-outlined text-sm">close</span>
                Reject Selected
              </button>
            </>
          )}

          {filterStatus === 'approved' && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void handlePublish()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <span className="material-symbols-outlined text-sm">publish</span>
              Publish Approved
            </button>
          )}
        </div>

        {/* ── Action feedback ────────────────────────────────────── */}
        {actionMessage && (
          <div
            className={`px-4 py-2.5 rounded-lg text-xs font-mono border ${
              actionMessage.ok
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30'
            }`}
          >
            {actionMessage.ok
              ? <span className="material-symbols-outlined text-sm align-middle mr-1.5">check_circle</span>
              : <span className="material-symbols-outlined text-sm align-middle mr-1.5">error</span>
            }
            {actionMessage.text}
          </div>
        )}

        {/* ── Item list ──────────────────────────────────────────── */}
        <div className="glass-panel rounded-xl flex-1 overflow-y-auto">
          {itemsLoading && (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-700/30 rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {itemsError && (
            <div className="p-6 text-center text-sm text-red-400 font-mono">{itemsError}</div>
          )}

          {!itemsLoading && !itemsError && items.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-500">
              No {filterStatus} items
              {selectedBatch ? ` in this batch` : ``}.
            </div>
          )}

          {!itemsLoading && items.map((item) => {
            const isChecked = selected.has(item.id);
            const isSelectable = item.status === 'pending';

            return (
              <div
                key={item.id}
                className={`flex gap-3 px-4 py-3 border-b border-white/5 last:border-b-0 transition-colors ${
                  isChecked ? 'bg-primary/5' : 'hover:bg-white/3'
                }`}
              >
                {/* Checkbox — only for pending items */}
                <div className="flex items-start pt-0.5">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={!isSelectable}
                    onChange={() => toggleItem(item.id)}
                    className="w-4 h-4 accent-primary cursor-pointer disabled:cursor-default disabled:opacity-40"
                    aria-label={`Select item ${item.id}`}
                  />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={item.status} />
                    {item.source && (
                      <span className="text-[10px] text-slate-500 font-mono truncate">
                        {item.source}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-600 font-mono ml-auto shrink-0">
                      {formatDate(item.created_at)}
                    </span>
                  </div>

                  {item.title && (
                    <p className="text-xs font-semibold text-on-surface mb-1 truncate" title={item.title}>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary transition-colors"
                        >
                          {item.title}
                        </a>
                      ) : item.title}
                    </p>
                  )}

                  <blockquote className="text-xs text-slate-300 leading-relaxed border-l-2 border-primary/30 pl-2.5 line-clamp-3">
                    {item.tweet_draft}
                  </blockquote>

                  {(item.approved_at || item.published_at) && (
                    <div className="flex gap-3 mt-1.5 text-[10px] text-slate-600 font-mono">
                      {item.approved_at && <span>Approved: {formatDate(item.approved_at)}</span>}
                      {item.published_at && <span>Published: {formatDate(item.published_at)}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
