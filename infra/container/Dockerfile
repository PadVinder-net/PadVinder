# Runs a release directory (see scripts/build-release.sh). Build with the unpacked
# release as the context:
#
#   docker build -f infra/container/Dockerfile -t padvinder:local <release dir>
#
# Nothing is installed here: the release already holds its dependencies. The worker and
# the migrations run as other commands on the same image:
#
#   node --env-file=release.env worker/dist/main.js
#   node --env-file=release.env api/dist/migrate.js migrations
FROM node:24-bookworm-slim

WORKDIR /app
COPY --chown=node:node . .
USER node

# Docker networks are IPv4 by default, so listen on 0.0.0.0. Alwaysdata is IPv6 only and
# needs "::" (the API default).
ENV API_HOST=0.0.0.0 API_PORT=8080
EXPOSE 8080

CMD ["node", "--env-file=release.env", "api/dist/main.js"]
