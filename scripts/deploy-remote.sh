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
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-}"
TLS_MODE="${TLS_MODE:-none}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
SYNC_DB="${SYNC_DB:-0}"
STOP_LEGACY_SERVICES="${STOP_LEGACY_SERVICES:-0}"
REMOTE_RELEASES_DIR="${REMOTE_APP_DIR}/releases"
REMOTE_RELEASE_DIR="${REMOTE_RELEASES_DIR}/${RELEASE_ID}"
REMOTE_SHARED_CONFIG_DIR="${REMOTE_APP_DIR}/shared/config"
REMOTE_SHARED_BACKUP_DIR="${REMOTE_APP_DIR}/shared/backups"
REMOTE_ENV_FILE="${REMOTE_SHARED_CONFIG_DIR}/xagentspace.env"

if [[ -z "${DEPLOY_HOST}" ]]; then
  echo "DEPLOY_HOST is required" >&2
  exit 1
fi

if [[ "${TLS_MODE}" != "none" && "${TLS_MODE}" != "letsencrypt" ]]; then
  echo "TLS_MODE must be either 'none' or 'letsencrypt'" >&2
  exit 1
fi

if [[ "${TLS_MODE}" == "letsencrypt" && -z "${LETSENCRYPT_EMAIL}" ]]; then
  echo "LETSENCRYPT_EMAIL is required when TLS_MODE=letsencrypt" >&2
  exit 1
fi

if [[ -n "${DEPLOY_ENV_FILE}" && ! -f "${DEPLOY_ENV_FILE}" ]]; then
  echo "DEPLOY_ENV_FILE does not exist: ${DEPLOY_ENV_FILE}" >&2
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
  sudo -n mkdir -p '${REMOTE_RELEASE_DIR}' '${REMOTE_APP_DIR}/shared/data' '${REMOTE_SHARED_CONFIG_DIR}' '${REMOTE_SHARED_BACKUP_DIR}'
  sudo -n chown -R '${DEPLOY_USER}:${DEPLOY_USER}' '${REMOTE_APP_DIR}'
"

if [[ -n "${DEPLOY_ENV_FILE}" ]]; then
  echo "Syncing shared environment file..."
  run_rsync "${DEPLOY_ENV_FILE}" "${REMOTE_TARGET}:${REMOTE_ENV_FILE}"
fi

echo "Syncing application bundle to release ${RELEASE_ID}..."
run_rsync \
  "${ROOT_DIR}/dist" \
  "${ROOT_DIR}/data" \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${REMOTE_TARGET}:${REMOTE_RELEASE_DIR}/"

