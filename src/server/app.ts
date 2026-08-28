import { appendFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { Database } from 'better-sqlite3';
import type { AppEnv } from './env.ts';
import { DEFAULT_SECURITY_LOG_PATH } from './config.ts';
import { handleError, HttpError } from './http/errors.ts';
import { authRoutes } from './routes/auth.ts';
import { grievanceRoutes } from './routes/grievances.ts';
import { attachmentRoutes } from './routes/attachments.ts';
import { cors } from 'hono/cors';

export type CreateAppOptions = {
	db: Database;
	uploadsDir: string;
	securityLogPath?: string;
};

export function createApp(options: CreateAppOptions) {
	const app = new Hono<AppEnv>();

	app.use('*', async (c, next) => {
		c.set('db', options.db);
		c.set('uploadsDir', options.uploadsDir);
		await next();
	});
	app.use('/api/*', cors({
		origin: 'http://localhost:5173',
		credentials: true
	}));
	app.use('*', async (c, next) => {
		await next();
		c.header('X-Content-Type-Options', 'nosniff');
		c.header('X-Frame-Options', 'DENY');
		c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
		c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
		c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	});
	app.use('*', async (c, next) => {
		await next();
		const status = c.res.status;
		const method = c.req.method;
		const path = c.req.path;
		const ip = c.req.header('x-forwarded-for') ?? 'unknown';
		if (status === 401 || status === 403 || status === 429) {
			const at = new Date().toISOString();
			const route = `${method} ${path}`;
			console.log(`[SECURITY] ${at} ${route} → ${status} ip=${ip}`);
			appendFileSync(
				options.securityLogPath ?? DEFAULT_SECURITY_LOG_PATH,
				`${at} ${ip} ${status} ${route}\n`
			);
		}
	});

	app.onError((err, c) => handleError(err, c));

	app.notFound((c) => c.json({ error: 'Not found.', code: 'not_found' }, 404));

	app.get('/api/health', (c) => c.json({ ok: true }));
	app.route('/api', authRoutes);
	app.route('/api/grievances', grievanceRoutes);
	app.route('/api/attachments', attachmentRoutes);

	app.all('/api/*', () => {
		throw new HttpError(404, 'not_found', 'Not found.');
	});

	return app;
}
