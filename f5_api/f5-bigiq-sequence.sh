#!/usr/bin/env bash
# F5 BIG-IQ DNS - REST sequence (lab). Starlight Data Solutions.
# Same steps as the Postman collection "F5 BIG-IQ DNS - Sequence (lab)". Use only if SBI manages
# the BIG-IP DNS devices through BIG-IQ. Steps marked [verify] are not yet tested on a lab BIG-IQ.
#
#   BIGIQ=https://<bigiq-address> ./f5-bigiq-sequence.sh            read-only steps 01-05, then sign out
#   BIGIQ=https://<bigiq-address> ./f5-bigiq-sequence.sh changes    also 06-11: create, deploy, modify, delete (LAB ONLY)
#
# The access token lasts 5 minutes. For a long manual session, renew it with step 01.2 (refresh token, 10 h).
# The password is asked for and never saved. Needs: curl, jq.
set -u
MODE="${1:-read}"

BIGIQ="${BIGIQ:?set BIGIQ=https://<bigiq-address>}"
USERNAME="${USERNAME:-admin}"
read -r -s -p "BIG-IQ password for $USERNAME: " PASSWORD; echo
K="-k"                      # LAB ONLY: skips the certificate check. Use --cacert <ca.pem> elsewhere.

PARTITION="Common"; DATACENTER="DC_Lab"; SERVER="srv_lab"; SERVER_IP="10.1.20.10"; VS_IP="10.1.20.11"
POOL="pool_lab_a"; WIDEIP="app.lab.example"
BIGIP_LINK=""; SYNC_GROUP_LINK="${SYNC_GROUP_LINK:-}"   # filled by steps 03.1 and 04.1, or set by hand

# ######## A. READ-ONLY SEQUENCE
# ================= 01 Sign in

echo; echo '--- 01.1 Login - access + refresh token'
LOGIN=$(curl -s $K -X POST "$BIGIQ/mgmt/shared/authn/login" -H "Content-Type: application/json" \
  -d '{"username":"'"$USERNAME"'","password":"'"$PASSWORD"'","loginProviderName":"tmos"}')
TOKEN=$(echo "$LOGIN" | jq -r .token.token); REFRESH_TOKEN=$(echo "$LOGIN" | jq -r .refreshToken.token)
echo "token: ${TOKEN:0:6}...  (access token 5 min, refresh token 10 h)"

echo; echo '--- 01.2 Exchange refresh token for a new access token'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/shared/authn/exchange" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": {"token": "'"$REFRESH_TOKEN"'"}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
TOKEN=$(echo "$OUT" | jq -r '.token.token // empty')

# ================= Q Questions - run and send back the answers

echo; echo '--- Q.00 Reset answers'
curl -s $K -X GET "$BIGIQ/mgmt/shared/identified-devices/config/device-info?\$select=product" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q1 Is this a BIG-IQ, and which version?'
curl -s $K -X GET "$BIGIQ/mgmt/shared/identified-devices/config/device-info" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q2 Which BIG-IPs does this BIG-IQ manage?'
curl -s $K -X GET "$BIGIQ/mgmt/shared/resolver/device-groups/cm-bigip-allBigIpDevices/devices?\$select=hostname,address,product,version" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q3 Which BIG-IPs are managed for DNS?'
curl -s $K -X GET "$BIGIQ/mgmt/shared/resolver/device-groups/cm-dns-allBigIpDevices/devices?\$select=hostname,address,version" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q4 Which device groups exist (DNS sync groups)?'
curl -s $K -X GET "$BIGIQ/mgmt/shared/resolver/device-groups?\$select=groupName" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q5 Which DNS sync group do the data centers use?'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/datacenter?\$select=name,deviceGroupReference" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q6 How many A / AAAA Wide IPs does BIG-IQ hold?'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/wideip/a?\$select=name,partition,poolReferences" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q7 AAAA Wide IPs (IPv6)'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/wideip/aaaa?\$select=name" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q8 How many A pools, and in which partitions?'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/pool/a?\$select=name,partition" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q9 Recent DNS deployments: do they succeed?'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration?\$orderby=lastUpdateMicros+desc&\$top=10&\$select=name,status,errorMessage" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q10 Token: access and refresh lifetimes'
curl -s $K -X GET "$BIGIQ/mgmt/shared/authz/tokens/$TOKEN" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q.99 Show all answers (open the Visualize tab)'
curl -s $K -X GET "$BIGIQ/mgmt/shared/identified-devices/config/device-info?\$select=product" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 02 Identify device

