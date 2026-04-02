#!/bin/sh
set -e
cd /app
if [ -f ./server.js ]; then exec node server.js; fi
if [ -f ./apps/frontend/server.js ]; then cd apps/frontend && exec node server.js; fi
echo "standalone: no server.js at /app or /app/apps/frontend" >&2
exit 1
