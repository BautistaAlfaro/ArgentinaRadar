/**
 * SourceManager — Table + form for managing RSS/scrape sources.
 *
 * Features:
 *   - Table listing all sources: name, URL, article count, enabled toggle
 *   - "Add Source" form: URL + name + test button (fetches RSS to verify)
 *   - Delete button with confirmation
 *   - Green/gray dot for enabled/disabled
 *
 * Fetches from the admin API on port 3012.
 */

import { useCallback, useEffect, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────

interface Source {
  name: string;
  type: "rss" | "scrape";
  url: string;
  category?: string;
  rateLimitMs?: number;
  enabled: boolean;
  cssSelectors?: {
    article: string;
    title: string;
    summary: string;
    link: string;
    timestamp: string;
  };
  articleCount: number;
  lastArticleAt: string | null;
}

interface SourcesResponse {
  sources: Source[];
}

// ─── Constants ─────────────────────────────────────────────────────────

const ADMIN_API = "http://localhost:3012";

const CATEGORIES = [
  { value: "", label: "Sin categoría" },
  { value: "sociedad", label: "Sociedad" },
  { value: "politica", label: "Política" },
  { value: "economia", label: "Economía" },
  { value: "deportes", label: "Deportes" },
];

// ─── Helpers ───────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const token = localStorage.getItem("argentinaradar_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch {
    // localStorage not available
  }
  return headers;
}

async function fetchSources(): Promise<Source[]> {
  const resp = await fetch(`${ADMIN_API}/api/admin/sources`, {
    headers: getAuthHeaders(),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => "Unknown")}`);
  const data = (await resp.json()) as SourcesResponse;
  return data.sources ?? [];
}

async function addSourceApi(source: {
  name: string;
  type: string;
  url: string;
  category?: string;
}): Promise<void> {
  const resp = await fetch(`${ADMIN_API}/api/admin/sources`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(source),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
}

async function deleteSourceApi(name: string): Promise<void> {
  const resp = await fetch(`${ADMIN_API}/api/admin/sources/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
}

async function toggleSourceApi(name: string, enabled: boolean): Promise<void> {
  const resp = await fetch(`${ADMIN_API}/api/admin/sources/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ enabled }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
}

async function testSourceUrl(url: string): Promise<{
  ok: boolean;
  title?: string;
  items?: number;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }

    const text = await resp.text();

    // Try to detect RSS/XML content
    if (text.includes("<rss") || text.includes("<feed") || text.includes("<xml")) {
      // Count <item> or <entry> elements
      const itemMatches = text.match(/<(item|entry)[>\s]/gi);
      return {
        ok: true,
        title: text.match(/<title[^>]*>([^<]+)/)?.[1] ?? "RSS feed",
        items: itemMatches?.length ?? 0,
      };
    }

    // HTML page (likely a scrape target)
    const titleMatch = text.match(/<title[^>]*>([^<]+)/);
    return {
      ok: true,
      title: titleMatch?.[1]?.slice(0, 100) ?? "Web page",
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Sub-components ────────────────────────────────────────────────────

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${
        enabled
          ? "bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]"
          : "bg-slate-600"
      }`}
      title={enabled ? "Enabled" : "Disabled"}
    />
  );
}

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <p className="text-sm text-slate-200 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-red-700 text-white hover:bg-red-600 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────

