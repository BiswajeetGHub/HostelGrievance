# SECURITY.md — HostelGrievance Security Posture

## Application Overview

HostelGrievance is a web application for GIET University that allows students to submit
hostel grievances and wardens to review and resolve them. It is built with SvelteKit
(frontend), Hono (API server), and SQLite (database).

---

## Major Security Improvements

### 1. Broken Access Control (IDOR and Privilege Escalation) — Fixed
Students could previously read, update, or comment on any other student's grievance, and view any attachment, by guessing the respective ID.
The server had an `assertCanViewGrievance()` function written but never called it. This has been fixed by
enforcing ownership checks on every grievance read, update, comment creation, and attachment download. Additionally, a vulnerability allowing students to arbitrarily change the status of their own grievances (bypassing the warden workflow) was fixed by rejecting `status` updates from student accounts.

### 2. Session Management — Fixed
- Logout only cleared the browser cookie but never deleted the session from the database.
  A stolen token remained valid forever. Fixed by calling `destroySession()` on logout.
- Session expiry (`expires_at`) was stored in the database but never validated.
  Expired sessions were accepted as valid. Fixed by checking expiry in `readSessionUser()`.
- Session cookie was missing `httpOnly` and `SameSite` flags, making it vulnerable to
  XSS-based theft and CSRF. Fixed by adding `httpOnly: true, sameSite: 'Lax'`.

### 3. Weak Password Hashing — Fixed
Passwords were hashed with plain SHA-256 — no salt, no iterations. This is trivially
crackable with rainbow tables. Replaced with bcryptjs using 12 rounds, which is the
current industry standard for password storage.

### 4. Path Traversal on File Write — Fixed
The file upload handler used the original filename as the stored filename on disk.
An attacker uploading a file named `../../server/app.ts` could overwrite server files.
Fixed by always generating a random hex filename, discarding the original name for storage.

### 5. File Serving — Fixed
Uploaded files were served with `Content-Disposition: inline`, causing browsers to render
them directly. Changed to `Content-Disposition: attachment` to force download, preventing
any client-side execution of uploaded content.

### 6. CORS — Fixed
The API accepted credentialed requests from any origin (`*`). Fixed by restricting the
allowed origin to `http://localhost:5173` (the frontend development origin).

### 7. Security Headers — Added
Added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
`Referrer-Policy: strict-origin-when-cross-origin` to all API responses.

### 8. Login Rate Limiting — Added
No limit existed on login attempts, allowing unlimited brute force. Added an in-memory
rate limiter restricting each IP to 5 login attempts per minute.

### 9. Security Event Logging — Added
No security-relevant activity was previously logged. Added server-side logging for all
401, 403, and 429 responses including timestamp, method, path, and IP address.

---

## Assumptions

- The application runs behind a reverse proxy (e.g. Nginx) in production that sets
  `X-Forwarded-For` headers correctly for IP-based rate limiting.
- The uploads directory is not publicly accessible via a static file server — files are
  served only through the authenticated `/api/attachments/:id` endpoint.
- HTTPS is enforced at the infrastructure layer (reverse proxy / hosting platform).
- The SQLite database file is stored outside the web root and not publicly accessible.

---

## Residual Risks

| Risk | Notes |
|------|-------|
| MIME type not verified by magic bytes | File type is checked by client-provided Content-Type only. A determined attacker could mislabel a file. Mitigated by `nosniff` header and `attachment` disposition. |
| In-memory rate limiter resets on server restart | A production deployment should use Redis or a persistent store for rate limiting. |
| No HTTPS enforcement in app code | Relies on infrastructure layer for TLS. The `Secure` cookie flag is not set. |
| bcrypt migration | Existing SHA-256 hashed passwords in the seed data will fail login until users reset passwords or the DB is reseeded. |
| No account lockout | Rate limiting is per-IP only. Distributed attacks from multiple IPs are not blocked. |
