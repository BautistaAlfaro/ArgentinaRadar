// ─────────────────────────────────────────────────────────
//  Admin Dashboard — Subscription Routes
// ─────────────────────────────────────────────────────────

import { Router } from "express";
import { prisma } from "@argentinaradar/database";

export const subscriptionRouter = Router();

// ─── POST /api/admin/subscription ────────────────────────

subscriptionRouter.post("/subscription", async (req, res) => {
  try {
    const { userId, plan, amount, startDate, endDate } = req.body;

    if (!userId || !plan) {
      res.status(400).json({ error: "Missing required fields: userId, plan" });
      return;
    }

    const VALID_PLANS = ["free", "vip", "enterprise"];
    if (!VALID_PLANS.includes(plan)) {
      res.status(400).json({
        error: `Invalid plan. Valid plans: ${VALID_PLANS.join(", ")}`,
      });
      return;
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Deactivate any existing active subscriptions for this user
    await prisma.subscription.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, endDate: endDate ? new Date(endDate) : new Date() },
    });

    const subscription = await prisma.subscription.create({
      data: {
        userId,
        plan,
        amount: amount ? parseFloat(amount) : 0,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        isActive: true,
      },
    });

    res.status(201).json({ subscription });
  } catch (err) {
    console.error("[admin] POST /subscription error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/subscriptions ────────────────────────

subscriptionRouter.get("/subscriptions", async (_req, res) => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    res.json({ subscriptions, count: subscriptions.length });
  } catch (err) {
    console.error("[admin] GET /subscriptions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
