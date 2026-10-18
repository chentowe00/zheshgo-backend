#!/bin/sh
set -eu

# A CLB ingress hostname stays fixed when SAE replaces its application instance.
# This value is public configuration, never a credential.
stable_host="${PUBLIC_HTTPS_HOST:-8-210-60-175.sslip.io}"
if ! printf '%s' "$stable_host" | grep -Eq '^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  echo '[public-https] Invalid PUBLIC_HTTPS_HOST' >&2
  exit 1
fi

# Retain the instance hostname during migration; the application still needs
# its existing EIP for outbound Qwen requests.
until public_ip=$(curl --fail --silent --max-time 5 https://api.ipify.org) &&
      printf '%s' "$public_ip" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; do
  echo '[public-https] Waiting for instance EIP'
  sleep 5
done
instance_host="$(printf '%s' "$public_ip" | tr . -).sslip.io"

# Only the stable host is served. In a Caddyfile every comma-separated address is
# its own site key and therefore gets its own certificate, and Caddy's storage
# lives inside the container, so each restart re-requests every name. The
# instance host is derived from an outbound IP that changes on every restart
# (observed 8.210.44.250 -> 8.218.252.123), so keeping it doubled the Let's
# Encrypt issuance rate and helped exhaust the duplicate-certificate limit.
site_hosts="$stable_host"

export CORS_ORIGINS="https://${stable_host},https://${instance_host}${CORS_ORIGINS:+,${CORS_ORIGINS}}"
node /app/server.js &
cat > /tmp/Caddyfile <<EOF
${site_hosts} {
  @ai path /api/v1/assistant/status /api/v1/assistant/chat /api/v1/health
  handle @ai {
    reverse_proxy 127.0.0.1:8080
  }
  handle {
    root * /app/public
    file_server
  }
}
EOF

echo "[public-https] Fixed ingress: https://${stable_host}/assistant.html"
exec caddy run --config /tmp/Caddyfile --adapter caddyfile
