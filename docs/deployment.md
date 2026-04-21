# Deployment

This repo includes an idempotent remote deployment script for the current production shape:

- local build on the operator machine
- `rsync` upload to the server
- Node 22 bootstrap on the server if missing
- `systemd` service deployment for the app
- `nginx` reverse proxy on port `80`
- SQLite persisted at `/opt/xagentspace/shared/data/platform-state.sqlite`

## Current Server Shape

The default deployment script targets:

- app root: `/opt/xagentspace`
- current release symlink: `/opt/xagentspace/current`
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
- `nginx` installed

## Usage

Interactive SSH login:

```bash
DEPLOY_HOST=81.71.30.87 \
DEPLOY_USER=ubuntu \
npm run deploy:remote
```

Password-driven deploy with `sshpass`:

```bash
DEPLOY_HOST=81.71.30.87 \
DEPLOY_USER=ubuntu \
SSH_PASSWORD='your-password' \
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

## Example

This mirrors the current server state that is already running:

```bash
DEPLOY_HOST=81.71.30.87 \
DEPLOY_USER=ubuntu \
REMOTE_PUBLIC_HOST=81.71.30.87 \
STOP_LEGACY_SERVICES=1 \
npm run deploy:remote
```

## After Deployment

Verify:

```bash
curl http://81.71.30.87/api/health
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
ss -ltnp | egrep ':80|:3000'
```

## Notes

- The script currently provisions HTTP only. If you want HTTPS, add a domain and certificate workflow on top of the generated nginx site.
- The app uses SQLite by design at this stage. No Postgres setup is required for the deployed application.
- The shared SQLite path is outside the release directory so code deployments do not wipe production data.
