import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "@argentinaradar/database";
import type { Role } from "@argentinaradar/auth-middleware";
import { config } from "../config.js";
import { signAccessToken, verifyAccessToken } from "../lib/jwt.js";
import type { AccessTokenPayload } from "../lib/jwt.js";
import { hashPassword, comparePassword } from "../lib/password.js";

export const authRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────

/** Allowed roles a user can be assigned during registration. */
const VALID_ROLES: Role[] = ["VISITOR", "VIP", "ADMIN"];

/** Fields we expose when returning a user object (never expose password). */
const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Validate that a value is a non-empty string. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ─── POST /api/auth/register ────────────────────────────────────────

authRouter.post("/register", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check for existing user
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    // Validate role (default to VIP)
    const userRole: Role = VALID_ROLES.includes(role) ? role : "VIP";

    const hashed = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashed,
        role: userRole,
      },
      select: USER_SELECT,
    });

    res.status(201).json({ user });
  } catch (err) {
    console.error("[auth] POST /register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/login ───────────────────────────────────────────

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Use generic message to avoid leaking whether the email exists
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Create session (refresh token)
    const refreshToken = crypto.randomUUID();
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + config.refreshTokenExpiresInMs),
      },
    });

    const accessToken = signAccessToken(user);

    res.json({
      accessToken,
      refreshToken: session.token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[auth] POST /login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/refresh ─────────────────────────────────────────

authRouter.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!isNonEmptyString(refreshToken)) {
      res.status(400).json({ error: "Refresh token is required" });
      return;
    }

    const session = await prisma.session.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!session) {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    if (session.expiresAt < new Date()) {
      // Clean up expired session
      await prisma.session.delete({ where: { id: session.id } });
      res.status(401).json({ error: "Refresh token expired" });
      return;
    }

    // Issue new access token (keep same session)
    const accessToken = signAccessToken(session.user);

    res.json({ accessToken });
  } catch (err) {
    console.error("[auth] POST /refresh error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/logout ──────────────────────────────────────────

authRouter.post("/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!isNonEmptyString(refreshToken)) {
      res.status(400).json({ error: "Refresh token is required" });
      return;
    }

    // Delete all sessions with this token (at most one, but idempotent)
    await prisma.session.deleteMany({
      where: { token: refreshToken },
    });

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("[auth] POST /logout error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/auth/me ───────────────────────────────────────────────

authRouter.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = authHeader.slice(7);
    let payload: AccessTokenPayload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: USER_SELECT,
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user });
  } catch (err) {
    console.error("[auth] GET /me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
