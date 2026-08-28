import bcrypt from 'bcryptjs';

export function hashPassword(password: string): string {
	return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, stored: string): boolean {
	if (stored.startsWith('sha256:')) return false;
	return bcrypt.compareSync(password, stored);
}

const DUMMY_HASH = bcrypt.hashSync('dummy', 12);

export function verifyDummyPassword(password: string): void {
	bcrypt.compareSync(password, DUMMY_HASH);
}
