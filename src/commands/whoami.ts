import { ensureAccessToken } from "../lib/auth.ts";
import { getUserMe } from "../lib/api.ts";

export async function runWhoami(_args: string[]): Promise<number> {
  const { session, accessToken } = await ensureAccessToken();
  const me = await getUserMe(accessToken);
  if (!me.ok) {
    console.error(`GET /user/me failed (${me.status}): ${me.bodyText.slice(0, 400)}`);
    return 1;
  }
  const activeOrg = me.data.organizations.find((o) => o.id === session.organization_id);
  const expires = new Date(session.refresh_expires_at).toISOString();
  console.log(`Profile:    ${session.profile}`);
  console.log(`User:       ${me.data.firstName} ${me.data.lastName} <${me.data.email}>`);
  console.log(`User id:    ${me.data.id}`);
  console.log(
    `Active org: ${activeOrg ? activeOrg.name : "(unknown)"} (${session.organization_id})`,
  );
  console.log(`Session:    refresh token expires ${expires}`);
  console.log(`Other orgs: ${me.data.organizations.length - 1}`);
  return 0;
}
