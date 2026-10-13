import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

function sanitizeDatabaseUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	// Support values wrapped in quotes in env files.
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"'))
		|| (trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}

	return trimmed;
}

function normalizeDatabaseUrl(connectionString: string): string {
	const normalizedUrl = new URL(connectionString);
	const sslMode = normalizedUrl.searchParams.get("sslmode");

	if (!sslMode || ["require", "prefer", "verify-ca"].includes(sslMode)) {
		normalizedUrl.searchParams.set("sslmode", "verify-full");
	}

	return normalizedUrl.toString();
}

function getDbEnvDiagnostics() {
	const familyRaw = process.env.FAMILY_SOCIAL_DATABASE_URL;
	const databaseRaw = process.env.DATABASE_URL;

	return {
		nodeEnv: process.env.NODE_ENV ?? null,
		npmLifecycleEvent: process.env.npm_lifecycle_event ?? null,
		cwd: process.cwd(),
		hasFamilySocialDatabaseUrl: typeof familyRaw === "string",
		hasDatabaseUrl: typeof databaseRaw === "string",
		familySocialDatabaseUrlIsBlank: typeof familyRaw === "string" ? familyRaw.trim().length === 0 : null,
		databaseUrlIsBlank: typeof databaseRaw === "string" ? databaseRaw.trim().length === 0 : null,
	};
}

const familySocialDatabaseUrl =
	sanitizeDatabaseUrl(process.env.FAMILY_SOCIAL_DATABASE_URL)
	?? sanitizeDatabaseUrl(process.env.DATABASE_URL);

if (!familySocialDatabaseUrl) {
	console.error("[db] Missing FAMILY_SOCIAL_DATABASE_URL and DATABASE_URL", getDbEnvDiagnostics());
	throw new Error("FAMILY_SOCIAL_DATABASE_URL or DATABASE_URL is required.");
}

export const databaseConnectionString = normalizeDatabaseUrl(familySocialDatabaseUrl);
const sql = neon(databaseConnectionString);
export const db = drizzle(sql);

export default db;