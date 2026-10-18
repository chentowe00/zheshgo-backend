# ZheshGo backend — SAE (Serverless App Engine) image
# server.js is zero-dependency Node; listens on process.env.PORT (SAE injects it)
# or 8080. data/content.json is baked in for AI context grounding (see .dockerignore).

FROM node:20-alpine

WORKDIR /app

# Serve the existing visitor pages and the AI API from one HTTPS origin.
# lego obtains ONE certificate covering both hostnames in a single order — Caddy
# cannot, it issues a separate certificate per name — and it can use the
# TLS-ALPN-01 challenge, which is the only challenge that works here because
# inbound port 80 does not reach the container.
RUN apk add --no-cache caddy curl
ARG LEGO_VERSION=4.31.0
RUN curl -fsSL "https://github.com/go-acme/lego/releases/download/v${LEGO_VERSION}/lego_v${LEGO_VERSION}_linux_amd64.tar.gz" \
  | tar -xz -C /usr/local/bin lego && lego --version

# Copy the whole app (respects .dockerignore: secrets & runtime state excluded)
COPY . .

ENV NODE_ENV=production
ENV PORT=8080

# Runtime data dir must exist (ephemeral on SAE; content.json is in the image)
RUN mkdir -p /app/data

# SAE probes this port; server.js serves / and /api/v1/health
EXPOSE 80 443 8080

CMD ["sh", "start.sh"]
