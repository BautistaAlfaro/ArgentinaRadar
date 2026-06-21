# Tasks: Role System (Phase 1 — ArgentinaRadar v3)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1200–1500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (DB + Auth API) → PR 2 (Frontend Auth) → PR 3 (Integration + Gates) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | User model + JWT auth API + middleware | PR 1 | Foundation — all other work depends on this |
| 2 | Frontend login/register + auth context | PR 2 | Depends on PR 1 API being live |
| 3 | Gate components + service integration + admin stub | PR 3 | Depends on PR 2 auth context |

## Phase 1: Database Schema (Foundation)

- [x] 1.1 Add `User` model to `packages/database/prisma/schema.prisma` — fields: `id` (uuid), `email` (unique), `password`, `role` (enum: VISITOR, VIP, ADMIN), `createdAt`, `updatedAt`
- [x] 1.2 Add `Session` model to schema — fields: `id` (uuid), `userId`, `token` (unique), `expiresAt`, `createdAt` — relation to User with cascade delete
- [x] 1.3 Run `prisma migrate dev` to create `users` and `sessions` tables — applied manually (pgvector not available, patched SQL to use TEXT for embedding)
- [x] 1.4 Export new types (`User`, `Session`, `Role`) from `packages/database/src/index.ts`

## Phase 2: Auth Service (Core API)

- [x] 2.1 Create `services/auth/` workspace — `package.json` with express, bcryptjs, jsonwebtoken deps; tsconfig extending base
- [x] 2.2 Create `services/auth/src/index.ts` — Express app on port 3010, CORS, JSON parsing, health endpoint
- [x] 2.3 Create `POST /api/auth/register` — email+password validation, bcrypt hash (12 rounds), insert User with role=VIP by default
- [x] 2.4 Create `POST /api/auth/login` — bcrypt.compare, JWT access token (15min) + opaque refresh token (7d UUID stored in Session)
- [x] 2.5 Create `POST /api/auth/refresh` — validate session token, check expiry, issue new access token
- [x] 2.6 Create `GET /api/auth/me` — return current user from JWT (id, email, role, createdAt, updatedAt)
- [x] 2.7 Create `services/auth/src/lib/jwt.ts` — `signAccessToken()`, `verifyAccessToken()` helpers using HS256 + env JWT_SECRET
- [x] 2.8 Create `services/auth/src/lib/password.ts` — `hashPassword()`, `comparePassword()` wrappers around bcryptjs (12 rounds)
- [x] 2.9 Created shared `packages/auth-middleware/src/middleware.ts` — `requireAuth(secret)` factory: Bearer token extraction, JWT verify, attach `req.user = { userId, email, role }`
- [x] 2.10 Created shared `packages/auth-middleware/src/middleware.ts` — `requireRole(...roles)` factory + `requireAdmin()` convenience
- [x] 2.11 All routes registered in `services/auth/src/index.ts`, pm2 entry added to `config/pm2.config.cjs`
- [x] 2.12 Added `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` to `config/.env.template`

## Phase 3: Frontend Auth (Login/Register UI)

- [ ] 3.1 Create `apps/web/src/services/authApi.ts` — typed fetch wrappers: `register()`, `login()`, `refreshToken()`, `getMe()`, `logout()` — pointing to `http://localhost:3010/api/auth/*`
- [ ] 3.2 Create `apps/web/src/stores/authStore.ts` — Zustand store: `user`, `token`, `isAuthenticated`, `role`, `login()`, `register()`, `logout()`, `refreshFromStorage()` — persist token to localStorage
- [ ] 3.3 Create `apps/web/src/hooks/useAuth.ts` — convenience hook wrapping authStore selectors + auto-refresh logic (refresh token 5min before expiry)
- [ ] 3.4 Create `apps/web/src/components/auth/LoginForm.tsx` — email + password fields, submit handler calling authStore.login(), error display, link to register
- [ ] 3.5 Create `apps/web/src/components/auth/RegisterForm.tsx` — name + email + password + confirm password, zod client-side validation, submit calling authStore.register()
- [ ] 3.6 Create `apps/web/src/components/auth/AuthModal.tsx` — modal/tabs component switching between Login and Register forms, close on auth success
- [ ] 3.7 Update `App.tsx` header — add login/register button for visitors, user avatar + dropdown (profile, logout) for authenticated users
- [ ] 3.8 Add token interceptor to `apps/web/src/services/api.ts` — attach `Authorization: Bearer <token>` header to all API requests when authenticated

