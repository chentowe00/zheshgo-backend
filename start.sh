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

# Let's Encrypt rate-limits issuance by the exact set of identifiers, so a second
# SAN moves the request into a fresh bucket. The stable host stays covered by the
# same certificate, therefore no frontend or API-base change is required.
alt_host="${ALT_HTTPS_HOST:-api.${stable_host}}"
if ! printf '%s' "$alt_host" | grep -Eq '^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  echo '[public-https] Invalid ALT_HTTPS_HOST' >&2
  exit 1
fi

site_hosts="$stable_host, $alt_host"
cors_origins="https://${stable_host},https://${alt_host}"
if [ "$instance_host" != "$stable_host" ]; then
  site_hosts="$site_hosts, $instance_host"
  cors_origins="$cors_origins,https://${instance_host}"
fi

export CORS_ORIGINS="${cors_origins}${CORS_ORIGINS:+,${CORS_ORIGINS}}"
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
