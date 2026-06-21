/**
 * Admin Dashboard — Source Management Routes
 *
 * CRUD for RSS/scrape sources stored in `data/sources.json`.
 * Article counts are queried from the database.
 *
 *   GET    /sources           — list all sources with stats
 *   POST   /sources           — add a new source
 *   DELETE /sources/:name     — remove a source
 *   PATCH  /sources/:name     — update a source (enable/disable)
 *
 * Auth is enforced by the parent router (ADMIN role required).
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "@argentinaradar/database";
import {
  listSources,
  addSource,
  removeSource,
  toggleSource,
  type Source,
  type SourceStats,
} from "../../../../shared/sourceManager";

export const sourcesRouter = Router();

// ─── GET /api/admin/sources ──────────────────────────────────────────

sourcesRouter.get("/sources", async (_req: Request, res: Response) => {
  try {
    const sources = listSources();

    // Query article counts per source from the database
    const dbSources = await prisma.source.findMany({
      select: {
        name: true,
        _count: { select: { news: true } },
        news: {
          orderBy: { publishedAt: "desc" },
          take: 1,
          select: { publishedAt: true },
        },
      },
    });

    // Build a lookup by source name
    const statsMap = new Map<string, { count: number; lastDate: string | null }>();
    for (const db of dbSources) {
      statsMap.set(db.name, {
        count: db._count.news,
        lastDate: db.news[0]?.publishedAt.toISOString() ?? null,
      });
    }

    const result = sources.map((src: Source) => ({
      ...src,
      articleCount: statsMap.get(src.name)?.count ?? 0,
      lastArticleAt: statsMap.get(src.name)?.lastDate ?? null,
    }));

    res.json({ sources: result });
  } catch (err) {
    console.error("[admin] GET /sources error:", err);
    res.status(500).json({ error: "Failed to load sources" });
  }
});

// ─── POST /api/admin/sources ─────────────────────────────────────────

sourcesRouter.post("/sources", async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<Source>;

    // ── Validation ────────────────────────────────────────────────
    if (!body.name || typeof body.name !== "string") {
      res.status(400).json({ error: "Missing or invalid 'name'" });
      return;
    }
    if (!body.type || !["rss", "scrape"].includes(body.type)) {
      res.status(400).json({ error: "Missing or invalid 'type' (must be 'rss' | 'scrape')" });
      return;
    }
    if (!body.url || typeof body.url !== "string") {
      res.status(400).json({ error: "Missing or invalid 'url'" });
      return;
    }
    if (body.type === "scrape" && !body.cssSelectors) {
      res.status(400).json({ error: "Scrape sources require 'cssSelectors'" });
      return;
    }

    const source: Source = {
      name: body.name.toLowerCase().replace(/\s+/g, "-"),
      type: body.type,
      url: body.url,
      category: body.category,
      rateLimitMs: body.rateLimitMs ?? (body.type === "scrape" ? 10_000 : 5_000),
      enabled: body.enabled !== false,
      cssSelectors: body.cssSelectors,
    };

    addSource(source);
    console.log(`[admin] Source added: ${source.name} (${source.url})`);

    res.status(201).json({ message: `Source '${source.name}' added`, source });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin] POST /sources error:", msg);
    // Handle duplicate name gracefully
    if (msg.includes("already exists")) {
      res.status(409).json({ error: msg });
      return;
    }
    res.status(500).json({ error: `Failed to add source: ${msg}` });
  }
});

// ─── DELETE /api/admin/sources/:name ─────────────────────────────────

sourcesRouter.delete("/sources/:name", async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    removeSource(name);
    console.log(`[admin] Source removed: ${name}`);
    res.json({ message: `Source '${name}' removed` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    console.error("[admin] DELETE /sources/:name error:", msg);
    res.status(500).json({ error: `Failed to remove source: ${msg}` });
  }
});

// ─── PATCH /api/admin/sources/:name ──────────────────────────────────

sourcesRouter.patch("/sources/:name", async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const body = req.body as Partial<Pick<Source, "enabled" | "url" | "category" | "rateLimitMs">>;

    // Toggle enabled/disabled (the primary use case)
    if (typeof body.enabled === "boolean") {
      toggleSource(name, body.enabled);
      console.log(`[admin] Source toggled: ${name} → ${body.enabled ? "enabled" : "disabled"}`);
    }

    // Additional fields can be extended here: url, category, rateLimitMs, etc.
    // For now we only support enable/disable toggle via PATCH.

    res.json({ message: `Source '${name}' updated`, enabled: body.enabled });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    console.error("[admin] PATCH /sources/:name error:", msg);
    res.status(500).json({ error: `Failed to update source: ${msg}` });
  }
});
