#!/bin/sh
set -eu

node /app/server.js &

# SAE may attach the existing EIP after the container starts. Wait for the
# outbound address before deriving the temporary sslip.io hostname.
until public_ip=$(curl --fail --silent --max-time 5 https://api.ipify.org) &&
      printf '%s' "$public_ip" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; do
  echo '[public-https] Waiting for instance EIP'
  sleep 5
done

public_host="$(printf '%s' "$public_ip" | tr . -).sslip.io"
cat > /tmp/Caddyfile <<EOF
${public_host} {
  @ai path /api/v1/assistant/status /api/v1/assistant/chat /api/v1/health
  handle @ai {
    reverse_proxy 127.0.0.1:8080 {
      # Only public AI endpoints reach this proxy. Browser requests are
      # same-origin here; remove Origin before the internal backend check.
      # Cross-origin callers still receive no allow-origin response header.
      header_up -Origin
    }
  }
  handle {
    root * /app/public
    file_server
  }
}
EOF

echo "[public-https] Visitor site: https://${public_host}/assistant.html"
exec caddy run --config /tmp/Caddyfile --adapter caddyfile
