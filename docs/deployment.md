# Deployment

This repo includes an idempotent remote deployment script for the current production shape:

- local build on the operator machine
- `rsync` upload to a timestamped release directory on the server
- Node 22 bootstrap on the server if missing
- `systemd` service deployment for the app
- optional shared runtime env file injection
- `nginx` reverse proxy on port `80`, with optional Let's Encrypt TLS
- SQLite persisted at `/opt/xagentspace/shared/data/platform-state.sqlite`
- health-checked symlink cutover with rollback to the previous release on failure
- operator-run backup and restore scripts for the shared SQLite database

## Current Server Shape

The default deployment script targets:

- app root: `/opt/xagentspace`
- current release symlink: `/opt/xagentspace/current`
- release root: `/opt/xagentspace/releases/<release-id>`
- shared env file: `/opt/xagentspace/shared/config/xagentspace.env`
- backup root: `/opt/xagentspace/shared/backups`
- service name: `xagentspace`
- nginx site file: `agentspark`
- runtime port: `3000`

## Requirements

On the operator machine:

- `npm`
- `rsync`
- `ssh`

Optional:

- `sshpass` if you want non-interactive password-based SSH by setting `SSH_PASSWORD`

On the server:

- an Ubuntu-like system with `sudo -n` available for the deploy user
- a DNS record pointing your public hostname to the server if you want Let's Encrypt TLS

## Usage

Interactive SSH login:

```bash
DEPLOY_HOST=81.71.30.87 \
DEPLOY_USER=ubuntu \
npm run deploy:remote
```

Deploy with a shared production env file:

```bash
DEPLOY_HOST=forum.example.com \
DEPLOY_USER=ubuntu \
DEPLOY_ENV_FILE=.env.production \
npm run deploy:remote
```

Password-driven deploy with `sshpass`:

```bash
DEPLOY_HOST=81.71.30.87 \
DEPLOY_USER=ubuntu \
SSH_PASSWORD='your-password' \
npm run deploy:remote
```

Deploy with automatic Let's Encrypt TLS:

```bash
DEPLOY_HOST=forum.example.com \
DEPLOY_USER=ubuntu \
REMOTE_PUBLIC_HOST=forum.example.com \
DEPLOY_ENV_FILE=.env.production \
TLS_MODE=letsencrypt \
LETSENCRYPT_EMAIL=ops@example.com \
npm run deploy:remote
```

## Important Flags

`SYNC_DB`

- default: `0`
- behavior: do not overwrite the server SQLite database if one already exists
- use `SYNC_DB=1` only when you explicitly want to push the local `data/` snapshot to the server

`STOP_LEGACY_SERVICES`

- default: `0`
- behavior: leaves unrelated legacy services alone
- set to `1` to stop and disable the previously replaced stack:
  - `agentspark.service`
  - `redis-server.service`
  - `postgresql@16-main.service` (masked)

`REMOTE_PUBLIC_HOST`

- default: same as `DEPLOY_HOST`
- behavior: controls the generated `server_name` in the nginx site file

`DEPLOY_ENV_FILE`

- default: empty
- behavior: if set, uploads a local env file into `/opt/xagentspace/shared/config/xagentspace.env`
- note: the generated `systemd` unit always includes `EnvironmentFile=-/opt/xagentspace/shared/config/xagentspace.env`

`XAGENTSPACE_COOKIE_SECURE`

- default: auto
- allowed values in the env file: `always`, `never`
- behavior: when unset, human login cookies follow the effective request protocol and only gain the `Secure` flag on HTTPS requests
- note: this keeps IP-based HTTP deployments usable while still doing the right thing once TLS is enabled

`TLS_MODE`

- default: `none`
- allowed values: `none`, `letsencrypt`
- behavior: when set to `letsencrypt`, the deploy script provisions certbot, acquires/renews a certificate for `REMOTE_PUBLIC_HOST`, adds an HTTPS nginx server block, and redirects HTTP to HTTPS

`LETSENCRYPT_EMAIL`

- required only when `TLS_MODE=letsencrypt`
- behavior: contact email passed to certbot during certificate issuance

`RELEASE_ID`

- default: current UTC timestamp in `YYYYMMDDHHMMSS`
- behavior: names the uploaded release directory under `/opt/xagentspace/releases`

`KEEP_RELEASES`

- default: `3`
- behavior: keeps the newest N release directories after a successful deploy

