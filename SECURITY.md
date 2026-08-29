# SECURITY.md — Final Security Posture

## 1. Final Security Posture
The HostelGrievance application has been hardened from an intentionally vulnerable state into a production-ready system with strict defense-in-depth boundaries. The backend API (Hono) now acts as an absolute trust boundary, fundamentally distrusting all input and state from the frontend (SvelteKit). 

All severe vulnerabilities (IDOR, Stored XSS, Path Traversal, and Insecure Password Storage) have been remediated. The system now guarantees that a compromise at one layer (e.g., a file upload bypass) is contained by a secondary layer (e.g., forced attachment headers and random filenames).

## 2. Major Improvements
- **Authorization & IDOR:** All routes inherently verify ownership against the authenticated session. Students are hard-blocked from accessing peers' data or manipulating warden-only states (e.g., grievance status).
- **Authentication & Sessions:** Passwords migrated from plain SHA-256 to `bcrypt` (12 rounds). Sessions are now strictly bound by TTLs, securely wiped on logout, and transported exclusively via `httpOnly`, `Secure`, `SameSite=Lax` cookies. A brute-force IP rate-limiter prevents credential stuffing.
- **File Handling:** Uploads are sanitized by ignoring user-provided filenames entirely (replaced with hex UUIDs). MIME types are strictly verified via magic-byte inspection (not just extensions). Files are forced to download via `Content-Disposition: attachment` to eliminate stored XSS.
- **Data & Input Integrity:** Removed dangerous `{@html}` Svelte interpolations. Added rigorous length limits (e.g., 5000 chars for descriptions) to prevent memory exhaustion DoS.
- **Visibility:** Added a file-based security audit log (`security.log`) that records IP, timestamp, method, and path for all 401, 403, and 429 events.

## 3. Deployment Assumptions
- The application will be deployed behind a reverse proxy (like Nginx) that provides TLS termination, as the session cookies require HTTPS (`Secure: true`).
- The Node.js environment has write access to the `data/` and `uploads/` directories.
- The `origin` in `src/server/app.ts` CORS configuration is currently hardcoded to `http://localhost:5173` to comply with the hackathon's local testing environment constraints. This must be updated to the production domain before public launch.

## 4. Residual Risks
- **Disk Exhaustion:** While individual files are capped at 2MB, there is no global per-user quota. A malicious user could upload thousands of images to exhaust server disk space.
- **Distributed Brute Force:** The rate limiter relies on `x-forwarded-for` / `x-real-ip`. A sophisticated attacker rotating through thousands of proxy IPs could theoretically bypass the 5-attempt limit.
- **Database Concurrency:** SQLite is currently used. We added a `busy_timeout` to mitigate lock crashes, but under extremely heavy, sustained concurrent write loads, the system may still drop requests. Migration to PostgreSQL is recommended for enterprise scale.
