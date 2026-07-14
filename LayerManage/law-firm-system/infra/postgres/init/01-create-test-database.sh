#!/bin/sh
set -eu

: "${POSTGRES_TEST_DB:=chengye_oa_test}"
: "${POSTGRES_TEST_USER:=chengye_test}"
: "${POSTGRES_TEST_PASSWORD:=chengye_test_local_only}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=test_db="$POSTGRES_TEST_DB" \
  --set=test_user="$POSTGRES_TEST_USER" \
  --set=test_password="$POSTGRES_TEST_PASSWORD" <<-'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'test_user', :'test_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'test_user')\gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8''', :'test_db', :'test_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'test_db')\gexec
EOSQL
