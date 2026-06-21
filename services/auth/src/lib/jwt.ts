import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import type { Role } from "@argentinaradar/auth-middleware";
import { config } from "../config.js";

/** Payload stored inside the signed JWT access token. */
export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: Role;
  type: "access";
}

/**
 * Sign a JWT access token for the given user.
 *
 * @returns a signed JWT string
 */
export function signAccessToken(user: {
  id: string;
  email: string;
  role: Role;
}): string {
  const payload: AccessTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    type: "access",
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"],
  });
}

/**
 * Verify and decode a JWT access token.
 *
 * @returns the decoded payload, or throws if invalid / expired
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwtSecret) as AccessTokenPayload;
}
