#!/usr/bin/env bash
# Run once on a fresh Lightsail Ubuntu 24.04 instance, as root (via SSH).
# Idempotent-ish: safe to re-run.
set -euo pipefail

echo "== packages =="
apt-get update -y
apt-get install -y python3.12 python3.12-venv python3-pip sqlite3 curl git ufw

echo "== caddy =="
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy

echo "== firewall =="
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== jaga user + directories =="
id -u jaga &>/dev/null || useradd -m -s /bin/bash jaga
mkdir -p /opt/jaga/backend /var/lib/jaga/docs /var/www/jaga/web
chown -R jaga:jaga /opt/jaga /var/lib/jaga

echo "== systemd units =="
cp /opt/jaga/deploy/jaga-api.service       /etc/systemd/system/
cp /opt/jaga/deploy/jaga-bot.service       /etc/systemd/system/
cp /opt/jaga/deploy/jaga-scheduler.service /etc/systemd/system/
cp /opt/jaga/deploy/Caddyfile              /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable caddy jaga-api jaga-bot jaga-scheduler

echo "== done. Next: put backend code + .env in /opt/jaga/backend, create .venv,"
echo "   pip install -r requirements.txt, then: systemctl restart caddy jaga-api jaga-bot jaga-scheduler"
