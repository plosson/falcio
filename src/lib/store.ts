import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, chmod, unlink, readdir } from "node:fs/promises";

/**
 * Credentials for one Falco login. Stored once per account and shared by every
 * profile pointing at it, so two profiles on the same account (two orgs) never
 * hold competing refresh tokens.
 */
export type Account = {
  refresh_token: string;
  refresh_expires_at: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
};

/** A named (account, organization) pair. Holds no credentials of its own. */
export type Profile = {
  account_id: string;
  organization_id: string;
  organization_name?: string;
};

/** A profile resolved against its account — what commands actually work with. */
export type Session = Account &
  Profile & {
    profile: string;
  };

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, "falcio") : join(homedir(), ".config", "falcio");
}

function accountPath(accountId: string): string {
  return join(configDir(), "accounts", `${accountId}.json`);
}

function profilesDir(): string {
  return join(configDir(), "profiles");
}

export function profilePath(name: string): string {
  return join(profilesDir(), `${name}.json`);
}

/** Pre-profile layout: a single session file holding credentials and one org. */
function legacySessionPath(): string {
  return join(configDir(), "session.json");
}

async function readJson<T>(path: string): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await Bun.write(path, JSON.stringify(value, null, 2));
  await chmod(path, 0o600);
}

async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export async function loadAccount(accountId: string): Promise<Account | null> {
  const a = await readJson<Account>(accountPath(accountId));
  if (
    a &&
    typeof a.refresh_token === "string" &&
    typeof a.refresh_expires_at === "number" &&
    a.user &&
    typeof a.user.email === "string"
  ) {
    return a;
  }
  return null;
}

export async function saveAccount(account: Account): Promise<void> {
  await writeJson(accountPath(account.user.id), account);
}

export async function loadProfile(name: string): Promise<Profile | null> {
  const p = await readJson<Profile>(profilePath(name));
  if (p && typeof p.account_id === "string" && typeof p.organization_id === "string") {
    return p;
  }
  return null;
}

export async function saveProfile(name: string, profile: Profile): Promise<void> {
  await writeJson(profilePath(name), profile);
}

/** Profile names on disk, sorted. */
export async function listProfiles(): Promise<string[]> {
  await migrateLegacySession();
  let entries: string[];
  try {
    entries = await readdir(profilesDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/** Load a profile and splice in its account's credentials. */
export async function loadSession(name: string): Promise<Session | null> {
  const profile = await loadProfile(name);
  if (!profile) return null;
  const account = await loadAccount(profile.account_id);
  if (!account) return null;
  return { ...account, ...profile, profile: name };
}

/**
 * Drop a profile, and the account behind it once no other profile needs it.
 * Returns the now-orphaned account so the caller can revoke its token.
 */
export async function removeProfile(name: string): Promise<{ orphanedAccount: Account | null }> {
  const profile = await loadProfile(name);
  await removeFile(profilePath(name));
  if (!profile) return { orphanedAccount: null };

  const account = await loadAccount(profile.account_id);
  for (const other of await listProfiles()) {
    const p = await loadProfile(other);
    if (p?.account_id === profile.account_id) return { orphanedAccount: null };
  }
  await removeFile(accountPath(profile.account_id));
  return { orphanedAccount: account };
}

type LegacySession = {
  refresh_token: string;
  refresh_expires_at: number;
  organization_id: string;
  user: Account["user"];
};

/**
 * Split a pre-profile session.json into an account plus a profile named
 * "default", so an existing login survives the upgrade untouched.
 */
export async function migrateLegacySession(): Promise<void> {
  const legacy = await readJson<LegacySession>(legacySessionPath());
  if (!legacy?.refresh_token || !legacy.user?.id) {
    await removeFile(legacySessionPath());
    return;
  }
  await saveAccount({
    refresh_token: legacy.refresh_token,
    refresh_expires_at: legacy.refresh_expires_at,
    user: legacy.user,
  });
  await saveProfile("default", {
    account_id: legacy.user.id,
    organization_id: legacy.organization_id,
  });
  await removeFile(legacySessionPath());
  console.error('Migrated your existing session to the profile "default".');
}
