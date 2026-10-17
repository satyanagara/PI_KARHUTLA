#!/usr/bin/env bash
# Deploy ke server aplikasi lewat git:
#   1. lokal : semua perubahan harus sudah di-commit (atau beri PESAN="..." untuk add + commit otomatis), lalu push
#   2. server: git pull --ff-only di ~/pemantau-karhutla (di-clone sekali bila belum), cek commit sama dengan lokal
#   3. server: tulis .env (hanya FIRMS_MAP_KEY), build image, ganti container
# Kredensial SSH dibaca dari secrets/server.txt bagian [target]; kata sandi tidak pernah ditampilkan.
#
#   npm run deploy                         # bila semua sudah di-commit
#   PESAN="fix: ..." npm run deploy        # add + commit + push + deploy sekaligus
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/secrets/server.txt"
APP=pemantau-karhutla
REMOTE_DIR="~/$APP"
PORT_APP="${PORT_APP:-8787}"
BRANCH=main
REPO_URL="$(git -C "$ROOT" remote get-url origin)"

get() { awk -v s="[target]" -v k="$1" '$0==s{f=1;next} /^\[/{f=0} f && $1==k {sub(/^[^=]*=[ \t]*/,""); print; exit}' "$CFG"; }
HOST=$(get host); USER_=$(get user); PORT=$(get port); PORT=${PORT:-22}
export SSHPASS="$(get password)"
SSH_OPTS="-p $PORT -o StrictHostKeyChecking=accept-new -o ConnectTimeout=60 -o ServerAliveInterval=15 -o PubkeyAuthentication=no"
remote() { sshpass -e ssh $SSH_OPTS "$USER_@$HOST" "$@"; }

KEY=$(sed -n 's/^FIRMS_MAP_KEY=//p' "$ROOT/.env.local")
[ -n "$KEY" ] || { echo "FIRMS_MAP_KEY tidak ada di .env.local"; exit 1; }

cd "$ROOT"
echo "==> Git lokal"
[ "$(git branch --show-current)" = "$BRANCH" ] || { echo "Deploy hanya dari branch $BRANCH."; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  if [ -n "${PESAN:-}" ]; then
    git add -A
    git commit -q -m "$PESAN"
  else
    git status --short
    echo "Ada perubahan yang belum di-commit. Commit dulu, atau jalankan: PESAN=\"pesan commit\" npm run deploy"
    exit 1
  fi
fi
# Pengaman: berkas rahasia tidak boleh ikut terlacak git.
if git ls-files | grep -qE '^(secrets/|\.env($|\.))'; then
  echo "Berkas rahasia terlacak git (secrets/ atau .env*). Deploy dibatalkan."; exit 1
fi
git push -q origin "$BRANCH"
COMMIT=$(git rev-parse HEAD)
echo "    commit $(git log -1 --format='%h %s')"

echo "==> Git di server: pull $BRANCH"
remote "set -e
if [ ! -d $REMOTE_DIR/.git ]; then
  # Sekali saja: ganti folder hasil rsync dengan clone, pertahankan .env.
  TMP=\$(mktemp -d)
  [ -f $REMOTE_DIR/.env ] && cp $REMOTE_DIR/.env \$TMP/.env
  git clone -q --branch $BRANCH $REPO_URL $REMOTE_DIR.baru
  [ -f \$TMP/.env ] && cp \$TMP/.env $REMOTE_DIR.baru/.env
  rm -rf $REMOTE_DIR \$TMP
  mv $REMOTE_DIR.baru $REMOTE_DIR
fi
cd $REMOTE_DIR
git fetch -q origin $BRANCH
git checkout -q $BRANCH
git pull -q --ff-only origin $BRANCH
[ \"\$(git rev-parse HEAD)\" = $COMMIT ] || { echo \"Commit server berbeda dengan lokal\"; exit 1; }
echo \"    server di \$(git log -1 --format='%h %s')\""

echo "==> Menulis .env server (hanya FIRMS_MAP_KEY)"
printf 'FIRMS_MAP_KEY=%s\nTRUST_PROXY=1\n' "$KEY" | remote "umask 077 && cat > $REMOTE_DIR/.env"

echo "==> Build image dan jalankan container"
# Build diulang hingga 3 kali: koneksi server ke Docker Hub kadang gagal sesaat (rute IPv6).
remote "cd $REMOTE_DIR && for i in 1 2 3; do docker build -q -t $APP:latest -f Containerfile . && break; [ \$i = 3 ] && exit 1; sleep 10; done && \
  (docker rm -f $APP >/dev/null 2>&1 || true) && \
  docker run -d --name $APP --restart unless-stopped \
    -p 127.0.0.1:$PORT_APP:8787 --env-file .env --memory 768m -v $APP-cache:/app/.cache \
    --health-cmd 'wget -qO- http://127.0.0.1:8787/api/health || exit 1' --health-interval 30s \
    $APP:latest >/dev/null && \
  docker image prune -f >/dev/null && \
  sleep 4 && docker ps --filter name=$APP --format '{{.Names}}  {{.Status}}  {{.Ports}}' && docker logs --tail 3 $APP"
