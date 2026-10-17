#!/usr/bin/env bash
# Menutup port lokal server aplikasi (10.129.90.36 / publik 103.138.205.33) dari internet.
#   - Host  : tolak koneksi masuk dari internet kecuali 80/443 (Nginx); jaringan privat tetap boleh (SSH via VPN, proxy 10.129.90.11).
#   - Docker: port container disaring di rantai DOCKER-USER (ufw biasa tidak berlaku untuk port Docker);
#             koneksi baru dari internet dibuang, jaringan privat dan balasan koneksi tetap jalan.
# Pengaman: firewall otomatis dibatalkan 5 menit kemudian kecuali Anda menjalankan
#   sudo systemctl stop firewall-rollback.timer
# setelah memastikan SSH dan situs tetap bisa diakses.
#
# Jalankan DI SERVER aplikasi:  sudo bash tutup-port-publik.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Jalankan dengan sudo."; exit 1; }

IFACE="${IFACE:-ens18}"

systemd-run --on-active=300 --unit=firewall-rollback /bin/sh -c \
  "ufw --force disable; iptables -F DOCKER-USER; iptables -A DOCKER-USER -j RETURN" >/dev/null
echo "Pembatalan otomatis dalam 5 menit terpasang (unit firewall-rollback)."

cp -n /etc/ufw/after.rules /etc/ufw/after.rules.sebelum-karhutla
if ! grep -q "BEGIN TUTUP-PORT-DOCKER" /etc/ufw/after.rules; then
  cat >> /etc/ufw/after.rules <<EOR

# BEGIN TUTUP-PORT-DOCKER: port container hanya untuk jaringan privat, koneksi baru dari internet dibuang
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
-A DOCKER-USER -s 10.0.0.0/8 -j RETURN
-A DOCKER-USER -s 172.16.0.0/12 -j RETURN
-A DOCKER-USER -s 192.168.0.0/16 -j RETURN
-A DOCKER-USER -i $IFACE -m conntrack --ctstate NEW -j DROP
-A DOCKER-USER -j RETURN
COMMIT
# END TUTUP-PORT-DOCKER
EOR
fi

ufw default deny incoming
ufw default allow outgoing
ufw default allow routed
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do ufw allow from "$net" comment "jaringan privat"; done
ufw allow 80/tcp comment "nginx http"
ufw allow 443/tcp comment "nginx https"
ufw --force enable

ufw status numbered
iptables -S DOCKER-USER
echo
echo "Uji sekarang (SSH baru, situs, proxy). Bila semua baik:  sudo systemctl stop firewall-rollback.timer"
echo "Bila ada masalah: tunggu 5 menit, atau jalankan  sudo ufw disable && sudo iptables -F DOCKER-USER && sudo iptables -A DOCKER-USER -j RETURN"
