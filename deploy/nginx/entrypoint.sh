#!/bin/sh
set -e

CERT_DIR="/etc/letsencrypt/live/draw.gaiachagnon.com"

# If no real certs yet, generate self-signed so nginx can start
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  echo "No SSL certs found, generating self-signed..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
    -keyout "$CERT_DIR/privkey.pem" \
    -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=draw.gaiachagnon.com" 2>/dev/null
fi

exec nginx -g "daemon off;"
