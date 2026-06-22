/**
 * AIProcessPanel — AI phase configuration and monitoring.
 *
 * - Threshold slider (0-10) with save
 * - Model selector: qwen2.5:7b / llama3 / openrouter
 * - "Reprocess batch" button with confirmation
 * - Last 10 AI processing results
 */

import { useState, useEffect, useCallback } from 'react';
import { API } from '@shared/apiConfig';

const ADMIN_API = API.admin;

// ── Types ──────────────────────────────────────────────────────────────

interface AiStatus {
  status: string;
  provider: string;
  model: string;
  threshold: number;
  min_quality: number;
  timestamp: string;
}

interface AiResultItem {
  id: string;
  title: string;
  verdict: string;
  combined: number;
  reason: string;
  processed_at: string;
}

// ── Component ──────────────────────────────────────────────────────────

export function AIProcessPanel() {
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [threshold, setThreshold] = useState(5);
  const [minQuality] = useState(40);
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [model, setModel] = useState('qwen2.5:7b');
  const [recentResults, setRecentResults] = useState<AiResultItem[]>([]);

  // ── Load AI status ────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${ADMIN_API}/api/admin/ai/status`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        const data = await resp.json() as AiStatus;
        setAiStatus(data);
        setThreshold(Math.round(data.threshold));
        setModel(data.model);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  // ── Load recent AI results (from pipeline stats) ──────────────────

  const loadRecent = useCallback(async () => {
    try {
      // Fetch recent processed articles from the news-ingestion pipeline
      const resp = await fetch(`${API.news}/api/pipeline/stats`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        const data = await resp.json() as { recent?: AiResultItem[] };
        if (data.recent) {
          setRecentResults(data.recent.slice(0, 10));
        }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void loadRecent(); }, [loadRecent]);

  // ── Save threshold ─────────────────────────────────────────────────

  const handleSaveThreshold = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      const resp = await fetch(`${ADMIN_API}/api/admin/ai/threshold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold }),
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        setStatusMsg({ text: '✅ Threshold actualizado (runtime only — editar .env para persistir)', ok: true });
      } else {
        const err = await resp.json().catch(() => ({ error: 'Error' }));
        setStatusMsg({ text: `❌ ${err.error ?? 'Error'}`, ok: false });
      }
    } catch (err) {
      setStatusMsg({ text: `❌ ${(err as Error).message}`, ok: false });
    } finally {
      setSaving(false);
    }
  };

  // ── Reprocess ─────────────────────────────────────────────────────

  const handleReprocess = async () => {
    setReprocessing(true);
    setShowConfirm(false);
    setStatusMsg({ text: '⏳ Reprocesando...', ok: true });
    try {
      const resp = await fetch(`${ADMIN_API}/api/admin/ai/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (resp.ok) {
        const data = await resp.json() as { message?: string };
        setStatusMsg({ text: `✅ ${data.message ?? 'Reprocesamiento iniciado'}`, ok: true });
      } else {
        const err = await resp.json().catch(() => ({ message: 'Error' }));
        setStatusMsg({ text: `❌ ${err.message ?? 'Error'}`, ok: false });
      }
    } catch (err) {
      setStatusMsg({ text: `❌ ${(err as Error).message}`, ok: false });
    } finally {
      setReprocessing(false);
    }
  };

  // ── Status color ──────────────────────────────────────────────────

  const statusColor = aiStatus?.status === 'ok' ? 'text-emerald-400' :
    aiStatus?.status === 'degraded' ? 'text-amber-400' : 'text-red-400';

  const statusDot = aiStatus?.status === 'ok' ? '🟢' :
    aiStatus?.status === 'degraded' ? '🟡' : '🔴';

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2">
      {/* ── Status message ──────────────────────────────────────────── */}
      {statusMsg && (
        <div
          className={`px-4 py-2.5 rounded-lg text-xs font-mono border flex items-center gap-2 ${
            statusMsg.ok
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-red-500/10 text-red-300 border-red-500/30'
          }`}
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            {statusMsg.ok ? 'check_circle' : 'error'}
          </span>
          {statusMsg.text}
        </div>
      )}

      {/* ── Status Card ──────────────────────────────────────────────── */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-5">
        <h3 className="text-sm font-bold text-white mb-3">🤖 AI Processor Status</h3>
        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-500">Status: </span>
            <span className={statusColor}>{statusDot} {aiStatus?.status ?? 'unknown'}</span>
          </div>
          <div>
            <span className="text-slate-500">Provider: </span>
            <span className="text-slate-300">{aiStatus?.provider ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Model: </span>
            <span className="text-slate-300">{aiStatus?.model ?? model}</span>
          </div>
          <div>
            <span className="text-slate-500">Min Quality: </span>
            <span className="text-slate-300">{aiStatus?.min_quality ?? minQuality}</span>
          </div>
        </div>
      </div>

      {/* ── Threshold Slider ──────────────────────────────────────────── */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-5">
        <h3 className="text-sm font-bold text-white mb-3">⚙️ AI Threshold</h3>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="flex-1 accent-primary h-2 rounded-full appearance-none bg-slate-700 cursor-pointer"
            aria-label="AI threshold slider"
          />
          <span className="text-lg font-bold font-mono text-primary w-10 text-center">{threshold.toFixed(1)}</span>
          <button
            type="button"
            onClick={handleSaveThreshold}
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">Threshold actual: {threshold.toFixed(1)}. Valores más altos = más artículos aprobados automáticamente.</p>
      </div>

      {/* ── Model Selector ────────────────────────────────────────────── */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-5">
        <h3 className="text-sm font-bold text-white mb-3">🧠 Modelo AI</h3>
        <div className="flex items-center gap-3">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-slate-700/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-primary/50 flex-1"
            aria-label="AI model selector"
          >
            <option value="qwen2.5:7b">qwen2.5:7b (Ollama)</option>
            <option value="llama3">llama3 (Ollama)</option>
            <option value="llama3.1">llama3.1 (Ollama)</option>
            <option value="openrouter">OpenRouter (cloud)</option>
          </select>
          <span className="text-[10px] text-slate-600">Cambiar modelo requiere editar .env + reiniciar</span>
        </div>
      </div>

      {/* ── Reprocess ──────────────────────────────────────────────────── */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-5">
        <h3 className="text-sm font-bold text-white mb-3">🔁 Reprocesar Lote</h3>
        {!showConfirm ? (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={reprocessing}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            Reprocesar últimos 50 artículos
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-amber-400">¿Estás seguro? Se reprocesarán los últimos 50 artículos con el AI.</span>
            <button
              type="button"
              onClick={handleReprocess}
              disabled={reprocessing}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {reprocessing ? 'Reprocesando...' : 'Sí, reprocesar'}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-700/40 text-slate-400 border border-slate-700/30 hover:bg-slate-700/60 transition-all cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* ── Recent AI Results ──────────────────────────────────────────── */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-5">
        <h3 className="text-sm font-bold text-white mb-3">📋 Últimos resultados AI</h3>
        {recentResults.length === 0 ? (
          <p className="text-xs text-slate-500">No hay resultados recientes</p>
        ) : (
          <div className="space-y-2">
            {recentResults.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-700/20 text-xs">
                <span className={`font-bold ${item.verdict === 'PUBLISH' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {item.verdict === 'PUBLISH' ? '✅' : '❌'}
                </span>
                <p className="flex-1 text-slate-300 truncate">{item.title}</p>
                <span className="text-slate-500 font-mono">{item.combined?.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
