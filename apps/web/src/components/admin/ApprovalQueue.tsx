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

import { useState, useEffect, useCallback, useReducer } from 'react';

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

// ── Module-scoped static values ──────────────────────────────────────

const STATUS_FILTERS: FilterStatus[] = ['pending', 'approved', 'rejected', 'published'];

const STATUS_BADGE_MAP: Record<string, string> = {
  pending:   'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  approved:  'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  rejected:  'bg-red-500/20 text-red-300 border border-red-500/30',
  published: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
};

const ACTION_COLORS: Record<string, string> = {
  approve: 'bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/30',
  reject:  'bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30',
  publish: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30',
};

// ── Reducers ─────────────────────────────────────────────────────────

type BatchAction =
  | { type: 'LOADING' }
  | { type: 'SUCCESS'; batches: BatchSummary[] }
  | { type: 'ERROR'; error: string }
  | { type: 'REFRESH'; batches: BatchSummary[] };

type ItemsAction =
  | { type: 'LOADING' }
  | { type: 'SUCCESS'; items: QueueItem[] }
  | { type: 'ERROR'; error: string }
  | { type: 'SELECT'; id: number }
  | { type: 'SELECT_ALL'; ids: number[] }
  | { type: 'DESELECT_ALL' };

type UIAction =
  | { type: 'SELECT_BATCH'; batchId: string | null }
  | { type: 'SET_FILTER'; status: FilterStatus }
  | { type: 'ACTION_START' }
  | { type: 'ACTION_DONE'; message: { text: string; ok: boolean } | null };

interface BatchState {
  batches: BatchSummary[];
  loading: boolean;
  error: string | null;
}

interface ItemsState {
  items: QueueItem[];
  loading: boolean;
  error: string | null;
  selected: Set<number>;
}

interface UIState {
  selectedBatch: string | null;
  filterStatus: FilterStatus;
  actionLoading: boolean;
  actionMessage: { text: string; ok: boolean } | null;
}

function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case 'LOADING': return { ...state, loading: true, error: null };
    case 'SUCCESS': return { batches: action.batches, loading: false, error: null };
    case 'ERROR': return { ...state, loading: false, error: action.error };
    case 'REFRESH': return { ...state, batches: action.batches };
  }
}

function itemsReducer(state: ItemsState, action: ItemsAction): ItemsState {
  switch (action.type) {
    case 'LOADING': return { ...state, loading: true, error: null };
    case 'SUCCESS': return { items: action.items, loading: false, error: null, selected: new Set() };
    case 'ERROR': return { ...state, loading: false, error: action.error };
    case 'SELECT': {
      const next = new Set(state.selected);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selected: next };
    }
    case 'SELECT_ALL': return { ...state, selected: new Set(action.ids) };
    case 'DESELECT_ALL': return { ...state, selected: new Set() };
  }
}

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SELECT_BATCH': return { ...state, selectedBatch: action.batchId };
    case 'SET_FILTER': return { ...state, filterStatus: action.status };
    case 'ACTION_START': return { ...state, actionLoading: true, actionMessage: null };
    case 'ACTION_DONE': return { ...state, actionLoading: false, actionMessage: action.message };
  }
}

// ── Initial state ─────────────────────────────────────────────────────

const initialBatchState: BatchState = { batches: [], loading: true, error: null };
const initialItemsState: ItemsState = { items: [], loading: false, error: null, selected: new Set() };
const initialUIState: UIState = { selectedBatch: null, filterStatus: 'pending', actionLoading: false, actionMessage: null };

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

