#!/usr/bin/env bash
# Mengaktifkan HTTPS untuk amukapi.santaralabs.ai di server aplikasi (bagian [target] di secrets/server.txt):
#   1. terbitkan sertifikat Let's Encrypt lewat webroot /var/www/html (butuh DNS sudah mengarah ke server ini)
#   2. pasang deploy/nginx/amukapi.santaralabs.ai.conf, uji nginx -t, reload; kembalikan versi lama bila gagal
# Kata sandi dikirim lewat stdin ke sudo dan tidak pernah ditampilkan.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/secrets/server.txt"

get() { awk -v s="[target]" -v k="$1" '$0==s{f=1;next} /^\[/{f=0} f && $1==k {sub(/^[^=]*=[ \t]*/,""); print; exit}' "$CFG"; }
HOST=$(get host); USER_=$(get user); PORT=$(get port); PORT=${PORT:-22}
DOMAIN=$(get domain); PUBLIC_IP=$(get public_ip)
[ -n "$DOMAIN" ] && [ -n "$PUBLIC_IP" ] || { echo "Isi domain dan public_ip di bagian [target] secrets/server.txt (lihat deploy/server.example.txt)."; exit 1; }
export SSHPASS="$(get password)"
SSH_OPTS="-p $PORT -o StrictHostKeyChecking=accept-new -o ConnectTimeout=60 -o PubkeyAuthentication=no"

# Periksa lewat DNS-over-HTTPS: sebagian ISP mencegat kueri DNS port 53 sehingga dig bisa menipu.
for DOH in "https://dns.google/resolve" "https://cloudflare-dns.com/dns-query"; do
  RESOLVED=$(curl -s -H "accept: application/dns-json" "$DOH?name=$DOMAIN&type=A" | python3 -I -c 'import json,sys; print(" ".join(a["data"] for a in json.load(sys.stdin).get("Answer", [])))')
  [ "$RESOLVED" = "$PUBLIC_IP" ] || { echo "DNS $DOMAIN menurut $DOH = '${RESOLVED:-kosong}', seharusnya $PUBLIC_IP."; exit 1; }
done

echo "==> Mengunggah konfigurasi HTTPS"
base64 < "$ROOT/deploy/nginx/$DOMAIN.conf" | sshpass -e ssh $SSH_OPTS "$USER_@$HOST" "base64 -d > /tmp/$DOMAIN.https.conf"

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
printf '%s\n' "$SSHPASS" | sshpass -e ssh $SSH_OPTS "$USER_@$HOST" "sudo -S -p '' bash -c $(printf '%q' "$REMOTE")"

echo "==> Uji dari luar"
curl -s -o /dev/null -w "https://$DOMAIN -> %{http_code}\n" --max-time 30 "https://$DOMAIN/"
curl -s -o /dev/null -w "http://$DOMAIN  -> %{http_code} (seharusnya 301)\n" --max-time 30 "http://$DOMAIN/"
