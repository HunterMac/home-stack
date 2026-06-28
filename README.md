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

For the full design and the rationale behind the technical choices, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md). A quick overview:

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

## Prerequisites: install Node ≥ 20 + git

> **If you don't have `node`/`npm` yet** (`-bash: npm: command not found`),
> install them first. Raspberry Pi OS Lite ships without Node.

Recommended (current Node, arm64, lands in `/usr/bin` so systemd units can find it):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v   # expect v22.x
npm -v
```

> Avoid `apt install npm` from Debian's repo — it pulls Node 18, but this project
> needs ≥ 20. nvm works too, but installs Node under `~/.nvm`, which the root-run
> systemd timers/services may not find — prefer NodeSource for a Pi appliance.

## Quick start

On the Pi (Raspberry Pi OS Lite 64-bit), in your **user's home dir** (not `/srv`
and not as root):

```bash
cd ~
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

Add/remove apps anytime (no full setup needed). After linking the global CLI
(see next section) these become `hstack ...`; until then use the npm form:

```bash
npm run hstack -- list                       # see the catalog
sudo npm run hstack -- install jellyfin      # install + bring up + .local route
sudo npm run hstack -- uninstall jellyfin    # remove container (keeps data)
```

> Run `npm install` as your normal user (so `node_modules` isn't owned by root);
> only `setup`/`install`/`uninstall` need `sudo`. Keep the repo in place after
> setup — the systemd backup + mDNS units reference its path.

After it finishes:

```bash
npm run status        # containers, URLs, backup snapshots
```

Open `https://portainer.local` (and `https://homeassistant.local`). With
`tls internal`, trust Caddy's root CA once or accept the browser warning.

---

## Use it as a global `hstack` command

**`sudo npm run setup` already does this for you** — it symlinks
`/usr/local/bin/hstack` to the repo launcher as its last step. So the typical
update loop is just:

```bash
cd ~/home-stack && git pull && sudo npm run setup
```

After that, `hstack ...` works from anywhere. Pass `--no-link` to setup to skip
it. To (re)create the link without a full setup:

```bash
cd ~/home-stack
sudo npm run link-cli         # symlinks /usr/local/bin/hstack -> repo launcher
```

(Equivalent manual step: `sudo ln -sf "$PWD/bin/hstack" /usr/local/bin/hstack`.)

Now both user and root invocations work:

```bash
hstack list
sudo hstack setup
sudo hstack install homeassistant
sudo hstack install jellyfin homeassistant
sudo hstack uninstall jellyfin
hstack status
sudo hstack service visibility jellyfin public
```

The launcher resolves the repo through the symlink and runs the TypeScript CLI
with the repo's local `tsx` — so **keep the repo in place** (don't delete
`~/home-stack`). It defaults to `~/home-stack/home-stack.config.json` when run
from any other directory, so you can call `hstack` from anywhere.

> The rest of this README uses the `hstack <cmd>` form. Without the global link,
> the equivalent is `npm run hstack -- <cmd>` (run inside the repo).

---

## Commands

| Command | What it does |
|---|---|
| `sudo hstack setup` | Provision/converge core stack (idempotent) |
| `sudo hstack setup --install jellyfin homeassistant` | Same, plus install apps |
| `sudo hstack setup --skip-backup` | Skip Restic setup |
| `hstack list` | List the app catalog + install status |
| `sudo hstack install <app...>` | Install catalog app(s) + converge |
| `sudo hstack uninstall <app...>` | Remove app(s) (keeps data) |
| `hstack service list` | Show each service's exposure (local/public) |
| `sudo hstack service visibility <name> public\|local` | Set exposure |
| `hstack status` | Show containers, service URLs, backup snapshots |
| `hstack backup` | Run a Restic backup + retention now |
| `hstack restore --list` | List snapshots |
| `hstack restore --snapshot latest` | Restore into a staging dir (`/srv/docker/_restore`) |
| `hstack restore --snapshot latest --in-place` | Restore over live paths (dangerous) |

All commands accept `--config <path>` (default `home-stack.config.json`).

> Without the global link, use `npm run hstack -- <cmd>` (inside the repo).
> `sudo` is required for `setup`, `install`, `uninstall`, `service visibility`
> (they touch docker, /srv/docker and systemd).

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

