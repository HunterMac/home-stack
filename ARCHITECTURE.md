# Architecture

This document explains how **home-stack** is structured and *why* the main
technical decisions were made. For usage see [`README.md`](./README.md).

---

## 1. Goal & constraints

home-stack turns a freshly flashed **Raspberry Pi OS Lite 64-bit** into a small,
maintainable Docker host for home services (Home Assistant, Jellyfin, …), driven
by a single CLI (`hstack`). The design is shaped by a few hard constraints:

- **Single-node appliance.** One Pi, often on an SD card, run by one person. No
  cluster, no orchestrator, no control plane.
- **Idempotent & re-runnable.** `setup` is the unit of work. Running it again
  (e.g. after `git pull`) must converge to the same state and change nothing that
  is already correct.
- **Declarative-ish, file-first.** The desired state lives in one config file +
  a fixed catalog. All runtime artifacts (compose file, Caddyfile, systemd
  units) are *generated*, never hand-edited.
- **Recoverable.** Config and data are separated on disk so backups and restores
  are obvious; the password material is the only thing the user must keep safe.

Non-goals: multi-host, high availability, arbitrary user-supplied images,
zero-trust networking. Those would trade away the simplicity that is the point.

---

## 2. High-level model

```
            ┌──────────────────────── hstack CLI (Node + TS) ────────────────────────┐
            │  cli.ts → commands/* → steps/* → templates/* + util/*                   │
            │  reads:  home-stack.config.json  +  catalog.ts (fixed app registry)     │
            │  writes: compose.yml, Caddyfile, systemd units, dirs (all generated)    │
            └───────────────┬─────────────────────────────────────────────────────────┘
                            │ provisions / converges
                            ▼
   ┌─────────────────────────── Raspberry Pi OS (Debian) ───────────────────────────┐
   │  apt: docker-ce, avahi, restic …      systemd: backup.timer, mdns.service       │
   │                                                                                  │
   │   Docker (project "home-stack")                                                  │
   │   ┌────────── caddy ──────────┐   reverse proxy, per-service TLS + basic_auth    │
   │   │  :80/:443  ── routes ──▶   │──▶ portainer:9000                               │
   │   └───────────────────────────┘──▶ homeassistant:8123                           │
   │                                 └─▶ jellyfin:8096 … (installed catalog apps)     │
   │                                                                                  │
   │   /srv/docker/  compose/ • config/ • appdata/ • backups/   (state on disk)       │
   └──────────────────────────────────────────────────────────────────────────────┘
                            ▲
            LAN clients ────┘  <service>.local  (mDNS)     internet ──▶ <service>.<domain>
```

Two planes:

1. **Control plane** — the `hstack` CLI. Stateless except for the config file.
   It only ever *generates files* and *calls system commands*.
2. **Data plane** — Docker + Caddy + the services, plus systemd timers. These run
   independently of the CLI; you can reboot and everything comes back without the
   CLI being involved.

---

## 3. On-disk layout (the "state")

Everything the stack owns lives under `storage.root` (default `/srv/docker`):

```
/srv/docker/
├── compose/        docker-compose.yml          (GENERATED each run)
├── config/         per-service configuration    (editable; backed up)
│   ├── caddy/Caddyfile                          (GENERATED each run)
│   ├── caddy/.basicauth.{hash,meta}            (derived, cached)
│   ├── homeassistant/configuration.yaml         (SEEDED once, then yours)
│   └── restic/password                          (generated once — keep safe!)
├── appdata/        per-service persistent state  (databases, caches, media)
│   ├── portainer/  caddy/{data,config}/  homeassistant/  jellyfin/{cache,media} …
└── backups/restic/ local restic repository       (default; move off-box ideally)
```

**Why split `config/` and `appdata/`?** It makes the two restore modes trivial:
restore just `config/` to recover settings, or `config/` + `appdata/` for a full
recovery. It also keeps the small, human-meaningful files away from the large,
noisy runtime state.

The repo itself is *not* here — it stays in the user's home dir (see §9).

---

## 4. Code layout

