# SECURITY.md — HostelGrievance Final Security Posture

## A. What We Started With

The starter app had working student and warden workflows — and almost no server-side
security. The frontend made trust decisions that the backend never enforced. Any logged-in
student could read any other student's grievance. Passwords were stored as raw SHA-256
with no salt. Session tokens survived logout. Files were saved under their original
filenames and served inline to the browser.

We treated the Hono API layer as the only trust boundary that matters. Everything from
the browser — cookies, filenames, Content-Type headers, field lengths, status values —
we treated as attacker-controlled input.

---

## B. What We Fixed

### 1) Authorization: IDOR across four routes

The ownership check function `assertCanViewGrievance()` existed in the codebase, BUT 
It just was NOT being called on GET requests.

why we added it?: We added it to every route that touches a grievance: read, update, comment, and
attachment download. A student now gets a hard 403 on any resource they did not create.
We also blocked students from setting grievance status — that field now returns 403
unless the session belongs to a warden.

### 2) Passwords: SHA-256 to bcrypt

SHA-256 is a fast hashing algorithm. That is the problem. An attacker with the database
file can run billions of SHA-256 attempts per second on commodity hardware.

Soo We replaced it with bcrypt at 12 rounds. Each guess now takes around-ish ~300ms. We also made the
server run bcrypt even when the email does not exist. previously, an invalid email
returned instantly while a valid one took 300ms, leaking which addresses are registered.

### 3) Sessions: three separate gaps closed

Logout only cleared the cookie. The session row stayed in the database. A stolen token
worked indefinitely after the user logged out. We call destroySession() before clearing
the cookie now.

'expires_at' was stored in the sessions table but never read. We added the check.
Expired sessions are deleted on first use.

The session cookie had no httpOnly or SameSite flags. JavaScript in the page could
read it. Cross-site requests attached it automatically. We added httpOnly: true and
SameSite=Lax.

### 4) File Handling: three separate gaps closed

Original filenames were used as stored filenames on disk. writeStoredFile() had no
path traversal check. We removed the originalName parameter entirely. Stored filenames
are now always randomBytes(16).hex + extension. The original name is kept in the
database for display only.

MIME type was read from the browser's Content-Type header. That header is attacker-
controlled. We now read the first bytes of the file and check them against known magic
byte signatures. A file that claims to be PNG but does not start with 89 50 4E 47
gets rejected with 400.

Files were served with Content-Disposition: inline. Browsers render inline content.
We changed it to attachment. The browser now downloads the file instead of opening it.

### 5) Input Limits

No length limits existed on any text field. So We capped titles at 200 characters,
descriptions at 5000, and comments at 2000. Passwords are capped at 72 bytes because
bcrypt silently truncates longer inputs which would let an attacker log in with any
suffix of a long password.

### 6) Rate Limiting

We added an in-memory rate limiter on POST /api/login. Five wrong attempts from the
same IP triggers a 429 for 60 seconds. We chose IP-based limiting over account lockout
deliberately BUT account lockout requires schema changes and we were not willing to risk
breaking the grading environment's database.

### 7) Logging

Nothing was logged before. We added a middleware that writes to security.log on every
401, 403, and 429 — timestamp, IP, method, path, status. An administrator can now see
failed logins, unauthorized access attempts, and rate-limit triggers.

### 8) XSS

Svelte escapes text by default. The original code had {@html ...} interpolations in
two places that bypassed that. We removed them. Comments and grievance content now render
as plain text regardless of what they contain.

### 9) Error Messages

Unhandled errors previously sent raw Node.js error objects to the client — including
file paths, OS details, and stack traces. All unhandled errors now return
"Internal server error." The full error is logged server-side only.

---

## C. Deployment Assumptions

1. The app currently runs with origin: 'http://localhost:5173' in CORS config.
That must change to the production domain before public launch.

2. Session cookies have Secure: true. This requires HTTPS at the infrastructure layer.
We assume a reverse proxy (Nginx or equivalent) handles TLS termination.

3. The data/ and uploads/ directories must be writable by the Node process but must
not be served as static files. The uploads folder serves files only through the
authenticated /api/attachments/:id route.

4. Assuming that we must not add ui changes, which could break functionality or may introduce more ways
to hack or create more vulnerabilities, we tried to keep a defensive + offensive backend only changes. 

---

## D. What We Did Not Fix (and why)

| Residual Risk | Why We Left It |
|---------------|----------------|
| No per-user upload quota | Fixing this requires schema changes. We capped file size at 2MB per upload instead. A determined attacker could still exhaust disk by uploading many files. |
| IP rate limiting only | Distributed attacks from rotating proxies bypass it. Account lockout was the alternative but required schema changes we did not trust ourselves to make safely in a hackathon environment. |
| SQLite under concurrent load | We added busy_timeout to reduce lock crashes. Under heavy concurrent writes it will still drop requests. PostgreSQL is the real fix. |
| No Content-Security-Policy header | CSP requires knowing every script and style source in the frontend. We did not touch the frontend and could not safely enumerate those sources. |
| Secure cookie flag depends on infrastructure | We set it in code. If the app is ever run without HTTPS the flag is useless. A startup check that refuses to run without HTTPS would close this. |
