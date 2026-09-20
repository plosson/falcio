#!/usr/bin/env bun
import { runLogin } from "./commands/login.ts";
import { runWhoami } from "./commands/whoami.ts";
import { runLogout } from "./commands/logout.ts";
import { runPeppolList } from "./commands/peppol/list.ts";
import { runPeppolGet } from "./commands/peppol/get.ts";
import { runPeppolSync } from "./commands/peppol/sync.ts";
import { runPeppolMarkPaid } from "./commands/peppol/mark-paid.ts";
import { runInvoicesSync } from "./commands/invoices/sync.ts";
import { runProfileList } from "./commands/profile/list.ts";
import { runUpdate } from "./commands/update.ts";
import { AuthError } from "./lib/auth.ts";
import { ProfileError, setProfileOverride } from "./lib/profile.ts";
import { getVersion } from "./lib/version.ts";

const HELP = `falcio — CLI for your Falco account

Usage:
  falcio login
  falcio whoami
  falcio logout
  falcio profile list     [--json]
  falcio peppol list      [--since YYYY-MM-DD] [--sender <vat>] [--json]
  falcio peppol get       <id> [--out <file|dir|->] [--extract-pdf]
  falcio peppol sync      --out <dir> [--since YYYY-MM-DD] [--sender <vat>] [--extract-pdf] [--force]
  falcio peppol mark-paid <id> [--status Paid|NotPaid] [--unpaid] [--json]
  falcio invoices sync    --out <dir> [--since YYYY-MM-DD] [--customer <name>] [--include Invoice,CreditNote] [--force]
  falcio update           [--check] [--force] [-y]

Options:
  --profile <name> Profile to act on (required when several exist).
  -h, --help       Show this help.
  -v, --version    Show the version.

A profile is one account on one organization; \`falcio login\` creates one.
FALCIO_PROFILE sets the profile when --profile is absent.

Most commands are read-only; \`peppol mark-paid\` writes the invoice payment status.
`;

async function runInvoices(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "sync":
      return runInvoicesSync(rest);
    case undefined:
    case "-h":
    case "--help":
      console.log(HELP);
      return sub === undefined ? 1 : 0;
    default:
      console.error(`Unknown invoices subcommand: ${sub}\n`);
      console.log(HELP);
      return 1;
  }
}

async function runProfile(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "list":
      return runProfileList(rest);
    case undefined:
    case "-h":
    case "--help":
      console.log(HELP);
      return sub === undefined ? 1 : 0;
    default:
      console.error(`Unknown profile subcommand: ${sub}\n`);
      console.log(HELP);
      return 1;
  }
}

async function runPeppol(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "list":
      return runPeppolList(rest);
    case "get":
      return runPeppolGet(rest);
    case "sync":
      return runPeppolSync(rest);
    case "mark-paid":
      return runPeppolMarkPaid(rest);
    case undefined:
    case "-h":
    case "--help":
      console.log(HELP);
      return sub === undefined ? 1 : 0;
    default:
      console.error(`Unknown peppol subcommand: ${sub}\n`);
      console.log(HELP);
      return 1;
  }
}

/**
 * Pull the global `--profile <name>` out of argv wherever it appears, so every
 * subcommand parser sees only its own options.
 */
function extractProfileFlag(argv: string[]): { rest: string[]; error?: string } {
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--profile") {
      const value = argv[++i];
      if (!value) return { rest, error: "--profile requires a name" };
      setProfileOverride(value);
      continue;
    }
    const inline = arg.match(/^--profile=(.*)$/);
    if (inline) {
      if (!inline[1]) return { rest, error: "--profile requires a name" };
      setProfileOverride(inline[1]);
      continue;
    }
    rest.push(arg);
  }
  return { rest };
}

async function main(): Promise<number> {
  const [, , ...raw] = process.argv;
  const { rest: argv, error } = extractProfileFlag(raw);
  if (error) {
    console.error(`${error}\n`);
    console.log(HELP);
    return 1;
  }
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv[0] === "-v" || argv[0] === "--version" || argv[0] === "version") {
    console.log(getVersion());
    return 0;
  }
  const [verb, ...rest] = argv;
  switch (verb) {
    case "login":
      return runLogin(rest);
    case "whoami":
      return runWhoami(rest);
    case "logout":
      return runLogout(rest);
    case "peppol":
      return runPeppol(rest);
    case "invoices":
      return runInvoices(rest);
    case "profile":
      return runProfile(rest);
    case "update":
      return runUpdate(rest);
    default:
      console.error(`Unknown command: ${verb}\n`);
      console.log(HELP);
      return 1;
  }
}

// No top-level await: `bun build --bytecode` does not support it.
main().then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof AuthError || e instanceof ProfileError) {
      console.error(e.message);
      process.exit(1);
    }
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  },
);
