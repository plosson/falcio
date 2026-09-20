import { listProfiles, loadProfile, loadAccount } from "../../lib/store.ts";
import { requestedProfile } from "../../lib/profile.ts";

const HELP = `falcio profile list — show the stored profiles

Usage:
  falcio profile list [--json]

Options:
  --json           Emit JSON instead of a table.
  -h, --help       Show this help.
`;

type Row = {
  name: string;
  email: string;
  organization_id: string;
  organization_name: string;
  expired: boolean;
};

async function collect(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const name of await listProfiles()) {
    const profile = await loadProfile(name);
    if (!profile) continue;
    const account = await loadAccount(profile.account_id);
    rows.push({
      name,
      email: account?.user.email ?? "(missing account)",
      organization_id: profile.organization_id,
      organization_name: profile.organization_name ?? "",
      expired: account ? Date.now() >= account.refresh_expires_at : true,
    });
  }
  return rows;
}

export async function runProfileList(args: string[]): Promise<number> {
  let json = false;
  for (const arg of args) {
    switch (arg) {
      case "--json":
        json = true;
        break;
      case "-h":
      case "--help":
        console.log(HELP);
        return 0;
      default:
        console.error(`Unknown option: ${arg}\n`);
        console.log(HELP);
        return 1;
    }
  }

  const rows = await collect();
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (rows.length === 0) {
    console.log("No profiles. Run `falcio login` to create one.");
    return 0;
  }

  // Mark the profile a bare command would act on: the only one, or the requested.
  const requested = requestedProfile();
  const active = requested ?? (rows.length === 1 ? rows[0]!.name : undefined);
  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const emailWidth = Math.max(...rows.map((r) => r.email.length));
  for (const r of rows) {
    const org = r.organization_name || r.organization_id;
    const flags = r.expired ? "  (expired)" : "";
    const mark = r.name === active ? "*" : " ";
    console.log(`${mark} ${r.name.padEnd(nameWidth)}  ${r.email.padEnd(emailWidth)}  ${org}${flags}`);
  }
  if (!active) {
    console.log("\nPass --profile <name> or set FALCIO_PROFILE to choose one.");
  }
  return 0;
}
