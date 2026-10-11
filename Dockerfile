# ZheshGo backend — SAE (Serverless App Engine) image
# server.js is zero-dependency Node; listens on process.env.PORT (SAE injects it)
# or 8080. data/content.json is baked in for AI context grounding (see .dockerignore).

FROM node:20-alpine

WORKDIR /app

# Copy the whole app (respects .dockerignore: secrets & runtime state excluded)
COPY . .

ENV NODE_ENV=production
ENV PORT=8080

# Runtime data dir must exist (ephemeral on SAE; content.json is in the image)
RUN mkdir -p /app/data

# SAE probes this port; server.js serves / and /api/v1/health
EXPOSE 8080

CMD ["node", "server.js"]
