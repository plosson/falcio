# falcio

> **Note:** falcio is now integrated into [agentio](https://github.com/plosson/agentio). No further updates will be made to this repo.

CLI for your Falco account — sync received peppol invoices, issued sales invoices and payment status from the terminal.

## Install

```sh
curl -LsSf https://falcio.houlahop.com/install | sh
```

Supported platforms: macOS (Apple Silicon), Linux x64 / arm64, Windows x64. The installer downloads a single self-contained binary from GitHub Releases into `~/.local/bin` (override with `FALCIO_INSTALL_DIR` or `--install-dir`). On Windows, download `falcio-windows-x64.exe` from [GitHub Releases](https://github.com/plosson/falcio/releases/latest) and put it on your `PATH` as `falcio.exe`.

## Usage

```
falcio login
falcio whoami
falcio logout
falcio peppol list      [--since YYYY-MM-DD] [--sender <vat>] [--json]
falcio peppol get       <id> [--out <file|dir|->] [--extract-pdf]
falcio peppol sync      --out <dir> [--since YYYY-MM-DD] [--sender <vat>] [--extract-pdf] [--force]
falcio peppol mark-paid <id> [--status Paid|NotPaid] [--unpaid] [--json]
falcio invoices sync    --out <dir> [--since YYYY-MM-DD] [--customer <name>] [--include Invoice,CreditNote] [--force]
falcio update           [--check] [--force] [-y]
```

Most commands are read-only; `peppol mark-paid` writes the invoice payment status.

## Updating

```sh
falcio update
```

Checks GitHub Releases for a newer version and replaces the running binary in place.

## Development

Requires [bun](https://bun.sh).

```sh
bun install
bun run dev -- --help     # run from source
bun run typecheck         # tsc --noEmit
bun run build:native      # compile a local binary to dist/falcio
```

## Releasing

1. Bump `version` in `package.json`
2. `git commit -am "Bump version to X.Y.Z" && git push`
3. `git tag vX.Y.Z && git push origin vX.Y.Z`

The release workflow validates the tag against `package.json`, cross-compiles binaries for all targets (`bun build --compile`), and publishes them with checksums to GitHub Releases.
