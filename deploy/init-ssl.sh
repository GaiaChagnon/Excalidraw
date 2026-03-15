#!/bin/bash
set -euo pipefail

# Bootstrap SSL certificates with Let's Encrypt
# Run this once on first deployment

if [ -z "${DOMAIN:-}" ]; then
  echo "Error: DOMAIN environment variable not set"
  exit 1
fi

if [ -z "${EMAIL:-}" ]; then
  echo "Error: EMAIL environment variable not set"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Creating temporary nginx config for ACME challenge..."

# Create a minimal nginx config for HTTP-only (ACME challenge)
docker compose run --rm --no-deps -d \
  --name nginx-acme \
  -p 80:80 \
  -v certbot-www:/var/www/certbot \
  nginx sh -c '
    cat > /etc/nginx/conf.d/default.conf <<CONF
server {
    listen 80;
    server_name '"$DOMAIN"';
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 "OK"; }
}
CONF
    nginx -g "daemon off;"
  '

echo "==> Waiting for nginx to start..."
sleep 3

echo "==> Requesting certificate from Let's Encrypt..."
docker compose run --rm certbot certonly \
  --webroot \
  -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --force-renewal

echo "==> Stopping temporary nginx..."
docker stop nginx-acme 2>/dev/null || true
docker rm nginx-acme 2>/dev/null || true

echo "==> SSL certificate obtained! Now run: docker compose up -d --build"
