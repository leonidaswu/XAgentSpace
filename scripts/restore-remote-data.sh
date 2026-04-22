#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/xagentspace}"
REMOTE_SERVICE_NAME="${REMOTE_SERVICE_NAME:-xagentspace}"
REMOTE_RUNTIME_PORT="${REMOTE_RUNTIME_PORT:-3000}"
REMOTE_SQLITE_FILE="${REMOTE_SQLITE_FILE:-${REMOTE_APP_DIR}/shared/data/platform-state.sqlite}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-${REMOTE_APP_DIR}/shared/backups}"
REMOTE_RESTORE_DIR="${REMOTE_RESTORE_DIR:-${REMOTE_APP_DIR}/shared/restore}"
BACKUP_FILE="${BACKUP_FILE:-}"
REMOTE_BACKUP_FILE="${REMOTE_BACKUP_FILE:-}"
RESTORE_ID="${RESTORE_ID:-$(date -u +%Y%m%d%H%M%S)}"

if [[ -z "${DEPLOY_HOST}" ]]; then
  echo "DEPLOY_HOST is required" >&2
  exit 1
fi

if [[ -z "${BACKUP_FILE}" && -z "${REMOTE_BACKUP_FILE}" ]]; then
  echo "BACKUP_FILE or REMOTE_BACKUP_FILE is required" >&2
  exit 1
fi

if [[ -n "${BACKUP_FILE}" && ! -f "${BACKUP_FILE}" ]]; then
  echo "BACKUP_FILE does not exist: ${BACKUP_FILE}" >&2
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
    SSHPASS="${SSH_PASSWORD}" rsync -az -e "${remote_shell}" "$@"
    return
  fi

  rsync -az -e "${remote_shell}" "$@"
}

REMOTE_UPLOAD_FILE="${REMOTE_RESTORE_DIR}/platform-state-restore-${RESTORE_ID}.sqlite"
if [[ -n "${BACKUP_FILE}" ]]; then
  echo "Uploading restore source to ${REMOTE_UPLOAD_FILE}..."
  run_ssh "mkdir -p '${REMOTE_RESTORE_DIR}'"
  run_rsync "${BACKUP_FILE}" "${REMOTE_TARGET}:${REMOTE_UPLOAD_FILE}"
  RESTORE_SOURCE_REMOTE="${REMOTE_UPLOAD_FILE}"
else
  RESTORE_SOURCE_REMOTE="${REMOTE_BACKUP_FILE}"
fi

PRE_RESTORE_BACKUP="${REMOTE_BACKUP_DIR}/pre-restore-${RESTORE_ID}.sqlite"

echo "Restoring remote SQLite database from ${RESTORE_SOURCE_REMOTE}..."
run_ssh "
  set -euo pipefail
  mkdir -p '${REMOTE_BACKUP_DIR}' '${REMOTE_RESTORE_DIR}'

  python3 - '${RESTORE_SOURCE_REMOTE}' <<'PY'
import pathlib
import sqlite3
import sys

source_path = pathlib.Path(sys.argv[1])
if not source_path.exists():
    raise SystemExit(f'Restore source not found: {source_path}')

connection = sqlite3.connect(source_path)
result = connection.execute('PRAGMA integrity_check').fetchone()
connection.close()

if not result or result[0].lower() != 'ok':
    raise SystemExit(f'SQLite integrity_check failed for {source_path}: {result}')
PY

  if [[ -f '${REMOTE_SQLITE_FILE}' ]]; then
    python3 - '${REMOTE_SQLITE_FILE}' '${PRE_RESTORE_BACKUP}' <<'PY'
import pathlib
import sqlite3
import sys

source_path = pathlib.Path(sys.argv[1])
target_path = pathlib.Path(sys.argv[2])

source = sqlite3.connect(f'file:{source_path}?mode=ro', uri=True)
target = sqlite3.connect(target_path)
source.backup(target)
target.close()
source.close()
PY
  fi

  sudo -n systemctl stop '${REMOTE_SERVICE_NAME}'
  cp -f '${RESTORE_SOURCE_REMOTE}' '${REMOTE_SQLITE_FILE}'
  chown '${DEPLOY_USER}:${DEPLOY_USER}' '${REMOTE_SQLITE_FILE}'
  sudo -n systemctl start '${REMOTE_SERVICE_NAME}'

  HEALTH_OK='0'
  for _attempt in \$(seq 1 20); do
    if systemctl is-active --quiet '${REMOTE_SERVICE_NAME}' && curl -fsS 'http://127.0.0.1:${REMOTE_RUNTIME_PORT}/api/health' >/dev/null; then
      HEALTH_OK='1'
      break
    fi
    sleep 2
  done

  if [[ \"\${HEALTH_OK}\" != '1' ]]; then
    echo 'Restore failed health checks; rolling back database file.' >&2
    if [[ -f '${PRE_RESTORE_BACKUP}' ]]; then
      cp -f '${PRE_RESTORE_BACKUP}' '${REMOTE_SQLITE_FILE}'
      chown '${DEPLOY_USER}:${DEPLOY_USER}' '${REMOTE_SQLITE_FILE}'
      sudo -n systemctl restart '${REMOTE_SERVICE_NAME}' || true
    fi
    exit 1
  fi
"

echo
echo "Restore complete."
echo "Restore source: ${RESTORE_SOURCE_REMOTE}"
echo "Pre-restore backup: ${PRE_RESTORE_BACKUP}"
