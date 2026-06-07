#!/usr/bin/env bash
# Phase 0 CORS spike — header-only check.
#
# Asks D4H: "if a browser at $ORIGIN tries to GET /v3/{ctx}/{id}/members with
# an Authorization header, what would you say?" Then makes the real GET to
# confirm the token works and to capture the response envelope (which Phase 3
# will need to parse).
#
# Usage:
#   D4H_TOKEN=xxxx \
#   D4H_REGION=us \
#   D4H_CONTEXT=team \
#   D4H_CONTEXT_ID=12345 \
#   ORIGIN=https://cloudtak.example.org \
#     ./check-cors.sh
#
# Reads as success if Access-Control-Allow-Origin is "*" OR equals $ORIGIN.

set -euo pipefail

: "${D4H_TOKEN:?set D4H_TOKEN to a D4H access token}"
: "${D4H_REGION:=us}"
: "${D4H_CONTEXT:=team}"
: "${D4H_CONTEXT_ID:?set D4H_CONTEXT_ID to your numeric team/org id}"
: "${ORIGIN:?set ORIGIN to the CloudTAK origin you want to test from (e.g. https://cloudtak.example.org)}"

HOST="api.team-manager.${D4H_REGION}.d4h.com"
URL="https://${HOST}/v3/${D4H_CONTEXT}/${D4H_CONTEXT_ID}/members"

echo "==> Target: ${URL}"
echo "==> Pretending to be browser at: ${ORIGIN}"
echo

echo "==> 1) CORS preflight (OPTIONS) — read the Access-Control-Allow-* headers"
echo
preflight=$(curl -sS -i -X OPTIONS "${URL}" \
  -H "Origin: ${ORIGIN}" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,content-type")
echo "${preflight}"
echo

allow_origin=$(printf '%s\n' "${preflight}" | awk 'BEGIN{IGNORECASE=1} /^access-control-allow-origin:/ {sub(/\r$/,""); sub(/^[^:]+: */,""); print; exit}')
allow_methods=$(printf '%s\n' "${preflight}" | awk 'BEGIN{IGNORECASE=1} /^access-control-allow-methods:/ {sub(/\r$/,""); sub(/^[^:]+: */,""); print; exit}')
allow_headers=$(printf '%s\n' "${preflight}" | awk 'BEGIN{IGNORECASE=1} /^access-control-allow-headers:/ {sub(/\r$/,""); sub(/^[^:]+: */,""); print; exit}')

echo "==> Verdict (preflight)"
echo "    Access-Control-Allow-Origin:  ${allow_origin:-<missing>}"
echo "    Access-Control-Allow-Methods: ${allow_methods:-<missing>}"
echo "    Access-Control-Allow-Headers: ${allow_headers:-<missing>}"
if [[ -z "${allow_origin}" ]]; then
  echo "    --> CORS-BLOCKED for browser calls. Phase 0 fails: use the server-proxy fallback (plan §3)."
elif [[ "${allow_origin}" == "*" || "${allow_origin}" == "${ORIGIN}" ]]; then
  echo "    --> CORS OK from ${ORIGIN}. Client-side-direct architecture stands."
else
  echo "    --> Allowed origin is '${allow_origin}', not '${ORIGIN}'. Either move the spike to that origin or treat as blocked."
fi
echo

echo "==> 1b) WRITE preflight (OPTIONS for POST) — the real question for incident submit"
echo "        (header-only: no incident is created)"
echo
WRITE_URL="https://${HOST}/v3/team/${D4H_CONTEXT_ID}/incidents"
write_pf=$(curl -sS -i -X OPTIONS "${WRITE_URL}" \
  -H "Origin: ${ORIGIN}" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type")
echo "${write_pf}"
echo
w_origin=$(printf '%s\n' "${write_pf}" | awk 'BEGIN{IGNORECASE=1} /^access-control-allow-origin:/ {sub(/\r$/,""); sub(/^[^:]+: */,""); print; exit}')
w_methods=$(printf '%s\n' "${write_pf}" | awk 'BEGIN{IGNORECASE=1} /^access-control-allow-methods:/ {sub(/\r$/,""); sub(/^[^:]+: */,""); print; exit}')
echo "==> Verdict (WRITE preflight)"
echo "    Access-Control-Allow-Origin:  ${w_origin:-<missing>}"
echo "    Access-Control-Allow-Methods: ${w_methods:-<missing>}"
if [[ -z "${w_origin}" ]]; then
  echo "    --> WRITES CORS-BLOCKED. Build the server-proxy route for incident submit (PLAN §4A/§5)."
elif printf '%s' "${w_methods}" | grep -qiE 'post|\*' || [[ "${w_methods}" == "" && ( "${w_origin}" == "*" || "${w_origin}" == "${ORIGIN}" ) ]]; then
  echo "    --> WRITE CORS looks OK from ${ORIGIN}. Client-side incident submit is viable."
else
  echo "    --> Allow-Methods '${w_methods}' does not list POST. Treat writes as blocked → server proxy."
fi
echo "        (Confirm in a real browser with browser-test.html's WRITE button — the authoritative check.)"
echo

echo "==> 2) Real GET with Bearer token — confirms auth + captures response envelope"
echo
tmp=$(mktemp)
status=$(curl -sS -o "${tmp}" -w '%{http_code}' "${URL}" \
  -H "Origin: ${ORIGIN}" \
  -H "Authorization: Bearer ${D4H_TOKEN}" \
  -H "Accept: application/json")
echo "HTTP ${status}"
if command -v jq >/dev/null 2>&1; then
  jq '. | {keys: (keys // [] | .[0:10]), first_result: ((.results // .data // .members // [])[0])}' "${tmp}" 2>/dev/null \
    || head -c 2000 "${tmp}"
else
  head -c 2000 "${tmp}"
fi
echo
echo "==> Full response body saved to: ${tmp}"
