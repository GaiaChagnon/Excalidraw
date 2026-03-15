#!/bin/bash
set -euo pipefail

# Setup script for Amazon Linux 2 EC2 instance
# Run as: sudo bash setup-ec2.sh

echo "==> Installing Docker..."
yum update -y
yum install -y docker git
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

echo "==> Installing Docker Compose..."
COMPOSE_VERSION="v2.24.5"
curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose

# Also install as Docker CLI plugin
mkdir -p /usr/local/lib/docker/cli-plugins
cp /usr/local/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose

echo "==> Adding 1GB swap for build..."
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile swap swap defaults 0 0" >> /etc/fstab
fi

echo "==> Done! Log out and back in for docker group to take effect."
echo "    Then clone your repo, create deploy/.env, and run:"
echo "    cd deploy && bash init-ssl.sh && docker compose up -d --build"
