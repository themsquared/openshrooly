#!/usr/bin/env bash
# Checks that shroomlabs.io and its API answer. Exits 1 if any check fails twice in a row.
# Used by .github/workflows/uptime.yml. Reads public pages only; needs no secrets.
set -u
SITE="${SITE:-https://shroomlabs.io}"
API="${API:-https://api.shroomlabs.io}"

check() { # name url must_contain
  local body code
  body=$(curl -sS --max-time 20 -w '\n%{http_code}' "$2" 2>/dev/null) || body=$'\n000'
  code=${body##*$'\n'}
  body=${body%$'\n'*}
  if [ "$code" = "200" ] && { [ -z "$3" ] || grep -qF -- "$3" <<<"$body"; }; then
    echo "ok   $1 ($code)"
    return 0
  fi
  echo "FAIL $1 ($code) $2"
  return 1
}

run() {
  local bad=0
  check "site home" "$SITE/" "Shroom Labs" || bad=1
  check "site config" "$SITE/js/config.js" "api.shroomlabs.io" || bad=1
  check "api health" "$API/health" '"ok":true' || bad=1
  check "api profiles" "$API/api/profiles/pearl-oyster" "" || bad=1
  return $bad
}

run && exit 0
echo "Something failed. Checking again in 60 seconds."
sleep "${RETRY_WAIT:-60}"
run && { echo "Passed on the second try."; exit 0; }
echo "shroomlabs.io is down or broken. See the lines marked FAIL."
exit 1
