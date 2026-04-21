#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/xagentspace}"
REMOTE_SERVICE_NAME="${REMOTE_SERVICE_NAME:-xagentspace}"
REMOTE_SITE_NAME="${REMOTE_SITE_NAME:-agentspark}"
REMOTE_RUNTIME_PORT="${REMOTE_RUNTIME_PORT:-3000}"
REMOTE_PUBLIC_HOST="${REMOTE_PUBLIC_HOST:-${DEPLOY_HOST}}"
SYNC_DB="${SYNC_DB:-0}"
STOP_LEGACY_SERVICES="${STOP_LEGACY_SERVICES:-0}"

if [[ -z "${DEPLOY_HOST}" ]]; then
  echo "DEPLOY_HOST is required" >&2
  exit 1
fi

REMOTE_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_OPTS=(-p "${DEPLOY_PORT}" -o StrictHostKeyChecking=no)

run_ssh() {
  if [[ -n "${SSH_PASSWORD:-}" ]]; then
    if ! command -v sshpass >/dev/null 2>&1; then
      echo "SSH_PASSWORD is set but sshpass is not installed" >&2
      exit 1
    fi
    SSHPASS="${SSH_PASSWORD}" sshpass -e ssh "${SSH_OPTS[@]}" "${REMOTE_TARGET}" "$@"
    return
  fi

  ssh "${SSH_OPTS[@]}" "${REMOTE_TARGET}" "$@"
}

run_rsync() {
  local remote_shell
  remote_shell="ssh ${SSH_OPTS[*]}"
  if [[ -n "${SSH_PASSWORD:-}" ]]; then
    if ! command -v sshpass >/dev/null 2>&1; then
      echo "SSH_PASSWORD is set but sshpass is not installed" >&2
      exit 1
    fi
    remote_shell="sshpass -e ${remote_shell}"
    SSHPASS="${SSH_PASSWORD}" rsync -az --delete -e "${remote_shell}" "$@"
    return
  fi

  rsync -az --delete -e "${remote_shell}" "$@"
}

echo "Building local production bundle..."
cd "${ROOT_DIR}"
npm run build

echo "Preparing remote directories on ${REMOTE_TARGET}..."
run_ssh "
  set -euo pipefail
  sudo -n mkdir -p '${REMOTE_APP_DIR}/releases/current' '${REMOTE_APP_DIR}/shared/data'
  sudo -n chown -R '${DEPLOY_USER}:${DEPLOY_USER}' '${REMOTE_APP_DIR}'
"

echo "Syncing application bundle..."
run_rsync \
  "${ROOT_DIR}/dist" \
  "${ROOT_DIR}/data" \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${REMOTE_TARGET}:${REMOTE_APP_DIR}/releases/current/"

echo "Provisioning runtime and service..."
run_ssh "
  set -euo pipefail

  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo -n apt-get install -y nodejs
  fi

  cd '${REMOTE_APP_DIR}/releases/current'
  npm ci --omit=dev

  if [[ '${SYNC_DB}' == '1' ]]; then
    cp -f '${REMOTE_APP_DIR}/releases/current'/data/platform-state.sqlite* '${REMOTE_APP_DIR}/shared/data/' 2>/dev/null || true
    cp -f '${REMOTE_APP_DIR}/releases/current/data/platform-state.json' '${REMOTE_APP_DIR}/shared/data/' 2>/dev/null || true
  elif [[ ! -f '${REMOTE_APP_DIR}/shared/data/platform-state.sqlite' ]]; then
    cp -f '${REMOTE_APP_DIR}/releases/current'/data/platform-state.sqlite* '${REMOTE_APP_DIR}/shared/data/' 2>/dev/null || true
    cp -f '${REMOTE_APP_DIR}/releases/current/data/platform-state.json' '${REMOTE_APP_DIR}/shared/data/' 2>/dev/null || true
  fi

  ln -sfn '${REMOTE_APP_DIR}/releases/current' '${REMOTE_APP_DIR}/current'

  sudo -n tee '/etc/systemd/system/${REMOTE_SERVICE_NAME}.service' >/dev/null <<'EOF'
[Unit]
Description=XAgentSpace Node service
After=network.target nginx.service

[Service]
Type=simple
User=${DEPLOY_USER}
Group=${DEPLOY_USER}
WorkingDirectory=${REMOTE_APP_DIR}/current
Environment=NODE_ENV=production
Environment=PORT=${REMOTE_RUNTIME_PORT}
Environment=XAGENTSPACE_STORAGE=sqlite
Environment=XAGENTSPACE_SQLITE_FILE=${REMOTE_APP_DIR}/shared/data/platform-state.sqlite
ExecStart=/usr/bin/node ${REMOTE_APP_DIR}/current/dist/server/index.cjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo -n tee '/etc/nginx/sites-available/${REMOTE_SITE_NAME}' >/dev/null <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${REMOTE_PUBLIC_HOST} _;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:${REMOTE_RUNTIME_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_read_timeout 300;
    }
}
EOF

  sudo -n mkdir -p /etc/nginx/sites-enabled
  sudo -n ln -sfn '/etc/nginx/sites-available/${REMOTE_SITE_NAME}' '/etc/nginx/sites-enabled/${REMOTE_SITE_NAME}'

  if [[ '${STOP_LEGACY_SERVICES}' == '1' ]]; then
    sudo -n systemctl disable --now agentspark.service redis-server.service || true
    sudo -n systemctl mask --now postgresql@16-main.service || true
  fi

  sudo -n systemctl daemon-reload
  sudo -n systemctl enable --now '${REMOTE_SERVICE_NAME}.service'
  sudo -n nginx -t
  sudo -n nginx -s reload

  systemctl is-active '${REMOTE_SERVICE_NAME}.service'
  curl -fsS 'http://127.0.0.1:${REMOTE_RUNTIME_PORT}/api/health'
"

echo
echo "Deployment complete."
echo "Public URL: http://${DEPLOY_HOST}"
echo "Health URL: http://${DEPLOY_HOST}/api/health"
