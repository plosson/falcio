import { listProfiles } from "./store.ts";

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

// Profile names become filenames, so keep them to a conservative slug.
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function isValidProfileName(name: string): boolean {
  return NAME_RE.test(name) && name !== "." && name !== "..";
}

/** Suggest a profile name from an organization name, e.g. "Acme BV" -> "acme-bv". */
export function slugify(orgName: string): string {
  const slug = orgName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return isValidProfileName(slug) ? slug : "default";
}

// Set once from the global --profile flag; FALCIO_PROFILE is the fallback.
let override: string | undefined;

export function setProfileOverride(name: string | undefined): void {
  override = name;
}

export function requestedProfile(): string | undefined {
  return override ?? process.env.FALCIO_PROFILE ?? undefined;
}

/**
 * Pick the profile to act on. A profile must be named explicitly whenever more
 * than one exists, so a command can never silently hit the wrong account.
 */
export async function resolveProfileName(): Promise<string> {
  const names = await listProfiles();
  const requested = requestedProfile();

  if (requested) {
    if (!isValidProfileName(requested)) {
      throw new ProfileError(`Invalid profile name: ${requested}`);
    }
    if (!names.includes(requested)) {
      throw new ProfileError(
        `No such profile: ${requested}\n` +
          (names.length
            ? `Known profiles: ${names.join(", ")}`
            : "Run `falcio login` to create one."),
      );
    }
    return requested;
  }

  if (names.length === 1) return names[0]!;
  if (names.length === 0) {
    throw new ProfileError("Not logged in. Run `falcio login` first.");
  }
  throw new ProfileError(
    `Multiple profiles exist: ${names.join(", ")}\n` +
      "Pass --profile <name> or set FALCIO_PROFILE.",
  );
}
