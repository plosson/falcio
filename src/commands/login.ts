import { login, getUserMe } from "../lib/api.ts";
import { saveAccount, saveProfile, listProfiles, loadProfile } from "../lib/store.ts";
import { isValidProfileName, requestedProfile, slugify } from "../lib/profile.ts";
import { prompt, promptHidden, promptChoice } from "../lib/prompt.ts";

const HELP = `falcio login — authenticate and store a profile

Usage:
  falcio login [--profile <name>]

A profile is one account on one organization. Log in again to add a second
organization, or a second account, as its own profile.

Options:
  --profile <name>  Name the profile instead of being prompted.
  -h, --help        Show this help.
`;

/** Ask for a profile name, defaulting to the org slug and rejecting bad input. */
async function promptProfileName(suggested: string, taken: string[]): Promise<string> {
  while (true) {
    const answer = (await prompt(`Profile name [${suggested}]: `)).trim();
    const name = answer || suggested;
    if (!isValidProfileName(name)) {
      console.error("  Use lowercase letters, digits, dot, dash or underscore (max 64).");
      continue;
    }
    if (taken.includes(name)) {
      const ok = (await prompt(`  Profile "${name}" exists. Overwrite? [y/N] `)).trim().toLowerCase();
      if (ok !== "y" && ok !== "yes") continue;
    }
    return name;
  }
}

export async function runLogin(args: string[]): Promise<number> {
  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      return 0;
    }
    console.error(`Unknown option: ${arg}\n`);
    console.log(HELP);
    return 1;
  }

  // --profile is stripped globally, so read the requested name from there.
  const preset = requestedProfile();
  if (preset && !isValidProfileName(preset)) {
    console.error(`Invalid profile name: ${preset}`);
    return 1;
  }

  const email = (await prompt("Email: ")).trim();
  if (!email) {
    console.error("Aborted: email is required.");
    return 1;
  }
  const password = await promptHidden("Password: ");
  if (!password) {
    console.error("Aborted: password is required.");
    return 1;
  }

  let result = await login({ username: email, password });
  if (result.type === "two_factor_required") {
    const code = (await prompt("2FA code: ")).trim();
    result = await login({ username: email, password, twoFaCode: code });
  }

  if (result.type !== "success") {
    if (result.type === "two_factor_required") {
      console.error("2FA code required but not provided.");
      return 1;
    }
    if (result.error === "invalid_credentials") {
      console.error("Invalid credentials.");
    } else if (result.error === "invalid_two_factor_code") {
      console.error("Invalid 2FA code.");
    } else {
      console.error(`Login failed (${result.status} ${result.error}).`);
      if (result.details) console.error(result.details);
    }
    return 1;
  }

  // Fetch user + orgs for the org picker.
  const me = await getUserMe(result.access_token);
  if (!me.ok) {
    console.error(`GET /user/me failed (${me.status}): ${me.bodyText.slice(0, 400)}`);
    return 1;
  }
  const { organizations, id, email: emailOut, firstName, lastName } = me.data;
  if (!organizations || organizations.length === 0) {
    console.error("No organizations returned for this account.");
    return 1;
  }

  const existing = await listProfiles();
  const chosen = await promptChoice(
    `\nAvailable organizations (${organizations.length}):`,
    organizations,
    (o) => `${o.name}${o.vatNumber ? ` — ${o.vatNumber}` : ""} (${o.id})`,
  );

  // Reuse the profile already pointing at this account/org pair, so logging in
  // again to renew a token does not quietly leave a duplicate behind.
  let name = preset;
  if (!name) {
    for (const candidate of existing) {
      const p = await loadProfile(candidate);
      if (p?.account_id === id && p.organization_id === chosen.id) {
        name = candidate;
        break;
      }
    }
  }
  if (!name) {
    name = await promptProfileName(slugify(chosen.name), existing);
  }

  const now = Date.now();
  await saveAccount({
    refresh_token: result.refresh_token,
    refresh_expires_at: now + result.refresh_token_expires_in * 1000,
    user: { id, email: emailOut, firstName, lastName },
  });
  await saveProfile(name, {
    account_id: id,
    organization_id: chosen.id,
    organization_name: chosen.name,
  });

  const expiresOn = new Date(now + result.refresh_token_expires_in * 1000).toISOString().slice(0, 10);
  console.log(`\nLogged in as ${firstName} ${lastName} <${emailOut}>.`);
  console.log(`Profile:    ${name}`);
  console.log(`Active org: ${chosen.name} (${chosen.id})`);
  console.log(`Session valid until ${expiresOn} (auto-renewed on each use).`);
  if (existing.length > 0 && !existing.includes(name)) {
    console.log(`\nYou now have several profiles. Pass --profile ${name} to use this one.`);
  }
  return 0;
}
