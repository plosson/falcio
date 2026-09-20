import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { prompt } from "../lib/prompt.ts";
import { getVersion } from "../lib/version.ts";

const GITHUB_REPO = "plosson/falcio";
const USER_AGENT = "falcio-updater";

const HELP = `falcio update — update falcio to the latest release

Usage:
  falcio update [--check] [--force] [-y]

Options:
  --check          Only check for updates, don't install.
  --force          Reinstall even if already on the latest version.
  -y, --yes        Skip the confirmation prompt.
  -h, --help       Show this help.
`;

interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function getPlatform(): string {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

function isCompiledBinary(): boolean {
  // In compiled bun binaries, argv[0] is just "bun" (no path);
  // in dev mode it is a full path like "/Users/.../bun".
  return process.argv[0] === "bun" && !/[\\/]bun(\.exe)?$/.test(process.execPath);
}

interface LatestRelease {
  tag: string;
  // Populated only when the REST API answered; the redirect path knows the tag
  // but not the asset list.
  assets: GitHubRelease["assets"] | null;
}

function githubAuthHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// github.com/<repo>/releases/latest redirects to /releases/tag/<tag>. This is not
// the REST API, so it does not consume the 60 requests/hour that api.github.com
// allows an unauthenticated IP - a budget other tools on the same machine (or
// behind the same NAT) can exhaust on their own.
async function fetchLatestTagViaRedirect(): Promise<string | null> {
  try {
    const res = await fetch(`https://github.com/${GITHUB_REPO}/releases/latest`, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT },
    });
    const location = res.headers.get("location");
    const match = location?.match(/\/releases\/tag\/([^/?#]+)$/);
    return match ? decodeURIComponent(match[1]!) : null;
  } catch {
    return null;
  }
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": USER_AGENT,
      ...githubAuthHeaders(),
    },
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("No releases found");
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0);
      const minutes = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 0;
      throw new Error(
        `GitHub API rate limit exceeded${minutes ? ` (resets in ~${minutes} min)` : ""}. ` +
          "Set GITHUB_TOKEN (or GH_TOKEN) to raise the limit, or install manually with: " +
          "curl -LsSf https://falcio.houlahop.com/install | sh",
      );
    }
    throw new Error(`Failed to fetch release info: ${res.statusText}`);
  }
  return res.json() as Promise<GitHubRelease>;
}

// Prefer the redirect; fall back to the REST API so a GitHub change to the
// redirect shape degrades to the old behaviour rather than breaking updates.
async function resolveLatestRelease(): Promise<LatestRelease> {
  const tag = await fetchLatestTagViaRedirect();
  if (tag) return { tag, assets: null };

  const release = await fetchLatestRelease();
  return { tag: release.tag_name, assets: release.assets };
}

// The redirect path never sees the asset list, so the download URL is built from
// the tag and probed with a HEAD to keep the "no binary for this platform" error.
async function resolveDownloadUrl(
  release: LatestRelease,
  assetName: string,
  platform: string,
): Promise<string | null> {
  if (release.assets) {
    const asset = release.assets.find((a) => a.name === assetName);
    if (!asset) {
      console.error(`No binary found for ${platform}.`);
      console.error(`Available assets: ${release.assets.map((a) => a.name).join(", ")}`);
      return null;
    }
    return asset.browser_download_url;
  }

  const url = `https://github.com/${GITHUB_REPO}/releases/download/${release.tag}/${assetName}`;
  const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    console.error(`No binary found for ${platform} in release ${release.tag}.`);
    console.error(`Expected asset: ${assetName}`);
    return null;
  }
  return url;
}

function compareVersions(current: string, latest: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const c = parse(current);
  const l = parse(latest);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return 1;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return -1;
  }
  return 0;
}

function renderProgress(received: number, total: number, done = false): void {
  const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
  const width = 30;
  let line: string;
  if (total > 0) {
    const pct = Math.min(100, Math.floor((received / total) * 100));
    const filled = Math.floor((pct / 100) * width);
    line = `  [${"█".repeat(filled)}${"░".repeat(width - filled)}] ${pct}% (${mb(received)}/${mb(total)} MB)`;
  } else {
    line = `  Downloaded ${mb(received)} MB`;
  }
  process.stderr.write(`\r\x1b[K${line}`);
  if (done) process.stderr.write("\n");
}

