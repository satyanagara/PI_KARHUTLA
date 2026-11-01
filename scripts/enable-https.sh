#!/usr/bin/env bash
# Mengaktifkan HTTPS untuk amukapi.santaralabs.ai di server aplikasi (bagian [SERVER] di secrets/server.txt, atau
# SERVER_SECTION=nama; domain bawaan amukapi.santaralabs.ai, IP publik bawaan = host bagian itu):
#   1. terbitkan sertifikat Let's Encrypt lewat webroot /var/www/html (butuh DNS sudah mengarah ke server ini)
#   2. pasang deploy/nginx/amukapi.santaralabs.ai.conf, uji nginx -t, reload; kembalikan versi lama bila gagal
# Login memakai kunci SSH; bila bagian itu berisi auth = password, kata sandi dikirim lewat stdin ke sudo dan tidak
# pernah ditampilkan.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/secrets/server.txt"

SECTION="[${SERVER_SECTION:-SERVER}]"
get() { awk -v s="$SECTION" -v k="$1" '$0==s{f=1;next} /^\[/{f=0} f && $1==k {sub(/^[^=]*=[ \t]*/,""); print; exit}' "$CFG"; }
HOST=$(get host); USER_=$(get user); PORT=$(get port); PORT=${PORT:-22}
DOMAIN=$(get domain); DOMAIN=${DOMAIN:-amukapi.santaralabs.ai}
PUBLIC_IP=$(get public_ip); PUBLIC_IP=${PUBLIC_IP:-$HOST}
[ -n "$HOST" ] || { echo "Bagian $SECTION tidak ditemukan di secrets/server.txt"; exit 1; }
SSH_OPTS="-p $PORT -o StrictHostKeyChecking=accept-new -o ConnectTimeout=60"
if [ "$(get auth)" = "password" ]; then
  export SSHPASS="$(get password)"
  remote() { sshpass -e ssh $SSH_OPTS -o PubkeyAuthentication=no "$USER_@$HOST" "$@"; }
  remote_sudo() { printf '%s\n' "$SSHPASS" | remote "sudo -S -p '' bash -c $(printf '%q' "$1")"; }
else
  remote() { ssh $SSH_OPTS -o BatchMode=yes "$USER_@$HOST" "$@"; }
  remote_sudo() { remote "sudo -n bash -c $(printf '%q' "$1")"; }
fi

# Periksa lewat DNS-over-HTTPS: sebagian ISP mencegat kueri DNS port 53 sehingga dig bisa menipu.
for DOH in "https://dns.google/resolve" "https://cloudflare-dns.com/dns-query"; do
  RESOLVED=$(curl -s -H "accept: application/dns-json" "$DOH?name=$DOMAIN&type=A" | python3 -I -c 'import json,sys; print(" ".join(a["data"] for a in json.load(sys.stdin).get("Answer", [])))')
  [ "$RESOLVED" = "$PUBLIC_IP" ] || { echo "DNS $DOMAIN menurut $DOH = '${RESOLVED:-kosong}', seharusnya $PUBLIC_IP."; exit 1; }
done

echo "==> Mengunggah konfigurasi HTTPS"
base64 < "$ROOT/deploy/nginx/$DOMAIN.conf" | remote "base64 -d > /tmp/$DOMAIN.https.conf"

echo "==> Menerbitkan sertifikat dan memasang konfigurasi"
REMOTE=$(cat <<EOS
set -e
F=/etc/nginx/sites-available/$DOMAIN
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  certbot certonly --webroot -w /var/www/html -d $DOMAIN --non-interactive --agree-tos --keep-until-expiring
fi
cp \$F \$F.http-backup
install -m 644 -o root -g root /tmp/$DOMAIN.https.conf \$F
rm -f /tmp/$DOMAIN.https.conf
if nginx -t; then
  systemctl reload nginx
  echo "HTTPS aktif untuk $DOMAIN"
else
  cp \$F.http-backup \$F
  nginx -t && systemctl reload nginx
  echo "nginx -t gagal, konfigurasi HTTP dikembalikan" >&2
  exit 1
fi
EOS
)
remote_sudo "$REMOTE"

echo "==> Uji dari luar"
curl -s -o /dev/null -w "https://$DOMAIN -> %{http_code}\n" --max-time 30 "https://$DOMAIN/"
curl -s -o /dev/null -w "http://$DOMAIN  -> %{http_code} (seharusnya 301)\n" --max-time 30 "http://$DOMAIN/"