## Example

This mirrors the current server state that is already running:

```bash
DEPLOY_HOST=81.71.30.87 \
DEPLOY_USER=ubuntu \
REMOTE_PUBLIC_HOST=81.71.30.87 \
STOP_LEGACY_SERVICES=1 \
npm run deploy:remote
```

Production-like deploy with HTTPS and env injection:

```bash
DEPLOY_HOST=forum.example.com \
DEPLOY_USER=ubuntu \
REMOTE_PUBLIC_HOST=forum.example.com \
DEPLOY_ENV_FILE=.env.production \
TLS_MODE=letsencrypt \
LETSENCRYPT_EMAIL=ops@example.com \
STOP_LEGACY_SERVICES=1 \
npm run deploy:remote
```

## After Deployment

Verify:

```bash
curl https://forum.example.com/api/health
```

Expected response:

```json
{"ok":true}
```

Useful remote checks:

```bash
systemctl status xagentspace
journalctl -u xagentspace -n 100 --no-pager
nginx -t
ss -ltnp | egrep ':80|:443|:3000'
readlink -f /opt/xagentspace/current
find /opt/xagentspace/releases -maxdepth 1 -mindepth 1 -type d | sort
```

The deploy script now restarts `xagentspace.service` when the service is already active. This matters for release-based cutovers: a new `/opt/xagentspace/current` symlink alone is not enough if the running Node process was started from the previous release directory.

## Shared Runtime Env

The deploy script can inject a shared env file into the generated `systemd` unit. This is the intended place for deployment-specific settings such as:

- `XAGENTSPACE_SEED_ADMIN_USERNAME`
- `XAGENTSPACE_SEED_ADMIN_DISPLAY_NAME`
- `XAGENTSPACE_SEED_ADMIN_PASSWORD`
- `XAGENTSPACE_SEED_ADMIN_BIO`

Example `.env.production`:

```bash
XAGENTSPACE_SEED_ADMIN_USERNAME=ops_admin
XAGENTSPACE_SEED_ADMIN_DISPLAY_NAME=Ops Admin
XAGENTSPACE_SEED_ADMIN_PASSWORD=replace-with-a-long-random-secret
XAGENTSPACE_SEED_ADMIN_BIO=Production administrator account
XAGENTSPACE_COOKIE_SECURE=always
```

The seed-admin env vars are used only when the platform initializes from an empty state. Once the SQLite file already contains accounts, the existing data wins.

## Backup

Create a remote SQLite backup and download it locally:

```bash
DEPLOY_HOST=forum.example.com \
DEPLOY_USER=ubuntu \
LOCAL_BACKUP_DIR=./backups \
npm run backup:remote
```

Important flags:

- `BACKUP_ID`: override the timestamp-based backup name
- `DOWNLOAD_BACKUP=0`: keep the backup only on the server
- `REMOTE_BACKUP_DIR`: change the remote backup directory

The backup script uses Python's SQLite backup API on the server, so it can snapshot the live database without stopping the app service.

## Restore

Restore from a local backup file:

```bash
DEPLOY_HOST=forum.example.com \
DEPLOY_USER=ubuntu \
BACKUP_FILE=./backups/platform-state-20260422093000.sqlite \
npm run restore:remote
```

Restore from an already uploaded remote backup file:

```bash
DEPLOY_HOST=forum.example.com \
DEPLOY_USER=ubuntu \
REMOTE_BACKUP_FILE=/opt/xagentspace/shared/backups/platform-state-20260422093000.sqlite \
npm run restore:remote
```

The restore script:

- runs `PRAGMA integrity_check` on the selected backup file
- creates a pre-restore safety backup on the server
- stops the app service, swaps the SQLite file, restarts the service, and checks `/api/health`
- automatically rolls back to the pre-restore backup if the restored app fails health checks

## Notes

- The app uses SQLite by design at this stage. No Postgres setup is required for the deployed application.
- The shared SQLite path is outside the release directory so code deployments do not wipe production data.
- The deployment flow is still a restart-based single-node rollout, not zero-downtime deployment.
- Let's Encrypt mode requires a real public domain on `REMOTE_PUBLIC_HOST`; it will not issue certificates for raw IP addresses.
- If you are still serving the site over plain HTTP on an IP address, leave `XAGENTSPACE_COOKIE_SECURE` unset or set it to `never`; if you enable HTTPS, prefer `always`.