async function writeChunk(stream: fs.WriteStream, chunk: Uint8Array): Promise<void> {
  if (stream.write(chunk)) return;
  await new Promise<void>((resolve) => stream.once("drain", resolve));
}

async function downloadBinary(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.statusText}`);

  const total = Number(res.headers.get("content-length") || 0);
  let received = 0;
  let lastRender = 0;
  const showProgress = process.stderr.isTTY;

  const file = fs.createWriteStream(dest);
  try {
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writeChunk(file, value);
      received += value.length;
      if (showProgress) {
        const now = Date.now();
        if (now - lastRender > 100) {
          renderProgress(received, total);
          lastRender = now;
        }
      }
    }
    if (showProgress) renderProgress(received, total, true);
  } finally {
    await new Promise<void>((resolve, reject) => {
      file.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}

function moveFile(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (err: unknown) {
    // Cross-device rename fails with EXDEV; fall back to copy+delete.
    if (err && typeof err === "object" && "code" in err && err.code === "EXDEV") {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

async function updateBinary(downloadUrl: string, targetPath: string): Promise<void> {
  // Download next to the target so the final rename stays on one filesystem.
  const tmpFile = path.join(path.dirname(targetPath), `.falcio-update-${Date.now()}`);

  console.error("Downloading update...");
  await downloadBinary(downloadUrl, tmpFile);

  if (fs.statSync(tmpFile).size === 0) {
    fs.unlinkSync(tmpFile);
    throw new Error("Downloaded file is empty");
  }

  let originalMode = 0o755;
  try {
    originalMode = fs.statSync(targetPath).mode;
  } catch {
    // Use the default if the original can't be read.
  }

  console.error("Installing update...");
  fs.chmodSync(tmpFile, originalMode);
  if (os.platform() === "win32") {
    // Windows locks a running exe against overwrite but allows renaming it away.
    const oldFile = `${targetPath}.old`;
    try {
      fs.unlinkSync(oldFile);
    } catch {
      // Leftover from a previous update may not exist; ignore.
    }
    fs.renameSync(targetPath, oldFile);
    try {
      moveFile(tmpFile, targetPath);
    } catch (err) {
      fs.renameSync(oldFile, targetPath);
      throw err;
    }
  } else {
    // The running process keeps the old inode open, so renaming over it is safe.
    moveFile(tmpFile, targetPath);
  }
}

export async function runUpdate(args: string[]): Promise<number> {
  let check = false;
  let force = false;
  let yes = false;
  for (const arg of args) {
    switch (arg) {
      case "--check":
        check = true;
        break;
      case "--force":
        force = true;
        break;
      case "-y":
      case "--yes":
        yes = true;
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

  const currentVersion = getVersion();
  const platform = getPlatform();
  const assetName = platform === "windows-x64" ? `falcio-${platform}.exe` : `falcio-${platform}`;

  console.error(`Current version: ${currentVersion}`);
  console.error("Checking for updates...");

  const release = await resolveLatestRelease();
  const latestVersion = release.tag.replace(/^v/, "");
  const comparison = compareVersions(currentVersion, latestVersion);

  if (comparison === 0 && !force) {
    console.log(`Already on the latest version (${currentVersion})`);
    return 0;
  }
  if (comparison < 0 && !force) {
    console.log(`Current version (${currentVersion}) is newer than latest release (${latestVersion})`);
    return 0;
  }

  console.log(`New version available: ${latestVersion}`);
  if (check) return 0;

  if (!isCompiledBinary()) {
    console.error("The update command only works with compiled binaries.");
    console.error("In development, use git pull and bun install instead.");
    return 1;
  }

  const downloadUrl = await resolveDownloadUrl(release, assetName, platform);
  if (!downloadUrl) return 1;

  if (!yes) {
    const answer = (await prompt(`Update from ${currentVersion} to ${latestVersion}? [y/N] `)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      console.error("Update cancelled");
      return 0;
    }
  }

  try {
    await updateBinary(downloadUrl, process.execPath);
    console.log(`Successfully updated to version ${latestVersion}`);
    return 0;
  } catch (error) {
    console.error("");
    console.error("Automatic update failed. You can reinstall manually:");
    console.error("");
    if (os.platform() === "win32") {
      console.error(`  Download ${assetName} from https://github.com/${GITHUB_REPO}/releases/latest`);
    } else {
      console.error(`  curl -LsSf https://falcio.houlahop.com/install | sh`);
    }
    console.error("");
    throw error;
  }
}