echo; echo '--- 02.1 BIG-IP or BIG-IQ (must say BIG-IQ)'
OUT=$(curl -s $K -X GET "$BIGIQ/mgmt/shared/identified-devices/config/device-info" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN")
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
PRODUCT=$(echo "$OUT" | jq -r '.product // empty')

echo; echo '--- 02.2 BIG-IQ software version'
curl -s $K -X GET "$BIGIQ/mgmt/shared/identified-devices/config/device-info?\$select=product,version,build,hostname" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 03 Managed BIG-IP devices

echo; echo '--- 03.1 All managed BIG-IPs'
OUT=$(curl -s $K -X GET "$BIGIQ/mgmt/shared/resolver/device-groups/cm-bigip-allBigIpDevices/devices?\$select=uuid,hostname,address,product,version,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN")
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
BIGIP_LINK=$(echo "$OUT" | jq -r '.items[0].selfLink // empty')

echo; echo '--- 03.2 BIG-IPs with DNS managed by BIG-IQ'
curl -s $K -X GET "$BIGIQ/mgmt/shared/resolver/device-groups/cm-dns-allBigIpDevices/devices?\$select=uuid,hostname,address,version,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 03.3 All device groups'
curl -s $K -X GET "$BIGIQ/mgmt/shared/resolver/device-groups?\$select=groupName,description,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 04 DNS data in BIG-IQ (working-config)

echo; echo '--- 04.1 Data centers'
OUT=$(curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/datacenter?\$select=id,name,enabled,deviceGroupReference,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN")
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
SYNC_GROUP_LINK=$(echo "$OUT" | jq -r '.items[0].deviceGroupReference.link // empty')

echo; echo '--- 04.2 Servers'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/server?\$select=id,name,product,datacenterReference,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.3 Listeners'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/listener" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.4 A pools'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/pool/a?\$select=id,name,partition,loadBalancingMode,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.5 AAAA pools'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/pool/aaaa?\$select=id,name,partition,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.6 A Wide IPs - all partitions'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/wideip/a?\$select=id,name,partition,enabled,poolReferences,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.7 AAAA Wide IPs'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/wideip/aaaa?\$select=id,name,partition,enabled,selfLink" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.8 A Wide IPs - one partition'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/wideip/a?\$filter=partition+eq+'$PARTITION'" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.9 A Wide IPs - paging, first 100'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/wideip/a?\$top=100&\$skip=0" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.10 Topology'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/topology" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.11 Regions'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/region" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 05 Deployments (history and status)

echo; echo '--- 05.1 Recent DNS deployments'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration?\$orderby=lastUpdateMicros+desc&\$top=10&\$select=id,name,status,currentStep,errorMessage,startDateTime" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 05.2 Recent self-service tasks'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/tasks/self-service?\$top=10" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

if [ "$MODE" = "changes" ]; then
  [ -n "$SYNC_GROUP_LINK" ] || { echo "SYNC_GROUP_LINK is empty: set it to the DNS sync group link"; exit 1; }
# ######## B. CHANGE AND DEPLOY SEQUENCE (LAB ONLY)
# ================= 06 Create in BIG-IQ working-config (lab)

echo; echo '--- 06.1 Create data center [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/working-config/datacenter" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$DATACENTER"'", "deviceGroupReference": {"link": "'"$SYNC_GROUP_LINK"'"}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
DC_ID=$(echo "$OUT" | jq -r '.id // empty'); DC_LINK=$(echo "$OUT" | jq -r '.selfLink // empty')

echo; echo '--- 06.2 Create server with one virtual server [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/working-config/server" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$SERVER"'", "product": "generic-host", "datacenterReference": {"link": "'"$DC_LINK"'"}, "addresses": [{"name": "'"$SERVER_IP"'"}], "deviceGroupReference": {"link": "'"$SYNC_GROUP_LINK"'"}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
SERVER_ID=$(echo "$OUT" | jq -r '.id // empty'); SERVER_LINK=$(echo "$OUT" | jq -r '.selfLink // empty')

echo; echo '--- 06.3 Add virtual server to server [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/working-config/server/$SERVER_ID/virtual-servers" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "vs1", "destination": "'"$VS_IP"':80"}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
VS_ID=$(echo "$OUT" | jq -r '.id // empty'); VS_LINK=$(echo "$OUT" | jq -r '.selfLink // empty')

echo; echo '--- 06.4 Create A pool [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/working-config/pool/a" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$POOL"'", "partition": "'"$PARTITION"'", "loadBalancingMode": "round-robin", "deviceGroupReference": {"link": "'"$SYNC_GROUP_LINK"'"}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
POOL_ID=$(echo "$OUT" | jq -r '.id // empty'); POOL_LINK=$(echo "$OUT" | jq -r '.selfLink // empty')

echo; echo '--- 06.5 Add pool member (virtual server) [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/working-config/pool/a/$POOL_ID/members" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "vs1", "serverReference": {"link": "'"$SERVER_LINK"'"}, "enabled": true, "deviceGroupReference": {"link": "'"$SYNC_GROUP_LINK"'"}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
MEMBER_ID=$(echo "$OUT" | jq -r '.id // empty'); MEMBER_LINK=$(echo "$OUT" | jq -r '.selfLink // empty')

echo; echo '--- 06.6 Create A Wide IP [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/working-config/wideip/a" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$WIDEIP"'", "partition": "'"$PARTITION"'", "enabled": true, "poolReferences": [{"poolReference": {"link": "'"$POOL_LINK"'"}, "order": 0, "ratio": 1}], "deviceGroupReference": {"link": "'"$SYNC_GROUP_LINK"'"}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
WIDEIP_ID=$(echo "$OUT" | jq -r '.id // empty'); WIDEIP_LINK=$(echo "$OUT" | jq -r '.selfLink // empty')

echo; echo '--- 06.7 Read back Wide IP'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/wideip/a/$WIDEIP_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 07 Deploy to BIG-IP (evaluate, then deploy)

echo; echo '--- 07.1 Evaluate only (no change on BIG-IP) [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "portal-'"$WIDEIP"'", "skipDistribution": true, "deviceGroupReferences": [{"link": "'"$SYNC_GROUP_LINK"'"}], "objectsToDeployReferences": [{"link": "'"$WIDEIP_LINK"'"}], "properties": {"DnsPropertiesBag": {"dnsDistributeMode": "SYNC_GROUP"}}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
DEPLOY_ID=$(echo "$OUT" | jq -r '.id // empty')

echo; echo '--- 07.2 Evaluation status and differences'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration/$DEPLOY_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.3 Deploy the evaluated changes [verify]'
curl -s $K -X PATCH "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration/$DEPLOY_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"skipDistribution": false, "status": "STARTED"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.4 Deployment status (poll until FINISHED / FAILED)'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration/$DEPLOY_ID?\$select=status,currentStep,errorMessage" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 08 Enable / disable (self-service)

echo; echo '--- 08.1 Disable Wide IP on the BIG-IPs'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/tasks/self-service" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "disable-'"$WIDEIP"'", "resourceReference": {"link": "'"$WIDEIP_LINK"'"}, "operation": "disable"}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
SELF_SERVICE_ID=$(echo "$OUT" | jq -r '.id // empty')

echo; echo '--- 08.2 Self-service task status'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/tasks/self-service/$SELF_SERVICE_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 08.3 Enable Wide IP on the BIG-IPs'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/tasks/self-service" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "enable-'"$WIDEIP"'", "resourceReference": {"link": "'"$WIDEIP_LINK"'"}, "operation": "enable"}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
SELF_SERVICE_ID=$(echo "$OUT" | jq -r '.id // empty')

# ================= 09 Modify and redeploy (lab)

echo; echo '--- 09.1 Change pool load-balancing mode'
curl -s $K -X PATCH "$BIGIQ/mgmt/cm/dns/working-config/pool/a/$POOL_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"loadBalancingMode": "global-availability"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 09.2 Deploy the change [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "portal-modify-'"$POOL"'", "deviceGroupReferences": [{"link": "'"$SYNC_GROUP_LINK"'"}], "objectsToDeployReferences": [{"link": "'"$POOL_LINK"'"}], "properties": {"DnsPropertiesBag": {"dnsDistributeMode": "SYNC_GROUP"}}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
DEPLOY_ID=$(echo "$OUT" | jq -r '.id // empty')

echo; echo '--- 09.3 Deployment status'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration/$DEPLOY_ID?\$select=status,currentStep,errorMessage" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 10 Errors (expected)

echo; echo '--- 10.1 Not found - 404'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/working-config/wideip/a/00000000-0000-0000-0000-000000000000" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 10.2 Wrong token - 401'
curl -s $K -X GET "$BIGIQ/mgmt/shared/identified-devices/config/device-info" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: invalid-token" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 11 Clean up and deploy the removal (lab)

echo; echo '--- 11.1 Delete Wide IP'
curl -s $K -X DELETE "$BIGIQ/mgmt/cm/dns/working-config/wideip/a/$WIDEIP_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 11.2 Delete pool'
curl -s $K -X DELETE "$BIGIQ/mgmt/cm/dns/working-config/pool/a/$POOL_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 11.3 Delete server'
curl -s $K -X DELETE "$BIGIQ/mgmt/cm/dns/working-config/server/$SERVER_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 11.4 Delete data center'
curl -s $K -X DELETE "$BIGIQ/mgmt/cm/dns/working-config/datacenter/$DC_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 11.5 Full deploy to remove them from the BIG-IPs [verify]'
OUT=$(curl -s $K -X POST "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "portal-cleanup", "deviceGroupReferences": [{"link": "'"$SYNC_GROUP_LINK"'"}], "properties": {"DnsPropertiesBag": {"dnsDistributeMode": "SYNC_GROUP"}}}')
echo "$OUT" | jq -c . 2>/dev/null || echo "$OUT"
DEPLOY_ID=$(echo "$OUT" | jq -r '.id // empty')

echo; echo '--- 11.6 Deployment status'
curl -s $K -X GET "$BIGIQ/mgmt/cm/dns/tasks/deploy-configuration/$DEPLOY_ID?\$select=status,currentStep,errorMessage" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"
fi

# ######## C. SIGN OUT
# ================= 12 Sign out

echo; echo '--- 12.1 Logout - delete access token'
curl -s $K -X DELETE "$BIGIQ/mgmt/shared/authz/tokens/$TOKEN" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"
unset PASSWORD TOKEN REFRESH_TOKEN
