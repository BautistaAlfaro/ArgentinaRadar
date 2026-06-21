/** The three user roles in the system. */
export type Role = "VISITOR" | "VIP" | "ADMIN";

/** Payload stored inside the signed JWT access token. */
export interface TokenPayload {
  userId: string;
  email: string;
  role: Role;
  type: "access";
}

/** User information attached to `req.user` after authentication. */
export interface RequestUser {
  userId: string;
  email: string;
  role: Role;
}

// Augment Express Request globally so consumers get typed `req.user`.
declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}