- `auth` — optional shared basic-auth gate (see *Password protection* below).
- `public` / `visibility` — public-domain exposure (see *Service visibility* below).

---

## The app catalog

Installable apps are a fixed catalog under `src/catalog/apps/` (one file per app). Current entries:

| App | Port | Description |
|---|---|---|
| `home-assistant` | 8123 | Home automation hub |
| `jellyfin` | 8096 | Media server |
| `filebrowser` | 80 | Web file manager |
| `ollama` | 11434 | Local LLM API (Ollama) |
| `uptime-kuma` | 3001 | Uptime monitoring |

```bash
hstack list
sudo hstack install jellyfin
```

Installing an app: persists it to `installed`, creates its `config/<app>` +
`appdata/<app>` folders (plus any extra dirs it declares), seeds its config
once, regenerates `docker-compose.yml` + `Caddyfile` + mDNS, and brings it up at
`https://<app>.local`. Uninstalling removes the container (data is kept).

### Adding a new app to the catalog

Create `src/catalog/apps/my-app.ts` exporting an `AppDefinition`, then register
it in `src/catalog/index.ts`. The compose service, Caddy route, mDNS hostname
and folders are all derived automatically. See any existing app file for the pattern.

---

## Service visibility (local vs public)

Every service is **local by default**: reachable only on your LAN via
`<name>.local` (mDNS) with Caddy's internal CA — **not routable from the
internet**. You opt a service into public exposure explicitly:

```bash
hstack service list                       # show exposure of all
sudo hstack service visibility jellyfin public
sudo hstack service visibility jellyfin local    # back to LAN-only
hstack service visibility jellyfin              # just show current
```

Public mode adds a second Caddy site on a **real domain**
(`<name>.<public.baseDomain>`) with automatic **Let's Encrypt** TLS, while
keeping the `.local` LAN block. First set the public domain + email:

```json
"public": { "baseDomain": "home.example.com", "tlsEmail": "you@example.com" }
```

> **Security — read before going public.** Caddy + TLS is not enough on its own.
> Making a service public also requires, and exposes you to risk via:
> 1. **Router port-forward** of `80` + `443` to the Pi (the script can't do this),
>    or a tunnel (Cloudflare Tunnel / Tailscale Funnel) instead.
> 2. **Public DNS** for `<name>.<baseDomain>` pointing at your public IP
>    (use dynamic DNS if your IP isn't static).
> 3. **Authentication.** Turn on `auth` and add the service to `auth.apps`
>    unless it has its own strong login. **Never expose Portainer unprotected.**
>    Don't expose Home Assistant via basic auth — use HA's own auth + the
>    [HA docs on remote access](https://www.home-assistant.io/docs/configuration/remote/).

Visibility is stored per service under `visibility` in the config and applied by
regenerating the Caddyfile (Caddy is reloaded gracefully, no downtime).

---

## Password protection (shared basic auth)

Optionally put a shared HTTP basic-auth gate in front of services at the **Caddy
layer** (no per-container hacks). Enabled in the `auth` block:

```json
"auth": {
  "enabled": true,
  "username": "admin",
  "password": "change-me",
  "protectCore": true,
  "apps": ["jellyfin"]
}
```

- `protectCore` gates **Portainer** (it also has its own login → defense in depth).
- `apps` lists installed apps to also gate. Anything not listed is left open.
- Password is stored plaintext here (this file is gitignored). Caddy needs a
  **bcrypt** hash, so setup derives one with `caddy hash-password` and caches it
  under `config/caddy/.basicauth.*` (regenerated only when you change the
  credential — no needless Caddy restarts).

> **Don't gate Home Assistant.** Basic auth breaks the HA mobile app, API and
> websockets. HA has strong built-in auth + tokens — leave it out of `apps`.
> Same applies to any app you reach via a native app/API rather than a browser.

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
  `network_mode: host` in `src/catalog/apps/home-assistant.ts` if you need it and proxy to the Pi's IP.
- Adding the user to the `docker` group takes effect on next login.
- Designed and tested against Raspberry Pi OS (Debian bookworm) on arm64.
```