echo "Provisioning runtime and service..."
run_ssh "
  set -euo pipefail

  PREVIOUS_TARGET=''
  if [[ -L '${REMOTE_APP_DIR}/current' ]]; then
    PREVIOUS_TARGET=\"\$(readlink -f '${REMOTE_APP_DIR}/current' || true)\"
  fi

  if ! command -v curl >/dev/null 2>&1; then
    sudo -n apt-get update
    sudo -n apt-get install -y curl
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    sudo -n apt-get update
    sudo -n apt-get install -y python3
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    sudo -n apt-get update
    sudo -n apt-get install -y nginx
  fi

  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo -n apt-get install -y nodejs
  fi

  write_http_nginx_config() {
    sudo -n tee '/etc/nginx/sites-available/${REMOTE_SITE_NAME}' >/dev/null <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${REMOTE_PUBLIC_HOST} _;

    client_max_body_size 20m;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:${REMOTE_RUNTIME_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_read_timeout 300;
    }
}
EOF
  }

  write_https_nginx_config() {
    sudo -n tee '/etc/nginx/sites-available/${REMOTE_SITE_NAME}' >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name ${REMOTE_PUBLIC_HOST};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${REMOTE_PUBLIC_HOST};

    ssl_certificate /etc/letsencrypt/live/${REMOTE_PUBLIC_HOST}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${REMOTE_PUBLIC_HOST}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:${REMOTE_RUNTIME_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_read_timeout 300;
    }
}
EOF
  }

  cd '${REMOTE_RELEASE_DIR}'
  npm ci --omit=dev

  if [[ '${SYNC_DB}' == '1' ]]; then
    cp -f '${REMOTE_RELEASE_DIR}'/data/platform-state.sqlite* '${REMOTE_APP_DIR}/shared/data/' 2>/dev/null || true
    cp -f '${REMOTE_RELEASE_DIR}/data/platform-state.json' '${REMOTE_APP_DIR}/shared/data/' 2>/dev/null || true
  elif [[ ! -f '${REMOTE_APP_DIR}/shared/data/platform-state.sqlite' ]]; then
    cp -f '${REMOTE_RELEASE_DIR}'/data/platform-state.sqlite* '${REMOTE_APP_DIR}/shared/data/' 2>/dev/null || true
    cp -f '${REMOTE_RELEASE_DIR}/data/platform-state.json' '${REMOTE_APP_DIR}/shared/data/' 2>/dev/null || true
  fi

  ln -sfn '${REMOTE_RELEASE_DIR}' '${REMOTE_APP_DIR}/current'

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
EnvironmentFile=-${REMOTE_ENV_FILE}
ExecStart=/usr/bin/node ${REMOTE_APP_DIR}/current/dist/server/index.cjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo -n mkdir -p /etc/nginx/sites-enabled /var/www/certbot
  sudo -n rm -f /etc/nginx/sites-enabled/default
  sudo -n rm -f /etc/nginx/sites-available/default
  write_http_nginx_config
  sudo -n ln -sfn '/etc/nginx/sites-available/${REMOTE_SITE_NAME}' '/etc/nginx/sites-enabled/${REMOTE_SITE_NAME}'

  if [[ '${STOP_LEGACY_SERVICES}' == '1' ]]; then
    sudo -n systemctl disable --now agentspark.service redis-server.service || true
    sudo -n systemctl mask --now postgresql@16-main.service || true
  fi

  sudo -n systemctl daemon-reload
  if sudo -n systemctl is-active --quiet '${REMOTE_SERVICE_NAME}.service'; then
    sudo -n systemctl restart '${REMOTE_SERVICE_NAME}.service'
  else
    sudo -n systemctl enable --now '${REMOTE_SERVICE_NAME}.service'
  fi
  sudo -n nginx -t
  sudo -n nginx -s reload

  if [[ '${TLS_MODE}' == 'letsencrypt' ]]; then
    if ! command -v certbot >/dev/null 2>&1; then
      sudo -n apt-get update
      sudo -n apt-get install -y certbot
    fi

    sudo -n certbot certonly \
      --non-interactive \
      --agree-tos \
      --email '${LETSENCRYPT_EMAIL}' \
      --webroot \
      --webroot-path /var/www/certbot \
      --domain '${REMOTE_PUBLIC_HOST}' \
      --keep-until-expiring

    write_https_nginx_config
    sudo -n nginx -t
    sudo -n nginx -s reload
    sudo -n systemctl enable --now certbot.timer || true
  fi

  HEALTH_OK='0'
  for _attempt in \$(seq 1 20); do
    if systemctl is-active --quiet '${REMOTE_SERVICE_NAME}.service' && curl -fsS 'http://127.0.0.1:${REMOTE_RUNTIME_PORT}/api/health' >/dev/null; then
      HEALTH_OK='1'
      break
    fi
    sleep 2
  done

  if [[ \"\${HEALTH_OK}\" != '1' ]]; then
    echo 'New release failed health checks; attempting rollback.' >&2
    if [[ -n \"\${PREVIOUS_TARGET}\" && -d \"\${PREVIOUS_TARGET}\" ]]; then
      ln -sfn \"\${PREVIOUS_TARGET}\" '${REMOTE_APP_DIR}/current'
      sudo -n systemctl restart '${REMOTE_SERVICE_NAME}.service' || true
      sleep 2
      curl -fsS 'http://127.0.0.1:${REMOTE_RUNTIME_PORT}/api/health' >/dev/null || true
    fi
    exit 1
  fi

  mapfile -t RELEASE_DIRS < <(find '${REMOTE_RELEASES_DIR}' -mindepth 1 -maxdepth 1 -type d | sort -r)
  if (( \${#RELEASE_DIRS[@]} > ${KEEP_RELEASES} )); then
    for OLD_RELEASE in \"\${RELEASE_DIRS[@]:${KEEP_RELEASES}}\"; do
      if [[ \"\${OLD_RELEASE}\" != \"\${PREVIOUS_TARGET}\" ]]; then
        rm -rf \"\${OLD_RELEASE}\"
      fi
    done
  fi
"

echo
echo "Deployment complete."
echo "Release ID: ${RELEASE_ID}"
if [[ "${TLS_MODE}" == "letsencrypt" ]]; then
  PUBLIC_SCHEME='https'
else
  PUBLIC_SCHEME='http'
fi
echo "Public URL: ${PUBLIC_SCHEME}://${REMOTE_PUBLIC_HOST}"
echo "Health URL: ${PUBLIC_SCHEME}://${REMOTE_PUBLIC_HOST}/api/health"
