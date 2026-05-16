#!/bin/bash
# Run once on a fresh Ubuntu 22.04 VPS as root
set -e

echo "── 1. Update system ──"
apt update && apt upgrade -y

echo "── 2. Install Docker ──"
curl -fsSL https://get.docker.com | sh
usermod -aG docker $SUDO_USER

echo "── 3. Install Docker Compose plugin ──"
apt install -y docker-compose-plugin

echo "── 4. Create app directory ──"
mkdir -p /opt/entrylink/nginx/certs
cd /opt/entrylink

echo "── 5. Clone repository ──"
# Replace with your actual repo URL
git clone https://github.com/maicolqj/entrylink-backend.git .

echo "── 6. Create .env file ──"
echo "Create /opt/entrylink/.env with production values, then run:"
echo "  docker compose -f docker-compose.prod.yml up -d"
echo "  docker compose -f docker-compose.prod.yml exec app node dist/core/database/seeds/commands/seed.commands.js all"

echo "── 7. SSL with Certbot (after DNS points to this server) ──"
echo "  apt install certbot"
echo "  certbot certonly --standalone -d tudominio.com"
echo "  ln -s /etc/letsencrypt/live/tudominio.com/fullchain.pem /opt/entrylink/nginx/certs/fullchain.pem"
echo "  ln -s /etc/letsencrypt/live/tudominio.com/privkey.pem  /opt/entrylink/nginx/certs/privkey.pem"

echo "Done. Server ready for first deploy."
