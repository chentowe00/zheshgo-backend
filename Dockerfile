# ZheshGo backend — SAE (Serverless App Engine) image
# server.js is zero-dependency Node; listens on process.env.PORT (SAE injects it)
# or 8080. data/content.json is baked in for AI context grounding (see .dockerignore).

FROM cloudflare/cloudflared:2026.10.1 AS cloudflared

FROM node:20-alpine

WORKDIR /app

# Serve the existing visitor pages and the AI API from one HTTPS origin.
# Caddy obtains a public certificate for the current instance EIP.
RUN apk add --no-cache caddy curl

# Quick Tunnel is an emergency, temporary HTTPS transport. The tunnel
# originates from this container and does not expose the Qwen key to clients.
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared

# Copy the whole app (respects .dockerignore: secrets & runtime state excluded)
COPY . .

ENV NODE_ENV=production
ENV PORT=8080

# Runtime data dir must exist (/app/data is ephemeral on SAE; content.json is in the image)
RUN mkdir -p /app/data

# SAE probes this port; server.js serves / and /api/v1/health
EXPOSE 80 443 8080

CMD ["sh", "start.sh"]
