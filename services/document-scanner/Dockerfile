# The gateway only. ClamAV runs in its own container — see docker-compose.yml.
#
# Two containers rather than one, deliberately. clamd wants a gigabyte and a
# half of memory and restarts when its signatures update; the gateway is a few
# megabytes and should not go down with it. Keeping them apart also means the
# gateway image has no virus database in it, so it rebuilds in seconds.
FROM node:22-alpine

# No dependencies to install. The whole service is three files of Node standard
# library, which is the point: this is what decides whether a file reaches an
# accountant, and there is nothing here to audit but our own code.
WORKDIR /app
COPY server.mjs clamd.mjs ./

RUN addgroup -S scanner && adduser -S scanner -G scanner
USER scanner

ENV PORT=8080 \
    CLAMD_HOST=clamav \
    CLAMD_PORT=3310

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "server.mjs"]
