# home-stack

Idempotent **Raspberry Pi 5** node configurator (Node + TypeScript) that turns a
fresh **Raspberry Pi OS Lite 64-bit** into a small Docker home-services host:

- **Docker Engine + Compose** installed from Docker's apt repo
- **Two core services, always on**: **Portainer** (container UI) + **Caddy** (reverse proxy)
- **App catalog** you install on demand: `home-stack install jellyfin homeassistant ...`
- **Caddy** reverse proxy with per-service `*.local` hostnames + internal TLS
- **Restic** backups (config-level + data-level) on a nightly systemd timer
- Clean on-disk layout with **config separated from persistent data**

Only **portainer** and **caddy** are pre-installed. Everything else is opt-in
from the catalog (`home-stack list`).

Re-running `setup` is safe: every step converges and only changes what drifted.

---

## Architecture

```
/srv/docker/                 # storage root (ext4 in Phase 1, btrfs in Phase 2)
├── compose/                 # generated docker-compose.yml
├── config/                  # per-service CONFIG (editable, backed up)
│   ├── caddy/Caddyfile      # generated from your service list
│   ├── homeassistant/       # configuration.yaml (seeded once, then yours)
│   └── restic/password      # auto-generated repo password (0600) — BACK UP!
├── appdata/                 # per-service persistent DATA / state
│   ├── portainer/
│   ├── caddy/{data,config}/
│   └── homeassistant/...
└── backups/restic/          # local restic repository (Phase 1 default)
```

Why split `config/` and `appdata/`? It makes **config-only** vs **full**
restores trivial, and keeps the noisy, large state out of the part you most
want to version and reason about.

### Request flow

```
phone/laptop ──mDNS──> homeassistant.local ─┐
                       portainer.local      ├─> Caddy :80/:443 ─> container:port
                       ...                  ─┘   (tls internal)
```

`*.local` names are advertised over **Avahi/mDNS** by a small systemd service
(`home-stack-mdns`) that publishes one address record per service pointing at
the Pi's primary IP. No router DNS config needed.

---

## Quick start

On the Pi (Raspberry Pi OS Lite 64-bit, with Node ≥ 20 + git):

```bash
git clone https://github.com/HunterMac/home-stack.git && cd home-stack
npm install
cp home-stack.config.example.json home-stack.config.json
# edit timezone / user / services as needed
nano home-stack.config.json

# converge core stack (portainer + caddy). root needed for apt/docker/systemd:
sudo npm run setup

# ...or also install apps in the same pass:
sudo npm run setup -- --install jellyfin homeassistant
```

Add/remove apps anytime (no full setup needed):

```bash
npm run home-stack -- list                       # see the catalog
sudo npm run home-stack -- install jellyfin      # install + bring up + .local route
sudo npm run home-stack -- uninstall jellyfin    # remove container (keeps data)
```

> Don't have Node yet? `sudo apt install -y nodejs npm git` (or use nvm).

After it finishes:

```bash
npm run status        # containers, URLs, backup snapshots
```

Open `https://portainer.local` (and `https://homeassistant.local`). With
`tls internal`, trust Caddy's root CA once or accept the browser warning.

---

## Commands

| Command | What it does |
|---|---|
| `sudo npm run setup` | Provision/converge core stack (idempotent) |
| `sudo npm run setup -- --install jellyfin homeassistant` | Same, plus install apps |
| `sudo npm run setup -- --skip-backup` | Skip Restic setup |
| `npm run home-stack -- list` | List the app catalog + install status |
| `sudo npm run home-stack -- install <app...>` | Install catalog app(s) + converge |
| `sudo npm run home-stack -- uninstall <app...>` | Remove app(s) (keeps data) |
| `npm run status` | Show containers, service URLs, backup snapshots |
| `npm run backup` | Run a Restic backup + retention now |
| `npm run restore -- --list` | List snapshots |
| `npm run restore -- --snapshot latest` | Restore into a staging dir (`/srv/docker/_restore`) |
| `npm run restore -- --snapshot latest --in-place` | Restore over live paths (dangerous) |

All commands accept `--config <path>` (default `home-stack.config.json`).

> `npm run home-stack -- <cmd>` forwards to the CLI. `sudo` is required for
> `setup`, `install`, `uninstall` (they touch docker, /srv/docker and systemd).

---

## Configuration

Edit `home-stack.config.json` (copied from the `.example`). Key fields:

- `user` — stack owner added to the `docker` group (auto-detected from `sudo` if empty)
- `timezone` — applied to all containers
- `storage.phase` — `1` = ext4 (default), `2` = btrfs subvolumes
- `storage.device` — optional dedicated block device to mount at `storage.root`
  (formatted **only** if it has no filesystem; never overwrites existing data)
- `network.domainSuffix` — `local` → `homeassistant.local`
- `network.tls` — `internal` (self-signed CA) or `off` (http only)
- `installed` — catalog apps to deploy; **managed for you** by
  `install`/`uninstall`, but you can also pre-seed it by hand:

```json
"installed": ["homeassistant", "jellyfin"]
```

---

## The app catalog

Installable apps are a fixed catalog in `src/catalog.ts`. Current entries:

| App | Port | Description |
|---|---|---|
| `homeassistant` | 8123 | Home automation hub |
| `jellyfin` | 8096 | Media server |
| `uptime-kuma` | 3001 | Uptime monitoring |

```bash
npm run home-stack -- list
sudo npm run home-stack -- install jellyfin
```

Installing an app: persists it to `installed`, creates its `config/<app>` +
`appdata/<app>` folders (plus any extra dirs it declares), seeds its config
once, regenerates `docker-compose.yml` + `Caddyfile` + mDNS, and brings it up at
`https://<app>.local`. Uninstalling removes the container (data is kept).

### Adding a new app to the catalog

Add one entry to the `CATALOG` map in `src/catalog.ts` — `name`, `upstreamPort`,
a `compose(ctx)` builder, and optionally `dirs`, `seed`, `note`. The compose
service, Caddy route, mDNS hostname and folders are all derived automatically.
No other file needs changing.

---

## Backups

- First setup generates a random Restic password at
  `config/restic/password` (mode `0600`). **Copy it somewhere safe** — without
  it the backups are unrecoverable.
- A `home-stack-backup.timer` runs nightly (`03:30` by default) and applies the
  `keepDaily/Weekly/Monthly` retention with prune.
- Default repo is local under `backups/restic`. For off-box safety, point
  `backup.repo` at a remote (`sftp:`, `rest:`, `s3:`, B2, etc.) per the
  [Restic docs](https://restic.readthedocs.io/) and add credentials to the
  systemd service environment.

Restore example (config-only style — review then copy):

```bash
npm run restore -- --snapshot latest --target /srv/docker/_restore
```

---

## Phase 2: btrfs

Set `storage.phase = 2` and `storage.device = /dev/sdX` in the config. Setup
will install `btrfs-progs`, format the device (only if blank), mount it at
`storage.root`, and create `appdata`/`config`/`backups`/`compose` **subvolumes**
for cheap snapshots. Everything else is identical to Phase 1.

---

## Notes & tradeoffs

- **Home Assistant** runs on the shared bridge network (not host mode) so Caddy
  can reach it by name. Pure host mode enables some local-discovery integrations
  but breaks name-based reverse proxying; switch the `homeassistant` entry to
  `network_mode: host` in `src/catalog.ts` if you need it and proxy to the Pi's IP.
- Adding the user to the `docker` group takes effect on next login.
- Designed and tested against Raspberry Pi OS (Debian bookworm) on arm64.
```
