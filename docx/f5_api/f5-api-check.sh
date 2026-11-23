#!/usr/bin/env bash
# F5 BIG-IP DNS (GTM) 16.1 - iControl REST checks for the DNS Management Portal
# Starlight Data Solutions
#
# Changes nothing on the F5. It sends GET requests only, except the login (POST) and,
# at the end, deleting its own login token (DELETE).
# Each answer is saved in a new folder for review. The login token is never saved.
#
# Usage (Git Bash on Windows, or a Linux jump host that can reach the F5 management address):
#   ./f5-api-check.sh https://<f5-mgmt-address> <username> --cacert <f5-mgmt-ca.pem>
#   ./f5-api-check.sh https://<f5-mgmt-address> <username> -k      (lab only: skips the certificate check)
# The password is asked for; it is never shown or saved.
# Optional: LOGIN_PROVIDER=tmos (default). Ask the F5 admin if the account is a remote (LDAP/TACACS) one.
# Optional: KEEP_TOKEN=1 to skip deleting the token at the end.

set -u

if [ $# -lt 3 ]; then
  sed -n '2,15p' "$0"
  exit 1
fi
F5="${1%/}"
F5_USER="$2"
shift 2
TLS=("$@")
PROVIDER="${LOGIN_PROVIDER:-tmos}"

read -r -s -p "Password for $F5_USER: " F5_PASS
echo

host=$(printf '%s' "$F5" | sed -E 's#^https?://##; s#[^A-Za-z0-9.-]+#_#g')
OUT="f5-check-$host-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
SUMMARY="$OUT/00-summary.txt"
CURL=(curl -s --connect-timeout 10 --max-time 60 "${TLS[@]}")
problems=0

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# first string value of a JSON property, with or without spaces around the colon: json_str <json> <name>
json_str() {
  printf '%s' "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" | head -1 | sed -E 's/.*"([^"]+)"$/\1/'
}

line() { # line <http-code> <expected> <label> <request>
  local verdict="OK"
  if ! printf '%s' "$1" | grep -Eq "^($2)$"; then verdict="CHECK"; problems=$((problems + 1)); fi
  printf '%-5s %-9s %-6s %-26s %s\n' "$1" "$2" "$verdict" "$3" "$4" | tee -a "$SUMMARY"
}

{
  echo "F5 API check: $F5   user: $F5_USER   $(date '+%d-%b-%Y %H:%M:%S %Z')"
  echo
  printf '%-5s %-9s %-6s %-26s %s\n' "HTTP" "expected" "result" "check" "request"
} | tee "$SUMMARY"

# ---- 1. Is iControl REST reachable? Without credentials the F5 must answer 401.
code=$("${CURL[@]}" -o "$OUT/01-no-credentials.json" -w '%{http_code}' "$F5/mgmt/tm/sys/version")
line "$code" "401" "no-credentials" "GET /mgmt/tm/sys/version (no login)"
if [ "$code" = "000" ]; then
  echo "Could not connect (network, firewall, address or certificate). To see why, run:"
  echo "  curl -v ${TLS[*]} $F5/mgmt/tm/sys/version"
  exit 2
fi

# ---- 2. Log in and get a token (guide p20)
body=$(printf '{"username":"%s","password":"%s","loginProviderName":"%s"}' \
  "$(json_escape "$F5_USER")" "$(json_escape "$F5_PASS")" "$PROVIDER")
resp=$(printf '%s' "$body" | "${CURL[@]}" -X POST -H 'Content-Type: application/json' \
  --data-binary @- -w '\n%{http_code}' "$F5/mgmt/shared/authn/login")
unset F5_PASS body
code="${resp##*$'\n'}"
resp="${resp%$'\n'*}"
TOKEN=$(json_str "$resp" token)
if [ -n "$TOKEN" ]; then
  printf '%s\n' "$resp" | sed "s/$TOKEN/<token-removed>/g" > "$OUT/02-login.json"
else
  printf '%s\n' "$resp" > "$OUT/02-login.json"
fi
line "$code" "200" "login" "POST /mgmt/shared/authn/login"
if [ "$code" != "200" ] || [ -z "$TOKEN" ]; then
  echo "Login failed. See $OUT/02-login.json. Check the username, password and LOGIN_PROVIDER."
  exit 3
fi
timeout=$(printf '%s' "$resp" | grep -oE '"timeout"[[:space:]]*:[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+$')
partition=$(json_str "$resp" partition)
echo "                                       token received: timeout ${timeout:-not shown} s, partitions ${partition:-not shown}" | tee -a "$SUMMARY"

n=2
get() { # get <label> <expected codes> <path?query>
  n=$((n + 1))
  local f code
  f=$(printf '%s/%02d-%s.json' "$OUT" "$n" "$1")
  code=$("${CURL[@]}" -H "X-F5-Auth-Token: $TOKEN" -o "$f" -w '%{http_code}' "$F5$3")
  line "$code" "$2" "$1" "GET $3"
}

# first object's path in a saved collection, as an iControl REST name: /Common/x -> ~Common~x
first_ref() {
  [ -f "$1" ] || return 0
  json_str "$(cat "$1")" fullPath | tr '/' '~'
}

# ---- 3. Device
get sys-version            '200'     '/mgmt/tm/sys/version'
get sys-provision          '200'     '/mgmt/tm/sys/provision?$select=name,level'
get cm-device              '200'     '/mgmt/tm/cm/device'
get cm-sync-status         '200'     '/mgmt/tm/cm/sync-status'
get sys-host-info          '200|404' '/mgmt/tm/sys/host-info'

# ---- 4. Partitions
get sys-folder             '200'     '/mgmt/tm/sys/folder?$select=name,fullPath'

# ---- 5. BIG-IP DNS (GTM) configuration
get gtm                    '200'     '/mgmt/tm/gtm'
get gtm-datacenter         '200'     '/mgmt/tm/gtm/datacenter'
get gtm-server             '200'     '/mgmt/tm/gtm/server'
server=$(first_ref "$(printf '%s/%02d-gtm-server.json' "$OUT" "$n")")
if [ -n "$server" ]; then
  get gtm-server-vs        '200'     "/mgmt/tm/gtm/server/$server/virtual-servers"
fi
get gtm-wideip-a           '200'     '/mgmt/tm/gtm/wideip/a'
wideip=$(first_ref "$(printf '%s/%02d-gtm-wideip-a.json' "$OUT" "$n")")
get gtm-wideip-aaaa        '200'     '/mgmt/tm/gtm/wideip/aaaa'
get gtm-pool-a             '200'     '/mgmt/tm/gtm/pool/a?expandSubcollections=true'
get gtm-pool-aaaa          '200'     '/mgmt/tm/gtm/pool/aaaa?expandSubcollections=true'
get gtm-listener           '200'     '/mgmt/tm/gtm/listener'
get query-top-select       '200'     '/mgmt/tm/gtm/wideip/a?$top=2&$select=name,partition,fullPath'
get query-filter-partition '200'     '/mgmt/tm/gtm/wideip/a?$filter=partition%20eq%20Common&$select=name,partition'

# ---- 6. Monitoring (statistics, the same as "tmsh show")
get gtm-datacenter-stats   '200'     '/mgmt/tm/gtm/datacenter/stats'
get gtm-server-stats       '200'     '/mgmt/tm/gtm/server/stats'
get gtm-wideip-a-stats     '200'     '/mgmt/tm/gtm/wideip/a/stats'
get gtm-wideip-aaaa-stats  '200'     '/mgmt/tm/gtm/wideip/aaaa/stats'
get gtm-pool-a-stats       '200'     '/mgmt/tm/gtm/pool/a/stats'
get gtm-pool-aaaa-stats    '200'     '/mgmt/tm/gtm/pool/aaaa/stats'
if [ -n "$wideip" ]; then
  get one-wideip-stats     '200'     "/mgmt/tm/gtm/wideip/a/$wideip/stats"
fi

# ---- 7. Not in the documents we have: the HTTP code itself is the answer
get gtm-iquery             '200|404' '/mgmt/tm/gtm/iquery'
get ltm-dns-zone           '200|404' '/mgmt/tm/ltm/dns/zone'
get as3-info               '200|404' '/mgmt/shared/appsvcs/info'

# ---- 8. Error behaviour
get error-not-found        '404'     '/mgmt/tm/gtm/wideip/a/~Common~portal-check-does-not-exist.example'
n=$((n + 1))
code=$("${CURL[@]}" -H "X-F5-Auth-Token: INVALID0TOKEN0FOR0TEST" \
  -o "$(printf '%s/%02d-error-bad-token.json' "$OUT" "$n")" -w '%{http_code}' "$F5/mgmt/tm/sys/version")
line "$code" "401" "error-bad-token" "GET /mgmt/tm/sys/version (wrong token)"

# ---- 9. Delete our own token (not described in the guide: the code tells us if it works)
if [ "${KEEP_TOKEN:-0}" != "1" ]; then
  n=$((n + 1))
  code=$("${CURL[@]}" -X DELETE -H "X-F5-Auth-Token: $TOKEN" \
    -o "$(printf '%s/%02d-logout.json' "$OUT" "$n")" -w '%{http_code}' "$F5/mgmt/shared/authz/tokens/$TOKEN")
  [ -f "$(printf '%s/%02d-logout.json' "$OUT" "$n")" ] && sed -i "s/$TOKEN/<token-removed>/g" "$(printf '%s/%02d-logout.json' "$OUT" "$n")"
  line "$code" "200|204|404" "logout" "DELETE /mgmt/shared/authz/tokens/<token>"
fi
unset TOKEN

{
  echo
  echo "Checks marked CHECK: $problems. Responses are in: $OUT"
  echo "Before sharing, look through the files: they hold F5 names and internal IP addresses (no passwords or tokens)."
} | tee -a "$SUMMARY"
