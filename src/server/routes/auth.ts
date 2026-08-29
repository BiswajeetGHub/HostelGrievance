import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { getCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '../config.ts';
import { createSession, clearSessionCookie, destroySession, requireUser, setSessionCookie } from '../auth/session.ts';
import { verifyPassword, verifyDummyPassword } from '../auth/passwords.ts';
import { findUserByEmail } from '../db/queries.ts';
import { toPublicUser } from '../db/map.ts';
import { HttpError } from '../http/errors.ts';

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): void {
	const now = Date.now();
	const record = loginAttempts.get(ip);
	if (record && now < record.resetAt) {
		if (record.count >= 5) {
			throw new HttpError(429, 'too_many_requests', 'Too many login attempts. Wait 1 minute.');
		}
		record.count++;
	} else {
		loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
	}
	// Periodic cleanup of expired entries to prevent memory leak
	if (loginAttempts.size > 1000) {
		for (const [key, val] of loginAttempts) {
			if (now >= val.resetAt) loginAttempts.delete(key);
		}
	}
}

export function banIp(ip: string): void {
	loginAttempts.set(ip, { count: 999, resetAt: Date.now() + 3600_000 });
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', async (c) => {
	const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
	checkRateLimit(ip);
	
	const db = c.get('db');
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	if (!body || typeof body !== 'object') {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	const email = 'email' in body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const password = 'password' in body && typeof body.password === 'string' ? body.password : '';
	if (!email || !password) {
		throw new HttpError(400, 'bad_request', 'Email and password are required.');
	}
	if (email.length > 254) {
		throw new HttpError(400, 'bad_request', 'Email address is too long.');
	}
	if (password.length > 72) {
		throw new HttpError(400, 'bad_request', 'Password is too long.');
	}
	const user = findUserByEmail(db, email);
	let valid = false;
	if (user) {
		valid = verifyPassword(password, user.password_hash);
	} else {
		verifyDummyPassword(password);
	}

	if (!user || !valid) {
		throw new HttpError(401, 'unauthenticated', 'Invalid email or password.');
	}
	const token = createSession(db, user.id);
	setSessionCookie(c, token);
	return c.json({ user: toPublicUser(user) });
});

authRoutes.post('/logout', (c) => {
	const db = c.get('db');
	const token = getCookie(c, SESSION_COOKIE);
	if (token) destroySession(db, token);
	clearSessionCookie(c);
	return c.json({ ok: true });
});

authRoutes.get('/me', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	return c.json({ user: toPublicUser(user) });
});
