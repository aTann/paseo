# Desktop packaging

Build an installable Electron desktop app from this checkout. This is not the
repo `npm run dev` daemon. For day-to-day desktop development see
[development.md](development.md). GitHub Releases live in
[release.md](release.md).

Run every command from the repo root. Node version is in `.tool-versions`.

## Linux `.deb` (worked example)

Install packagers, then build only a Debian package for this machine:

```bash
sudo apt-get install -y fakeroot dpkg
npm ci
npm run build:desktop -- --publish never --linux deb --x64
```

On ARM hosts pass `--arm64` instead of `--x64`.

The file lands in `packages/desktop/release/`. Debian names the arch `amd64`
(x86_64) or `arm64`, not electron-builder's `x64`:

```text
packages/desktop/release/Paseo-<version>-amd64.deb
packages/desktop/release/Paseo-<version>-arm64.deb
```

`--linux --x64` without `deb` also builds AppImage, rpm, and tar.gz. `--dir`
writes an unpacked tree for smoke tests; it is not installable. See
[testing.md](testing.md#packaged-desktop-smoke).

Install and launch:

```bash
sudo dpkg -i packages/desktop/release/Paseo-<version>-amd64.deb
sudo apt-get install -f
Paseo
```

The binary is also at `/opt/Paseo/Paseo`. Remove with `sudo dpkg -r paseo`
(`dpkg -I` on the `.deb` has the package name if it differs).

The packaged app uses `~/.paseo` and port **6767**. Repo dev uses
`.dev/paseo-home` and **6768**. Do not restart a daemon already on 6767 to
install this package.

## Other local formats

`electron-builder.yml` owns the targets. Extra args after `--` go to
electron-builder:

| Host    | Command                                                      | Typical output                  |
| ------- | ------------------------------------------------------------ | ------------------------------- |
| Linux   | `npm run build:desktop -- --publish never --linux deb --x64` | `Paseo-<version>-amd64.deb`     |
| Linux   | `npm run build:desktop -- --publish never --linux --x64`     | AppImage, deb, rpm, tar.gz      |
| macOS   | `npm run build:desktop -- --publish never --mac`             | `Paseo-<version>-<arch>.dmg`    |
| Windows | `npm run build:desktop -- --publish never --win --x64`       | `Paseo-Setup-<version>-x64.exe` |

A Nix launcher (`nix build .#desktop`) is a different package: nixpkgs
Electron, no `.deb`. That path stays in [development.md](development.md).