// ── Sub-components ────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const cls = STATUS_BADGE_MAP[status] ?? 'bg-slate-500/20 text-slate-300 border border-slate-500/30';
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded font-jetbrains-mono ${cls}`}>
      {status}
    </span>
  );
}

function BatchCard({
  batch,
  isSelected,
  onClick,
}: {
  batch: BatchSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-3 py-2 rounded-lg border transition-all ${
        isSelected
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
  );
}

function FilterTab({
  status,
  isActive,
  onClick,
}: {
  status: FilterStatus;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-all cursor-pointer font-inter ${
        isActive
          ? 'bg-primary text-on-primary shadow-sm'
          : 'text-on-surface-variant hover:text-primary'
      }`}
    >
      {status}
    </button>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled: boolean;
  variant: 'approve' | 'reject' | 'publish';
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ${ACTION_COLORS[variant]} disabled:opacity-40 disabled:cursor-not-allowed transition-all`}
    >
      <span className="material-symbols-outlined text-sm" aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

function QueueItemRow({
  item,
  isChecked,
  onToggle,
}: {
  item: QueueItem;
  isChecked: boolean;
  onToggle: (id: number) => void;
}) {
  const isSelectable = item.status === 'pending';

  return (
    <div
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
          onChange={() => onToggle(item.id)}
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
}

// ── Main component ─────────────────────────────────────────────────────

export function ApprovalQueue() {
  const [batchState, dispatchBatch] = useReducer(batchReducer, initialBatchState);
  const [itemsState, dispatchItems] = useReducer(itemsReducer, initialItemsState);
  const [uiState, dispatchUI] = useReducer(uiReducer, initialUIState);

  const { batches, loading: batchesLoading, error: batchesError } = batchState;
  const { items, loading: itemsLoading, error: itemsError, selected } = itemsState;
  const { selectedBatch, filterStatus, actionLoading, actionMessage } = uiState;

  // ── Load batches ────────────────────────────────────────────────────

  const loadBatches = useCallback(async () => {
    dispatchBatch({ type: 'LOADING' });
    try {
      const resp = await fetch(`${ADMIN_API}/api/pipeline/batches`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { batches: BatchSummary[] };
      dispatchBatch({ type: 'SUCCESS', batches: data.batches });
    } catch (err) {
      dispatchBatch({ type: 'ERROR', error: (err as Error).message });
    }
  }, []);

  useEffect(() => { void loadBatches(); }, [loadBatches]);

  // ── Load items ──────────────────────────────────────────────────────

  const loadItems = useCallback(async (batchId: string | null, status: FilterStatus) => {
    dispatchItems({ type: 'LOADING' });
    try {
      const params = new URLSearchParams({ status });
      if (batchId) params.set('batch', batchId);
      const resp = await fetch(`${ADMIN_API}/api/pipeline/approval-queue?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { total: number; items: QueueItem[] };
      dispatchItems({ type: 'SUCCESS', items: data.items });
    } catch (err) {
      dispatchItems({ type: 'ERROR', error: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void loadItems(selectedBatch, filterStatus);
  }, [selectedBatch, filterStatus, loadItems]);

  // ── Selection helpers ───────────────────────────────────────────────

  const handleSelectAll = () => {
    dispatchItems({ type: 'SELECT_ALL', ids: items.map((i) => i.id) });
  };

  const handleDeselectAll = () => {
    dispatchItems({ type: 'DESELECT_ALL' });
  };

  // ── Actions ─────────────────────────────────────────────────────────

  async function handleApproveOrReject(action: 'approve' | 'reject') {
    if (selected.size === 0) return;
    dispatchUI({ type: 'ACTION_START' });
    try {
      const resp = await fetch(`${ADMIN_API}/api/pipeline/approve-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { approved: number; rejected: number };
      const count = action === 'approve' ? data.approved : data.rejected;
      dispatchUI({ type: 'ACTION_DONE', message: { text: `${action === 'approve' ? 'Approved' : 'Rejected'} ${count} item(s)`, ok: true } });
      await loadItems(selectedBatch, filterStatus);
      await loadBatches();
    } catch (err) {
      dispatchUI({ type: 'ACTION_DONE', message: { text: (err as Error).message, ok: false } });
    }
  }

  async function handlePublish() {
    // Single reduce pass instead of filter().map()
    const approvedIds = items.reduce<number[]>((acc, i) => {
      if (i.status === 'approved') acc.push(i.id);
      return acc;
    }, []);

    if (approvedIds.length === 0) {
      dispatchUI({ type: 'ACTION_DONE', message: { text: 'No approved items in this batch to publish', ok: false } });
      return;
    }

    dispatchUI({ type: 'ACTION_START' });
    try {
      const resp = await fetch(`${ADMIN_API}/api/pipeline/publish-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: approvedIds }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { published: number };
      dispatchUI({ type: 'ACTION_DONE', message: { text: `Published ${data.published} item(s) to DB`, ok: true } });
      await loadItems(selectedBatch, filterStatus);
      await loadBatches();
    } catch (err) {
      dispatchUI({ type: 'ACTION_DONE', message: { text: (err as Error).message, ok: false } });
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

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
            <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
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
          <BatchCard
            batch={{ batch_id: null, total: batches.reduce((s, b) => s + b.total, 0), pending: 0, approved: 0, rejected: 0, published: 0, created_at: '' }}
            isSelected={selectedBatch === null}
            onClick={() => dispatchUI({ type: 'SELECT_BATCH', batchId: null })}
          />
        )}

        {batches.map((batch) => (
          <BatchCard
            key={batch.batch_id ?? '__null__'}
            batch={batch}
            isSelected={selectedBatch === batch.batch_id}
            onClick={() => dispatchUI({ type: 'SELECT_BATCH', batchId: batch.batch_id })}
          />
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
              <FilterTab
                key={s}
                status={s}
                isActive={filterStatus === s}
                onClick={() => dispatchUI({ type: 'SET_FILTER', status: s })}
              />
            ))}
          </div>

          {/* Selection controls */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-[11px] text-on-surface-variant hover:text-primary transition-colors underline-offset-2 hover:underline"
            >
              Select All
            </button>
            <span className="text-slate-600" aria-hidden="true">|</span>
            <button
              type="button"
              onClick={handleDeselectAll}
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
              <ActionButton
                label="Approve Selected"
                icon="check"
                onClick={() => void handleApproveOrReject('approve')}
                disabled={selected.size === 0 || actionLoading}
                variant="approve"
              />
              <ActionButton
                label="Reject Selected"
                icon="close"
                onClick={() => void handleApproveOrReject('reject')}
                disabled={selected.size === 0 || actionLoading}
                variant="reject"
              />
            </>
          )}

          {filterStatus === 'approved' && (
            <ActionButton
              label="Publish Approved"
              icon="publish"
              onClick={() => void handlePublish()}
              disabled={actionLoading}
              variant="publish"
            />
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
              ? <span className="material-symbols-outlined text-sm align-middle mr-1.5" aria-hidden="true">check_circle</span>
              : <span className="material-symbols-outlined text-sm align-middle mr-1.5" aria-hidden="true">error</span>
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
              {selectedBatch ? ` in this batch` : ''}.
            </div>
          )}

          {!itemsLoading && items.map((item) => (
            <QueueItemRow
              key={item.id}
              item={item}
              isChecked={selected.has(item.id)}
              onToggle={(id) => dispatchItems({ type: 'SELECT', id })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