```
src/
├── cli.ts            Commander entrypoint: flags → command functions
├── config.ts         Zod schema, loader, derived ResolvedConfig, persistence helpers
├── catalog.ts        FIXED registry of installable apps (the only "plugin" surface)
│
├── commands/         One file per user-facing verb (orchestration, no system calls)
│   ├── setup.ts        run all steps in order (idempotent converge)
│   ├── install.ts      add/remove catalog apps, then converge
│   ├── service.ts      visibility (local/public) management
│   ├── list.ts status.ts backup.ts restore.ts mdns.ts
│
├── steps/            One file per provisioning concern (the idempotent units)
│   ├── system.ts       apt packages, timezone, avahi
│   ├── storage.ts      ext4 (phase 1) / btrfs (phase 2) under storage.root
│   ├── docker.ts       Docker Engine + compose plugin from Docker apt repo
│   ├── structure.ts    create config/appdata dirs (+ per-app extra dirs)
│   ├── stack.ts        render compose+Caddyfile, seed app config, compose up, reload caddy
│   ├── mdns.ts         install systemd mDNS publisher unit
│   ├── backup.ts       restic password+init, systemd backup service+timer
│   └── clilink.ts      symlink /usr/local/bin/hstack → repo launcher
│
├── templates/        PURE functions: config → string (no side effects)
│   ├── compose.ts      core services + installed catalog apps → docker-compose.yml
│   ├── caddyfile.ts    active services → Caddyfile (TLS, basic_auth, public blocks)
│   ├── homeassistant.ts  seed configuration.yaml (trusted_proxies for Caddy)
│   └── systemd.ts      backup.service/.timer + mdns.service unit text
│
└── util/             Cross-cutting helpers
    ├── exec.ts         execa wrappers: run / capture / ok / hasBin
    ├── fs.ts           idempotent fs: ensureDir, writeFileIdempotent, ensureLine
    ├── system.ts       root/linux guards, user resolution, aptInstall
    ├── auth.ts         resolve bcrypt hash for basic_auth (cached)
    ├── restic.ts       restic env + backup/forget/snapshots helpers
    ├── paths.ts        repoRoot() + how systemd should invoke the CLI
    └── log.ts          tiny colored logger
```

The dependency direction is strict and one-way:

```
cli → commands → steps → (templates, util, config, catalog)
templates → config (+ catalog)        util → config
```

`templates/*` are **pure** (input → string), which makes them trivially testable
and means the "what we generate" logic is decoupled from the "how we apply it"
logic in `steps/*`.

---

## 5. Execution flow

`hstack setup` is the canonical path:

1. `cli.ts` parses flags, calls `setupCommand`.
2. `commands/setup.ts` loads + validates config, resolves the user, then runs the
   steps **in dependency order**: system → storage → docker → structure → stack →
   mdns → backup → clilink.
3. Each `steps/*` function is independently idempotent and uses `util/*` to do
   real work (apt, docker, fs, systemctl).
4. `steps/stack.ts` calls `templates/*` to (re)generate `docker-compose.yml` and
   `Caddyfile` from the current config, writes them only if they changed, then
   `docker compose up -d --remove-orphans` and a graceful `caddy reload`.

`install` / `uninstall` / `service visibility` are *partial* converges: they
mutate the config file (`saveInstalled` / `saveVisibility`), reload it, then run
the subset of steps needed to apply the change (structure + stack + mdns). This
keeps one code path for "make reality match config".

---

## 6. Idempotency model

Idempotency is enforced at the lowest level so every higher level inherits it:

- `writeFileIdempotent` compares content and only writes (and logs) on change,
  returning a `changed` boolean used to decide follow-ups (e.g. reload Caddy or
  `systemctl daemon-reload`).
- `ensureDir`, `ensureLine`, `aptInstall` (only missing pkgs), `aptUpdateDaily`
  (skip if index <24h), and "check-before-act" around systemd/docker.
- Generated artifacts are deterministic given the config, so re-running produces
  byte-identical files → no spurious restarts.
- The one source of nondeterminism (bcrypt salt) is contained: `util/auth.ts`
  caches the hash keyed by a fingerprint of `user:password`, so the Caddyfile
  only changes when the credential actually changes (§8).

---

## 7. The catalog model

Installable apps live in **one fixed registry**, `src/catalog.ts`. Each entry is
an `AppDefinition` with `name`, `upstreamPort`, a `compose(ctx)` builder, and
optional `dirs` / `seed` / `note`. The user's config only stores **which** apps
are installed (`installed: string[]`) and how they're exposed (`visibility`).

From that single list everything is derived automatically: the compose service,
the Caddy route, the mDNS hostname, and the on-disk folders. Adding an app is a
one-entry change with no edits elsewhere.

**Why a curated catalog instead of free-form services?** It keeps the config
tiny and validated (zod rejects unknown names), avoids running arbitrary
untrusted images, and lets the tool guarantee sane defaults (volumes, env, TZ,
trusted-proxy config). Core infrastructure (Caddy + Portainer) is deliberately
*not* in the catalog — it's always present and not user-removable.

---

## 8. Networking, TLS and auth

- **Reverse proxy:** a single Caddy container owns `:80/:443`. Every service is
  reached by Host header, so no per-service port juggling on the LAN.
- **Local discovery:** Avahi advertises `<service>.local` for each active
  service via a long-running systemd unit (`hstack mdns`) that publishes one A
  record per host pointing at the Pi's primary IP. mDNS means **zero router/DNS
  configuration** for LAN use.
