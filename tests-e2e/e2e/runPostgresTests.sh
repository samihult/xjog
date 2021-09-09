#!/usr/bin/env bash

set -e

# Find a free TCP port
while
  DB_PORT=$(shuf -n 1 -i 49152-65535)
  nc -z localhost $DB_PORT
do
  continue
done
echo "Chose port $DB_PORT for PostgreSQL"

# Start PostgreSQL
DB_PID=$(
  docker run -d --rm \
    --volume /var/lib/postgresql/data \
    --user "postgres" --publish "${DB_PORT}:5432" \
    --env PGUSER=xjog --env POSTGRES_USER=xjog \
    --env POSTGRES_PASSWORD=xjog --env POSTGRES_DB=xjog \
    --env LANG=C.UTF-8 \
    postgres:11.2-alpine
)
trap "docker stop $DB_PID" EXIT

# Prepare the latest package
(
  cd ..
  yarn build:bin
  yarn build:files
  yarn pack -f e2e/xjog.tgz
  exit $?
)

# Hack to make sure that fresh xjog is installed
ls $(yarn cache dir) | grep -e '^npm-xjog-' | xargs -I '{}' rm -rf "$(yarn cache dir)/{}"
rm -rf "$(yarn cache dir)/.tmp"
rm -rf node_modules/xjog
yarn --no-lockfile

# Wait until PostgreSQL is ready
timeout 5s bash -c "
  while ! nc -z localhost $DB_PORT; do
    sleep 1;
  done;
"

# Run the tests
export DB_PORT
yarn test postgres