## Phase 4: Gate Components (Route Protection)

- [ ] 4.1 Create `apps/web/src/components/auth/Gate.tsx` — `<Gate role="VIP">` wrapper: renders children if user has required role, renders fallback (login prompt or "VIP only" message) otherwise
- [ ] 4.2 Create `apps/web/src/components/auth/AdminGate.tsx` — specialized gate for admin-only sections, shows admin login prompt for non-admins
- [ ] 4.3 Create `apps/web/src/components/auth/VisitorBanner.tsx` — non-intrusive banner for visitors: "Register to unlock VIP features" with CTA to open AuthModal
- [ ] 4.4 Wrap VIP-only sidebar panels with `<Gate role="VIP">` in existing `Sidebar.tsx` — identify which panels are VIP vs public
- [ ] 4.5 Add route-level protection in `App.tsx` — admin section (future) wrapped in `<AdminGate>`, main map view remains public (visitante)

## Phase 5: Service Integration

- [x] 5.1 Create `packages/auth-middleware/src/index.ts` — shared middleware package: re-export `requireAuth`, `requireRole`, `requireAdmin` + `Role`, `TokenPayload`, `RequestUser` types
- [ ] 5.2 Add auth middleware to `services/alerts/src/server.ts` — keep all alert endpoints public (visitante allowed), no changes needed beyond importing shared types
- [ ] 5.3 Add auth middleware to `services/news-ingestion/src/server.ts` — protect write endpoints (if any) with `requireRole('ADMIN')`, keep read endpoints public
- [ ] 5.4 Add auth middleware to `services/geolocation/src/server.ts` — keep geolocation read endpoints public, protect admin config endpoints
- [ ] 5.5 Create `services/auth/src/routes/admin.ts` — `GET /api/auth/admin/users` (list users, admin only), `PATCH /api/auth/admin/users/:id/role` (change role, admin only)
- [ ] 5.6 Add `Role` enum to `shared/types/index.ts` — export `UserRole` type for cross-service consistency

## Phase 6: Testing

- [ ] 6.1 Write unit tests for `services/auth/src/lib/jwt.ts` — sign, verify, expired token, malformed token
- [ ] 6.2 Write unit tests for `services/auth/src/lib/password.ts` — hash + compare roundtrip, wrong password returns false
- [ ] 6.3 Write integration tests for `POST /api/auth/register` — success case, duplicate email returns 409, invalid input returns 400
- [ ] 6.4 Write integration tests for `POST /api/auth/login` — success returns tokens, wrong password returns 401, non-existent email returns 401
- [ ] 6.5 Write integration tests for `GET /api/auth/me` — valid token returns user, expired token returns 401, no token returns 401
- [ ] 6.6 Write integration tests for `requireRole` middleware — VIP accessing VIP route succeeds, VISITANTE accessing VIP route returns 403
- [ ] 6.7 Write frontend test for `authStore` — login sets user+token, logout clears state, refresh updates token

## Phase 7: Admin Dashboard Stub (P2)

- [ ] 7.1 Create `apps/web/src/components/admin/AdminDashboard.tsx` — basic layout: user count, role distribution, recent registrations
- [ ] 7.2 Create `apps/web/src/components/admin/UserTable.tsx` — table of users with email, name, role, createdAt, actions (change role)
- [ ] 7.3 Wire admin routes in `App.tsx` behind `<AdminGate>` — `/admin` path renders AdminDashboard
- [ ] 7.4 Create `apps/web/src/services/adminApi.ts` — typed fetch wrappers for admin endpoints (list users, change role)
