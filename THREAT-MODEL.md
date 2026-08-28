# THREAT-MODEL.md — HostelGrievance

## Assets

| Asset | Description | Sensitivity |
|-------|-------------|-------------|
| Student grievance data | Grievance titles, descriptions, category, status | High — private to student and warden |
| File attachments | Images uploaded as supporting evidence | High — private to student and warden |
| User credentials | Email and password hashes | Critical |
| Session tokens | Cookie-based authentication tokens | Critical |
| Warden actions | Status updates, comments on grievances | Medium |
| Database file | SQLite file containing all application data | Critical |
| Server filesystem | Application code and uploaded files on disk | Critical |

---

## Actors

| Actor | Trust Level | Description |
|-------|-------------|-------------|
| Anonymous user | None | Unauthenticated visitor, no access beyond login page |
| Student | Low | Authenticated, can only access own grievances |
| Warden | Medium | Authenticated, can access all grievances, update status |
| Administrator | High | Manages users and database directly |
| Attacker (external) | None | Attempts to exploit API without valid credentials |
| Attacker (student) | Low | Valid student account trying to access other data |

---

## Trust Boundaries

```
[ Browser ]
     |
     | HTTPS (assumed at infra layer)
     |
[ Hono API Server ]
     |           |
     |           | File I/O
     |           |
[ SQLite DB ]  [ Uploads Directory ]
```

- Browser → API: untrusted. All input validated server-side.
- API → SQLite: trusted internal boundary. Uses parameterised queries.
- API → Filesystem: semi-trusted. Path traversal protections applied.
- Session cookie: crosses browser/server boundary. Must be protected.

---

## Attack Surface

| Surface | Exposure |
|---------|----------|
| POST /api/login | Public. Accepts email and password. |
| POST /api/grievances | Authenticated students only. Accepts text and file upload. |
| GET /api/grievances/:id | Authenticated. Must enforce ownership. |
| PATCH /api/grievances/:id | Authenticated. Role-based field restrictions. |
| POST /api/grievances/:id/attachments | Authenticated student owner only. File upload. |
| GET /api/attachments/:id | Authenticated. Returns file bytes. |
| POST /api/logout | Authenticated. Destroys session. |

---

## Important Attack Paths

### Attack Path 1 — Insecure Direct Object Reference (IDOR) & Privilege Escalation
```
Attacker logs in as Student A
→ Observes grievance ID format (GRV-0001)
→ Requests GET /api/grievances/GRV-0002 (belongs to Student B) or attempts to PATCH it.
→ Server previously returned full grievance data or accepted modifications.
→ FIXED: assertCanViewGrievance() now enforced on every read, update, comment creation, and attachment download. Students are also prevented from updating the `status` of their own grievances.
```

### Attack Path 2 — Session Token Theft After Logout
```
Attacker intercepts session token (e.g. via network sniff)
→ Victim logs out
→ Server previously only cleared cookie, session remained in DB
→ Attacker replays token → still authenticated
→ FIXED: destroySession() now called on logout
```

### Attack Path 3 — Brute Force Login
```
Attacker targets known student email
→ Sends unlimited POST /api/login requests with password guesses
→ No previous limit existed
→ FIXED: 5 attempts per IP per minute enforced
```

### Attack Path 4 — Path Traversal via File Upload
```
Attacker uploads file with name "../../server/app.ts"
→ Server previously used original filename as stored filename
→ writeStoredFile() writes to arbitrary path on disk
→ FIXED: stored filename is always a random hex string
```

### Attack Path 5 — CSRF via Missing Cookie Flags
```
Attacker hosts malicious page
→ Victim (logged-in student) visits attacker page
→ Page sends POST /api/grievances with forged data
→ Browser attaches session cookie (no SameSite restriction)
→ Request accepted as legitimate
→ FIXED: SameSite=Lax added to session cookie
```

### Attack Path 6 — Credential Cracking via Weak Password Hash
```
Attacker obtains database backup
→ Password hashes are plain SHA-256 with no salt
→ Rainbow table lookup reveals passwords in seconds
→ FIXED: bcryptjs with 12 rounds, salted by default
```
