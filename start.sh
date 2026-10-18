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

# One certificate covering both names, obtained with lego.
#
# Caddy cannot do this: it issues a separate certificate per hostname, which is
# visible in the 2026-10-17 container log as two independent tls.obtain runs even
# though both names shared one site block. That matters because Let's Encrypt
# rate-limits "new certificates per exact set of identifiers": {stable_host}
# alone had been issued five times in 168h and was refused outright, leaving the
# container with no certificate at all (TLS alert internal_error on 2026-10-17
# and again on 2026-10-18, retry after 2026-10-19 19:04 UTC). lego places both
# names in a single order, which is a set Let's Encrypt has never counted, and
# the stable host stays inside it, so the visitor frontend needs no change.
#
# TLS-ALPN-01 is used because inbound port 80 does not reach the container
# (certbot's HTTP-01 fails there with "connection refused"). lego needs :443 to
# itself, so it runs before Caddy binds any port.
#
# The instance host derived from the outbound IP is deliberately NOT served: it
# changes on every restart and every extra name costs another issuance.
alt_host="${ALT_HTTPS_HOST:-api.${stable_host}}"
if ! printf '%s' "$alt_host" | grep -Eq '^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  echo '[public-https] Invalid ALT_HTTPS_HOST' >&2
  exit 1
fi

export CORS_ORIGINS="https://${stable_host},https://${alt_host},https://${instance_host}${CORS_ORIGINS:+,${CORS_ORIGINS}}"
node /app/server.js &

lego_dir=/etc/lego
cert_file=""
if [ -s "${lego_dir}/certificates/${stable_host}.crt" ]; then
  cert_file="${lego_dir}/certificates/${stable_host}.crt"
else
  attempt=1
  while [ "$attempt" -le 4 ]; do
    echo "[public-https] lego attempt ${attempt}"
    lego --path "${lego_dir}" --email "ops@zheshgo.app" \
      --domains "${stable_host}" --domains "${alt_host}" \
      --tls --accept-tos run > /tmp/lego.log 2>&1 || true
    echo '[public-https] lego output (tail):'
    tail -n 8 /tmp/lego.log || true
    if [ -s "${lego_dir}/certificates/${stable_host}.crt" ]; then
      cert_file="${lego_dir}/certificates/${stable_host}.crt"
      break
    fi
    attempt=$((attempt + 1))
    sleep 20
  done
fi

if [ -n "$cert_file" ]; then
  echo '[public-https] Serving the certificate obtained by lego (both names)'
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
        },
        "http": {
          "listen": [":80"],
          "routes": [
            {
              "match": [{ "host": ["${stable_host}", "${alt_host}"] }],
              "handle": [{ "handler": "static_response", "status_code": 308, "headers": { "Location": ["https://{http.request.host}{http.request.uri}"] } }]
            }
          ]
        }
      }
    },
    "tls": {
      "certificates": {
        "load_files": [{ "certificate": "${cert_file}", "key": "${lego_dir}/certificates/${stable_host}.key" }]
      }
    }
  }
}
EOF
else
  echo '[public-https] certbot did not produce a certificate; falling back to Caddy ACME' >&2
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
fi

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
  exec caddy run --config /tmp/caddy.json
fi
echo '[public-https] JSON config rejected; falling back to Caddyfile' >&2
exec caddy run --config /tmp/Caddyfile --adapter caddyfile
