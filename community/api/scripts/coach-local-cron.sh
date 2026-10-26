#!/bin/bash
# wrangler dev never fires [triggers] crons on its own. This loop hits the local
# scheduled handler at :00/:15/:30/:45 (+20s) so Autopilot runs like it would in a
# deployed Worker. Local only: the URL is 127.0.0.1. Stop with Ctrl+C or kill the pid.
URL="${COACH_LOCAL_SCHEDULED_URL:-http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*}"
while :; do
  sleep $(( 900 - $(date +%s) % 900 + 20 ))
  echo "$(date "+%F %T %Z") scheduled -> HTTP $(curl -s -m 60 -o /dev/null -w "%{http_code}" "$URL")"
done
