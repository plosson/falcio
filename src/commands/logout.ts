import { listProfiles, loadSession, removeProfile } from "../lib/store.ts";
import { resolveProfileName } from "../lib/profile.ts";
import { revoke } from "../lib/api.ts";

const HELP = `falcio logout — drop a profile and revoke its credentials

Usage:
  falcio logout [--profile <name>]

Options:
  --profile <name>  Profile to log out (required when several exist).
  -h, --help        Show this help.
`;

export async function runLogout(args: string[]): Promise<number> {
  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      return 0;
    }
    console.error(`Unknown option: ${arg}\n`);
    console.log(HELP);
    return 1;
  }

  // Logging out of nothing stays a successful no-op.
  if ((await listProfiles()).length === 0) {
    console.log("Not logged in; nothing to do.");
    return 0;
  }

  const name = await resolveProfileName();
  const session = await loadSession(name);
  // The token is only revoked once the last profile using that account is gone,
  // so logging out of one organization leaves the others working.
  const { orphanedAccount } = await removeProfile(name);
  if (orphanedAccount) {
    await revoke(orphanedAccount.refresh_token);
    console.log(`Logged out of profile "${name}" (${orphanedAccount.user.email}).`);
  } else if (session) {
    console.log(`Removed profile "${name}"; other profiles still use that account.`);
  } else {
    console.log(`Removed profile "${name}".`);
  }
  return 0;
}
