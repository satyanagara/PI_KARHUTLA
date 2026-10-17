#!/usr/bin/env bash
# Deploy ke server target sebagai container Docker:
#   1. kirim kode sumber + data/ ke ~/pemantau-karhutla (tanpa node_modules, dist, secrets, .env*)
#   2. tulis .env di server berisi FIRMS_MAP_KEY saja
#   3. build image di server (x86_64) lalu ganti container lama
# Kredensial SSH dibaca dari secrets/server.txt bagian [target]; kata sandi tidak pernah ditampilkan.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/secrets/server.txt"
APP=pemantau-karhutla
REMOTE_DIR="~/$APP"
PORT_APP="${PORT_APP:-8787}"

get() { awk -v s="[target]" -v k="$1" '$0==s{f=1;next} /^\[/{f=0} f && $1==k {sub(/^[^=]*=[ \t]*/,""); print; exit}' "$CFG"; }
HOST=$(get host); USER_=$(get user); PORT=$(get port); PORT=${PORT:-22}
export SSHPASS="$(get password)"
SSH_OPTS="-p $PORT -o StrictHostKeyChecking=accept-new -o ConnectTimeout=60 -o ServerAliveInterval=15 -o PubkeyAuthentication=no"
remote() { sshpass -e ssh $SSH_OPTS "$USER_@$HOST" "$@"; }

KEY=$(sed -n 's/^FIRMS_MAP_KEY=//p' "$ROOT/.env.local")
[ -n "$KEY" ] || { echo "FIRMS_MAP_KEY tidak ada di .env.local"; exit 1; }

echo "==> Mengirim kode ke $USER_@$HOST:$REMOTE_DIR"
remote "mkdir -p $REMOTE_DIR"
sshpass -e rsync -az --delete -e "ssh $SSH_OPTS" \
  --exclude node_modules --exclude dist --exclude secrets --exclude '.env*' \
  --exclude .remember --exclude .playwright-mcp --exclude .git \
  "$ROOT/" "$USER_@$HOST:$REMOTE_DIR/"

echo "==> Menulis .env server (hanya FIRMS_MAP_KEY)"
printf 'FIRMS_MAP_KEY=%s\nTRUST_PROXY=1\n' "$KEY" | remote "umask 077 && cat > $REMOTE_DIR/.env"

echo "==> Build image dan jalankan container"
remote "cd $REMOTE_DIR && docker build -q -t $APP:latest -f Containerfile . && \
  (docker rm -f $APP >/dev/null 2>&1 || true) && \
  docker run -d --name $APP --restart unless-stopped \
    -p $PORT_APP:8787 --env-file .env --memory 768m -v $APP-cache:/app/.cache \
    --health-cmd 'wget -qO- http://127.0.0.1:8787/api/health || exit 1' --health-interval 30s \
    $APP:latest >/dev/null && \
  docker image prune -f >/dev/null && \
  sleep 4 && docker ps --filter name=$APP --format '{{.Names}}  {{.Status}}  {{.Ports}}' && docker logs --tail 5 $APP"
