# Deployment Guide — HostelGrievance

## Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+

## Local Development Setup

```sh
# 1. Clone the repository
git clone https://github.com/BiswajeetGHub/HostelGrievance.git
cd HostelGrievance

# 2. Install dependencies
npm install

# 3. Create and seed the database
npm run db:reset

# 4. Start both frontend and API
npm run dev:all
```

This starts:
- **Frontend** (Vite): http://localhost:5173
- **API** (Hono): http://127.0.0.1:3001

## Test Accounts

| Role    | Email                    | Password     |
|---------|--------------------------|--------------|
| Student | student@example.test     | student123   |
| Student | priya@example.test       | student123   |
| Student | rohan@example.test       | student123   |
| Warden  | warden@example.test      | warden123    |

## Verification

```sh
# Type checking (should report 0 errors)
npm run typecheck

# Run test suite (should report 15 passed)
npm test
```

## Environment Variables (Optional)

| Variable                  | Default                        | Description                |
|---------------------------|--------------------------------|----------------------------|
| HOSTEL_DB_PATH            | data/hostel.db                 | SQLite database file path  |
| HOSTEL_UPLOADS_DIR        | uploads/                       | File attachment storage    |
| HOSTEL_SECURITY_LOG_PATH  | security.log                   | Security event log path    |
| HOSTEL_API_PORT           | 3001                           | API server port            |

## Production Considerations

Before deploying to a public-facing server:

1. **CORS origin**: Change `origin: 'http://localhost:5173'` in `src/server/app.ts` to your production domain.
2. **HTTPS**: The session cookie has `Secure: true`, so HTTPS is required in production.
3. **Database**: SQLite is suitable for low-to-moderate traffic. For high concurrency, migrate to PostgreSQL.
4. **Log rotation**: The security log (`security.log`) grows indefinitely. Configure logrotate or equivalent.
5. **Reverse proxy**: Place behind nginx or similar to handle TLS termination and request size limits.
