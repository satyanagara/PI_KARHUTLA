#!/usr/bin/env bash
# Menutup port lokal server aplikasi dari internet.
#   - Host  : hanya 80/443 (Nginx) terbuka untuk umum; SSH hanya dari subnet VPN (SSH_ALLOW).
#             Jangan izinkan seluruh 10.0.0.0/8 untuk SSH: gateway NAT dapat meneruskan serangan dari internet
#             dengan alamat sumber gateway itu sendiri.
#   - Docker: port container disaring di rantai DOCKER-USER (ufw biasa tidak berlaku untuk port Docker).
#             Koneksi baru hanya diterima dari jaringan privat (reverse proxy internal, LAN, VPN, antar-container);
#             selain itu ditolak (deny-by-default, tidak bergantung pada nama antarmuka).
# Pengaman: keadaan firewall sebelumnya disimpan dan dipulihkan otomatis 5 menit kemudian, kecuali Anda
# menjalankan  sudo systemctl stop firewall-rollback.timer  setelah memastikan SSH dan situs tetap normal.
#
# Jalankan DI SERVER aplikasi:  sudo SSH_PORT=<port ssh> SSH_ALLOW="<subnet VPN>" bash tutup-port-publik.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Jalankan dengan sudo."; exit 1; }

SSH_PORT="${SSH_PORT:-22}"
SSH_ALLOW="${SSH_ALLOW:?Isi SSH_ALLOW dengan subnet VPN, mis. SSH_ALLOW=\"10.8.0.0/16\"}"
for net in $SSH_ALLOW; do [[ "$net" =~ ^[0-9.]+/[0-9]+$ ]] || { echo "SSH_ALLOW tidak valid: $net"; exit 1; }; done
# Pastikan sesi SSH saat ini berasal dari subnet yang diizinkan agar tidak terkunci.
if [ -n "${SSH_CLIENT:-}" ] && command -v python3 >/dev/null; then
  python3 -c 'import ipaddress,sys; ip=ipaddress.ip_address(sys.argv[1]); sys.exit(0 if any(ip in ipaddress.ip_network(n) for n in sys.argv[2:]) else 1)' "${SSH_CLIENT%% *}" $SSH_ALLOW \
    || { echo "Sesi Anda (${SSH_CLIENT%% *}) di luar SSH_ALLOW; dibatalkan agar tidak terkunci."; exit 1; }
fi
PRIVATE_NETS="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16"
SNAPSHOT=/root/firewall-sebelum-karhutla
mkdir -p "$SNAPSHOT"

# 1. Simpan keadaan awal dan pasang pemulihan otomatis yang memakai snapshot itu.
iptables-save > "$SNAPSHOT/iptables.rules"
cp /etc/ufw/after.rules "$SNAPSHOT/after.rules"
ufw status | head -1 | grep -q "Status: active" && echo active > "$SNAPSHOT/ufw.state" || echo inactive > "$SNAPSHOT/ufw.state"
cat > "$SNAPSHOT/pulihkan.sh" <<EOR
#!/bin/sh
cp "$SNAPSHOT/after.rules" /etc/ufw/after.rules
[ "\$(cat "$SNAPSHOT/ufw.state")" = active ] || ufw --force disable
iptables-restore < "$SNAPSHOT/iptables.rules"
EOR
chmod 700 "$SNAPSHOT/pulihkan.sh"
systemd-run --on-active=300 --unit=firewall-rollback /bin/sh "$SNAPSHOT/pulihkan.sh" >/dev/null
echo "Keadaan awal disimpan di $SNAPSHOT; pemulihan otomatis dalam 5 menit."
# Bila skrip gagal di tengah jalan, pulihkan segera.
trap 'echo "Gagal, memulihkan keadaan awal..."; systemctl stop firewall-rollback.timer 2>/dev/null || true; sh "$SNAPSHOT/pulihkan.sh"' ERR

# 2. Aturan DOCKER-USER: izinkan balasan dan jaringan privat, tolak koneksi baru lainnya.
if ! grep -q "BEGIN TUTUP-PORT-DOCKER" /etc/ufw/after.rules; then
  {
    echo
    echo "# BEGIN TUTUP-PORT-DOCKER: port container hanya untuk jaringan privat"
    echo "*filter"
    echo ":DOCKER-USER - [0:0]"
    echo "-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"
    for net in $PRIVATE_NETS; do echo "-A DOCKER-USER -s $net -j RETURN"; done
    echo "-A DOCKER-USER -m conntrack --ctstate NEW -j DROP"
    echo "-A DOCKER-USER -j RETURN"
    echo "COMMIT"
    echo "# END TUTUP-PORT-DOCKER"
  } >> /etc/ufw/after.rules
fi

# 3. Aturan host: 80/443 untuk umum, SSH hanya dari jaringan privat.
ufw default deny incoming
ufw default allow outgoing
ufw default allow routed
ufw allow 80/tcp comment "nginx http"
ufw allow 443/tcp comment "nginx https"
for net in $SSH_ALLOW; do ufw allow from "$net" to any port "$SSH_PORT" proto tcp comment "ssh vpn"; done

# 4. Tolak paket dengan alamat sumber yang tidak sesuai rute balik (anti-spoofing).
cat > /etc/sysctl.d/90-rp-filter.conf <<'EOR'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
EOR
sysctl -q --system

ufw --force enable
trap - ERR

ufw status numbered
iptables -S DOCKER-USER
echo
echo "Uji sekarang dari sesi SSH BARU, buka situs, dan cek layanan yang diakses lewat reverse proxy internal."
echo "Bila semua normal:   sudo systemctl stop firewall-rollback.timer"
echo "Bila ada masalah:    tunggu 5 menit, atau jalankan  sudo sh $SNAPSHOT/pulihkan.sh"
