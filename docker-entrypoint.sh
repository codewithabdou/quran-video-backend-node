#!/bin/sh
set -e

echo "[Docker] Syncing Prisma schema with database..."
npx prisma db push || echo "[Docker Warning] Prisma db push failed, continuing..."

echo "[Docker] Starting application..."
exec "$@"
