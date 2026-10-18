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

# One certificate for two names, issued from a single automation policy.
#
# A Caddyfile cannot express this: every comma-separated address is its own site
# key, so Caddy obtains one certificate per name. That matters because Let's
# Encrypt rate-limits "new certificates per exact set of identifiers" — the
# single-name set {stable_host} had been issued 5 times in 168h and was refused
# outright, leaving the container with no certificate at all (TLS alert
# internal_error, 2026-10-17 and again 2026-10-18). A policy that names both
# hosts asks for one certificate covering both, which is a set Let's Encrypt has
# never counted, and the stable host stays inside it so the visitor frontend
# needs no change.
#
# The instance host derived from the outbound IP is deliberately NOT served: it
# changes on every restart and each name costs another issuance.
stable_host="${stable_host}"
alt_host="${ALT_HTTPS_HOST:-api.${stable_host}}"
if ! printf '%s' "$alt_host" | grep -Eq '^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  echo '[public-https] Invalid ALT_HTTPS_HOST' >&2
  exit 1
fi

export CORS_ORIGINS="https://${stable_host},https://${alt_host},https://${instance_host}${CORS_ORIGINS:+,${CORS_ORIGINS}}"
node /app/server.js &
cat > /tmp/caddy.json <<EOF
{
  "admin": { "disabled": true },
  "apps": {
    "http": {
      "servers": {
        "https": {
          "listen": [":443"],
          "routes": [
            {
              "match": [{ "host": ["${stable_host}", "${alt_host}"], "path": ["/api/v1/assistant/status", "/api/v1/assistant/chat", "/api/v1/health"] }],
              "handle": [{ "handler": "reverse_proxy", "upstreams": [{ "dial": "127.0.0.1:8080" }] }]
            },
            {
              "match": [{ "host": ["${stable_host}", "${alt_host}"] }],
              "handle": [{ "handler": "file_server", "root": "/app/public" }]
            }
          ],
          "tls_connection_policies": [{}]
        }
      }
    },
    "tls": {
      "automation": {
        "policies": [
          {
            "subjects": ["${stable_host}", "${alt_host}"],
            "issuers": [{ "module": "acme" }]
          }
        ]
      }
    }
  }
}
EOF

echo "[public-https] Fixed ingress: https://${stable_host}/assistant.html"

# Safety net: if the JSON config is rejected for any reason, keep the previous
# behaviour (single host, Caddyfile) instead of leaving no listener at all.
cat > /tmp/Caddyfile <<EOF
${stable_host} {
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

if caddy validate --config /tmp/caddy.json >/dev/null 2>&1; then
  echo '[public-https] Using JSON config (single certificate, two names)'
  exec caddy run --config /tmp/caddy.json
fi
echo '[public-https] JSON config rejected; falling back to Caddyfile' >&2
exec caddy run --config /tmp/Caddyfile --adapter caddyfile
