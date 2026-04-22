#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/xagentspace}"
REMOTE_SQLITE_FILE="${REMOTE_SQLITE_FILE:-${REMOTE_APP_DIR}/shared/data/platform-state.sqlite}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-${REMOTE_APP_DIR}/shared/backups}"
BACKUP_ID="${BACKUP_ID:-$(date -u +%Y%m%d%H%M%S)}"
DOWNLOAD_BACKUP="${DOWNLOAD_BACKUP:-1}"
LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-${ROOT_DIR}/backups}"

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
    SSHPASS="${SSH_PASSWORD}" rsync -az -e "${remote_shell}" "$@"
    return
  fi

  rsync -az -e "${remote_shell}" "$@"
}

REMOTE_BACKUP_FILE="${REMOTE_BACKUP_DIR}/platform-state-${BACKUP_ID}.sqlite"
REMOTE_SUMS_FILE="${REMOTE_BACKUP_DIR}/platform-state-${BACKUP_ID}.sha256"

echo "Creating remote SQLite backup ${REMOTE_BACKUP_FILE}..."
run_ssh "
  set -euo pipefail
  mkdir -p '${REMOTE_BACKUP_DIR}'
  python3 - '${REMOTE_SQLITE_FILE}' '${REMOTE_BACKUP_FILE}' <<'PY'
import pathlib
import sqlite3
import sys

source_path = pathlib.Path(sys.argv[1])
target_path = pathlib.Path(sys.argv[2])

if not source_path.exists():
    raise SystemExit(f'SQLite file not found: {source_path}')

target_path.parent.mkdir(parents=True, exist_ok=True)

source = sqlite3.connect(f'file:{source_path}?mode=ro', uri=True)
target = sqlite3.connect(target_path)
source.backup(target)
target.close()
source.close()
PY
  sha256sum '${REMOTE_BACKUP_FILE}' > '${REMOTE_SUMS_FILE}'
"

if [[ "${DOWNLOAD_BACKUP}" == "1" ]]; then
  mkdir -p "${LOCAL_BACKUP_DIR}"
  echo "Downloading backup to ${LOCAL_BACKUP_DIR}..."
  run_rsync \
    "${REMOTE_TARGET}:${REMOTE_BACKUP_FILE}" \
    "${REMOTE_TARGET}:${REMOTE_SUMS_FILE}" \
    "${LOCAL_BACKUP_DIR}/"
fi

echo
echo "Backup complete."
echo "Remote SQLite backup: ${REMOTE_BACKUP_FILE}"
if [[ "${DOWNLOAD_BACKUP}" == "1" ]]; then
  echo "Local backup dir: ${LOCAL_BACKUP_DIR}"
fi