- **TLS:** local blocks use Caddy's internal CA (`tls internal`); public blocks
  use automatic Let's Encrypt. Generated per-service in `templates/caddyfile.ts`.
- **Auth:** an optional shared HTTP basic-auth gate. The plaintext password lives
  in the (gitignored) config; Caddy needs **bcrypt**, so `util/auth.ts` derives
  it with `caddy hash-password` (run in the caddy image — no extra dependency)
  and caches it. Home Assistant is intentionally excludable because basic auth
  breaks its app/API/websockets.
- **Visibility (local vs public):** every service is LAN-only by default. Marking
  one `public` adds a second Caddy site on `<name>.<public.baseDomain>` with real
  TLS, while keeping the `.local` block. The CLI cannot open router ports, so it
  is explicit that port-forwarding/tunnels + DNS + auth are the operator's job —
  surfaced as a loud warning, not silent automation.

---

## 9. systemd & "repo stays in place"

Two concerns run on a schedule, independent of the CLI session:

- `hstack-backup.service` + `.timer` — nightly restic backup + retention.
- `hstack-mdns.service` — keeps `<service>.local` advertised.

Their unit files (`templates/systemd.ts`) shell back into **this same CLI** via
the repo's local `tsx` (`util/paths.ts::cliExec`). This gives one source of truth
for backup/mDNS logic instead of duplicating it in shell. The consequence is a
deliberate contract: **the repo must stay where it was set up** (the user's home
dir). `bin/hstack` + the `/usr/local/bin/hstack` symlink resolve the repo via
`readlink -f`, so the global command and the units always point at the real repo.

---

## 10. Storage phases

- **Phase 1 (default):** ext4 under `storage.root`. With `storage.device` empty
  it uses the existing filesystem (the SD card) — no formatting, fully
  self-contained. This is the only phase needed for a basic SD-card setup.
- **Phase 2:** btrfs subvolumes (`appdata`/`config`/`backups`/`compose`) on a
  dedicated device, enabling cheap snapshots. Opt-in; everything above it is
  unchanged. Formatting only ever happens on a device with **no** existing
  filesystem, so data is never silently destroyed.

---

## 11. Technical choices & rationale

| Choice | Why | Trade-off accepted |
|---|---|---|
| **Node + TypeScript** (run via `tsx`, no build step) | The user wanted Node/TS; types catch config/shape bugs; `tsx` lets units and the CLI run the `.ts` directly so there's no compiled artifact to keep in sync. | Needs Node ≥20 on the Pi; slight startup cost vs compiled JS. |
| **Single config file + zod** | One declarative source of truth, validated with clear errors, defaults filled centrally. | Schema changes must stay backward-tolerant. |
| **Fixed catalog, generated compose** | Tiny validated config; safe curated images; one place to add apps; no drift between config and the compose file. | Not arbitrary — adding an app means a code entry (intentional). |
| **Generate compose/Caddyfile/units (never hand-edit)** | Deterministic, diffable, idempotent; the config is the only thing humans touch. | Manual tweaks to generated files are overwritten (by design). |
| **Caddy as the one proxy** | Built-in per-site TLS (internal CA + ACME) and `basic_auth`; clean Host-based routing; trivial to template. | All ingress funnels through one container. |
| **mDNS (Avahi) for `.local`** | Zero-config LAN names; no router/DNS setup. | `.local` is LAN-only and can't be public (hence the separate public domain). |
| **execa wrappers** | Ergonomic, safe arg arrays (no shell injection), good error capture; `ok()` for check-before-act. | A dependency vs raw `child_process`. |
| **Restic + systemd timer** | Dedup + encryption + simple retention; the CLI owns the logic, systemd owns the schedule. | Default repo is on-box; operator should point it off-box. |
| **bcrypt via the caddy image** | Correct hash format with no native/bcrypt npm dep on ARM. | Requires Docker present (true by the time it's used). |
| **Plaintext password in config** | Simplicity; the file is gitignored; hash is derived + cached, never the source of truth. | Plaintext at rest — acceptable for a single-user home appliance, not for shared/multi-tenant. |
| **Idempotent fs primitives** | Re-runs converge with no churn and no needless restarts. | A little extra bookkeeping (content compares, `changed` flags). |

---

## 12. Extending the system

- **New app:** add one `AppDefinition` to `src/catalog.ts`. Routing, mDNS, dirs
  and seeds follow automatically; no other file changes.
- **New provisioning concern:** add a `steps/*.ts` function and call it from
  `commands/setup.ts` in the right order; keep it idempotent via `util/fs.ts`.
- **New generated artifact:** add a pure function in `templates/*` and write it
  with `writeFileIdempotent` from the relevant step.
- **New command:** add a `commands/*.ts` orchestrator and wire it in `cli.ts`.
```