export function SourceManager() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Add-source form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formType, setFormType] = useState<"rss" | "scrape">("rss");
  const [formCategory, setFormCategory] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    title?: string;
    items?: number;
    error?: string;
  } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ─── Load sources ─────────────────────────────────────────────────

  const loadSources = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchSources();
      setSources(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // ─── Toast helper ─────────────────────────────────────────────────

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  }, []);

  // ─── Add source ───────────────────────────────────────────────────

  const handleAddSource = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formName.trim() || !formUrl.trim()) return;

      setFormSubmitting(true);
      try {
        await addSourceApi({
          name: formName.trim(),
          type: formType,
          url: formUrl.trim(),
          category: formCategory || undefined,
        });
        showToast("success", `Source "${formName}" added successfully`);
        setShowForm(false);
        setFormName("");
        setFormUrl("");
        setFormType("rss");
        setFormCategory("");
        setTestResult(null);
        await loadSources();
      } catch (err) {
        showToast("error", `Failed to add source: ${(err as Error).message}`);
      } finally {
        setFormSubmitting(false);
      }
    },
    [formName, formUrl, formType, formCategory, loadSources, showToast],
  );

  // ─── Test URL ─────────────────────────────────────────────────────

  const handleTestUrl = useCallback(async () => {
    if (!formUrl.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await testSourceUrl(formUrl.trim());
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setTestLoading(false);
    }
  }, [formUrl]);

  // ─── Toggle source ────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (name: string, currentEnabled: boolean) => {
      const newEnabled = !currentEnabled;
      // Optimistic update
      setSources((prev) =>
        prev.map((s) => (s.name === name ? { ...s, enabled: newEnabled } : s)),
      );
      try {
        await toggleSourceApi(name, newEnabled);
        showToast("success", `Source "${name}" ${newEnabled ? "enabled" : "disabled"}`);
      } catch (err) {
        // Revert on failure
        setSources((prev) =>
          prev.map((s) => (s.name === name ? { ...s, enabled: currentEnabled } : s)),
        );
        showToast("error", `Failed to toggle: ${(err as Error).message}`);
      }
    },
    [showToast],
  );

  // ─── Delete source ────────────────────────────────────────────────

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteSourceApi(deleteTarget);
      showToast("success", `Source "${deleteTarget}" removed`);
      setDeleteTarget(null);
      await loadSources();
    } catch (err) {
      showToast("error", `Failed to delete: ${(err as Error).message}`);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, loadSources, showToast]);

  // ─── Loading skeleton ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-6 w-40 bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-9 w-32 bg-slate-800 rounded-lg animate-pulse" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">
            Fuentes de Noticias
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {sources.length} sources configured · {sources.filter((s) => s.enabled).length} active
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowForm(!showForm);
            setTestResult(null);
          }}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-700 text-white border border-blue-600/50 hover:bg-blue-600 transition-colors cursor-pointer"
        >
          {showForm ? "Cancelar" : "+ Agregar fuente"}
        </button>
      </div>

      {/* ── Toast notification ───────────────────────────────────────── */}
      {actionMsg && (
        <div
          className={`px-4 py-3 rounded-lg text-xs font-medium ${
            actionMsg.type === "success"
              ? "bg-emerald-900/50 text-emerald-300 border border-emerald-700/50"
              : "bg-red-900/50 text-red-300 border border-red-700/50"
          }`}
        >
          {actionMsg.text}
        </div>
      )}

      {/* ── Error banner ────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-900/20 p-4">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-400 shrink-0">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            <p className="text-xs text-red-300">{error}</p>
          </div>
          <button
            type="button"
            onClick={loadSources}
            className="mt-2 text-xs text-red-400 hover:text-red-300 underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Add Source Form ─────────────────────────────────────────── */}
      {showForm && (
        <form
          onSubmit={handleAddSource}
          className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-200">Nueva fuente</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Nombre
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="ej: minutouno"
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                required
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Tipo
              </label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as "rss" | "scrape")}
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
              >
                <option value="rss">RSS</option>
                <option value="scrape">Scrape</option>
              </select>
            </div>

            {/* URL + Test button */}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => {
                    setFormUrl(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="https://ejemplo.com/rss"
                  className="flex-1 px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                  required
                />
                <button
                  type="button"
                  onClick={handleTestUrl}
                  disabled={testLoading || !formUrl.trim()}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 cursor-pointer"
                >
                  {testLoading ? "Testing…" : "Test URL"}
                </button>
              </div>

              {/* Test result */}
              {testResult && (
                <div
                  className={`mt-2 px-3 py-2 rounded-lg text-xs ${
                    testResult.ok
                      ? "bg-emerald-900/30 text-emerald-300 border border-emerald-700/30"
                      : "bg-red-900/30 text-red-300 border border-red-700/30"
                  }`}
                >
                  {testResult.ok ? (
                    <>
                      ✅ {testResult.title ?? "Accessible"}
                      {testResult.items != null && ` · ${testResult.items} items found`}
                    </>
                  ) : (
                    <>❌ {testResult.error ?? "Connection failed"}</>
                  )}
                </div>
              )}
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Categoría
              </label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={formSubmitting || !formName.trim() || !formUrl.trim()}
              className="px-5 py-2 text-xs font-medium rounded-lg bg-blue-700 text-white border border-blue-600/50 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {formSubmitting ? "Agregando…" : "Agregar fuente"}
            </button>
          </div>
        </form>
      )}

      {/* ── Sources Table ────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80 border-b border-slate-700/50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Name
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">
                URL
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Type
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Articles
              </th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Enabled
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sources.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  No sources configured. Click "+ Agregar fuente" to add one.
                </td>
              </tr>
            ) : (
              sources.map((src) => (
                <tr
                  key={src.name}
                  className="hover:bg-slate-800/40 transition-colors"
                >
                  {/* Status dot */}
                  <td className="px-4 py-3">
                    <StatusDot enabled={src.enabled} />
                  </td>

                  {/* Name */}
                  <td className="px-4 py-3">
                    <span className="text-slate-200 font-medium">
                      {src.name}
                    </span>
                    {src.category && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded-full bg-slate-700/60 text-slate-400">
                        {src.category}
                      </span>
                    )}
                  </td>

                  {/* URL */}
                  <td className="px-4 py-3 hidden md:table-cell">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-blue-400 text-xs font-mono truncate max-w-[280px] inline-block align-middle"
                      title={src.url}
                    >
                      {src.url}
                    </a>
                  </td>

                  {/* Type */}
                  <td className="px-4 py-3">
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        src.type === "rss"
                          ? "bg-orange-900/30 text-orange-300"
                          : "bg-purple-900/30 text-purple-300"
                      }`}
                    >
                      {src.type.toUpperCase()}
                    </span>
                  </td>

                  {/* Article count */}
                  <td className="px-4 py-3 text-right">
                    <span className="text-slate-300 font-mono text-xs">
                      {src.articleCount.toLocaleString()}
                    </span>
                  </td>

                  {/* Enabled toggle */}
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggle(src.name, src.enabled)}
                      className={`
                        relative inline-flex h-6 w-10 items-center rounded-full
                        transition-colors duration-200
                        focus:outline-none focus:ring-2 focus:ring-blue-500/50
                        ${src.enabled ? "bg-emerald-600" : "bg-slate-700"}
                        cursor-pointer
                      `}
                      role="switch"
                      aria-checked={src.enabled}
                      aria-label={`Toggle ${src.name}`}
                    >
                      <span
                        className={`
                          inline-block h-4 w-4 rounded-full bg-white shadow-sm
                          transition-transform duration-200
                          ${src.enabled ? "translate-x-5" : "translate-x-1"}
                        `}
                      />
                    </button>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(src.name)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-red-300 transition-colors cursor-pointer"
                      title={`Delete ${src.name}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Summary bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-[11px] text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          {sources.filter((s) => s.enabled).length} enabled
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-slate-600" />
          {sources.filter((s) => !s.enabled).length} disabled
        </span>
        <span>
          {sources.reduce((sum, s) => sum + s.articleCount, 0).toLocaleString()} total articles
        </span>
      </div>

      {/* ── Delete confirmation modal ────────────────────────────────── */}
      {deleteTarget && (
        <ConfirmDialog
          message={`Are you sure you want to delete source "${deleteTarget}"? This cannot be undone.`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            if (!deleteLoading) setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}
