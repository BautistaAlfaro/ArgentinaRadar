import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { TokenPayload, Role } from "./types.js";

/**
 * Factory that returns Express middleware to validate a JWT access token.
 *
 * Expects `Authorization: Bearer <token>` in the request header.
 * On success, attaches the decoded user to `req.user`.
 *
 * @param secret — the JWT signing secret (must match the issuer)
 */
export function requireAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized — missing or malformed token" });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, secret) as TokenPayload;

      if (decoded.type !== "access") {
        res.status(401).json({ error: "Invalid token type" });
        return;
      }

      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      };
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

/**
 * Middleware that checks the authenticated user has one of the allowed roles.
 * MUST be used AFTER `requireAuth()` — `req.user` must be populated.
 *
 * @param allowedRoles — one or more roles permitted to access the route
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized — authentication required" });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden — insufficient permissions" });
      return;
    }

    next();
  };
}

/**
 * Convenience middleware that restricts access to ADMIN role only.
 * MUST be used AFTER `requireAuth()`.
 */
export function requireAdmin() {
  return requireRole("ADMIN");
}
