import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";

const app = express();

// ─── Middleware ──────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ─── Routes ─────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);

// ─── Health ─────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "auth",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Start ──────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[auth] Service listening on http://localhost:${config.port}`);
  console.log(`[auth]   POST /api/auth/register — create account`);
  console.log(`[auth]   POST /api/auth/login    — authenticate`);
  console.log(`[auth]   POST /api/auth/refresh  — rotate access token`);
  console.log(`[auth]   POST /api/auth/logout   — invalidate session`);
  console.log(`[auth]   GET  /api/auth/me       — current user profile`);
  console.log(`[auth]   GET  /health             — service health`);
});
