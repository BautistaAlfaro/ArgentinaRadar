// ─────────────────────────────────────────────────────────
//  Admin Dashboard — Users Routes
// ─────────────────────────────────────────────────────────

import { Router } from "express";
import { prisma } from "@argentinaradar/database";

export const usersRouter = Router();

// ─── GET /api/admin/users ────────────────────────────────

usersRouter.get("/users", async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        sessions: {
          select: {
            id: true,
            expiresAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Enrich with subscription info
    const usersWithSubscriptions = await Promise.all(
      users.map(async (user) => {
        const subscription = await prisma.subscription.findFirst({
          where: { userId: user.id, isActive: true },
          select: { plan: true, amount: true, startDate: true, endDate: true },
        });

        return {
          ...user,
          activeSessions: user.sessions.filter((s) => s.expiresAt > new Date()).length,
          subscription: subscription ?? null,
        };
      }),
    );

    res.json({
      users: usersWithSubscriptions,
      count: users.length,
    });
  } catch (err) {
    console.error("[admin] GET /users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
