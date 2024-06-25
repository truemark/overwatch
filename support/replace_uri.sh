#!/bin/sh

if [ -z "$REMOTE_WRITE_URL" ]; then
  echo "Error: REMOTE_WRITE_URL environment variable is not set."
  exit 1
fi

sed -i "s|REPLACE_ME|$REMOTE_WRITE_URL|g" /etc/prometheus/prometheus.yml

exec "$@"
