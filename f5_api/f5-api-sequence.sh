#!/usr/bin/env bash
# F5 BIG-IP DNS - iControl REST sequence (lab). Starlight Data Solutions.
# Same steps, same order as the Postman collection "F5 BIG-IP DNS - Sequence (lab)".
#
#   ./f5-api-sequence.sh            read-only steps 01-07, then sign out
#   ./f5-api-sequence.sh changes    also runs 08-12: creates, modifies and deletes LAB test objects
#
# Each block is also a plain curl you can paste into Postman (Import > Raw text).
# The password is asked for and never saved. Needs: curl, jq.
set -u
MODE="${1:-read}"

F5="${F5:-https://10.1.1.5}"
USERNAME="${USERNAME:-admin}"
read -r -s -p "F5 password for $USERNAME: " PASSWORD; echo
K="-k"                      # LAB ONLY: skips the self-signed certificate check. Use --cacert <ca.pem> elsewhere.

PARTITION="Portal_Lab"; DATACENTER="DC_Lab"; SERVER="srv_lab"; SERVER_IP="10.1.20.10"
VS_IP="10.1.20.11"; VS_IP2="10.1.20.12"; POOL="pool_lab_a"; WIDEIP="app.lab.example"

# ######## A. READ-ONLY SEQUENCE
# ================= 01 Sign in

echo; echo '--- 01.1 Login - get token'
TOKEN=$(curl -s $K -X POST "$F5/mgmt/shared/authn/login" -H "Content-Type: application/json" \
  -d '{"username":"'"$USERNAME"'","password":"'"$PASSWORD"'","loginProviderName":"tmos"}' | jq -r .token.token)
echo "token: ${TOKEN:0:6}..."

echo; echo '--- 01.2 Check token'
curl -s $K -X GET "$F5/mgmt/shared/authz/tokens/$TOKEN" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 01.3 Extend token to 1 hour'
curl -s $K -X PATCH "$F5/mgmt/shared/authz/tokens/$TOKEN" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"timeout": 3600}' \
  -w "\n[HTTP %{http_code}]\n"

# ================= Q Questions - run and send back the answers

echo; echo '--- Q.00 Reset answers'
curl -s $K -X GET "$F5/mgmt/shared/identified-devices/config/device-info?\$select=product" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q1 Is this a BIG-IP or a BIG-IQ, and which version?'
curl -s $K -X GET "$F5/mgmt/shared/identified-devices/config/device-info" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q2 Is the DNS (GTM) module switched on?'
curl -s $K -X GET "$F5/mgmt/tm/sys/provision?\$select=name,level" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q3 Which partitions already exist (is the lab shared)?'
curl -s $K -X GET "$F5/mgmt/tm/auth/partition?\$select=name" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q4 Which account and role are we using?'
curl -s $K -X GET "$F5/mgmt/tm/auth/user/$USERNAME" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q5 How many devices, and are they clustered?'
curl -s $K -X GET "$F5/mgmt/tm/cm/device?\$select=name,managementIp,failoverState,version" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q6 Config sync status'
curl -s $K -X GET "$F5/mgmt/tm/cm/sync-status" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q7 Is GTM sync on, and which sync group?'
curl -s $K -X GET "$F5/mgmt/tm/gtm/global-settings/general?\$select=synchronization,synchronizationGroupName,synchronizeZoneFiles" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q8 Which data centers and servers exist (other sites)?'
curl -s $K -X GET "$F5/mgmt/tm/gtm/server?\$select=name,datacenter,product,addresses" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q9 Which record objects are used: Wide IPs or DNS Express zones?'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/a?\$select=name,partition,pools" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q10 AAAA Wide IPs (IPv6)'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/aaaa?\$select=name,partition" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q11 DNS Express zones'
curl -s $K -X GET "$F5/mgmt/tm/ltm/dns/zone?\$select=name,dnsExpressServer" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q12 Do DNS profiles use local BIND (ZoneRunner)?'
curl -s $K -X GET "$F5/mgmt/tm/ltm/profile/dns?\$select=name,useLocalBind,enableDnsExpress,enableGtm" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q13 For several IPs: are pool members in different data centers?'
curl -s $K -X GET "$F5/mgmt/tm/gtm/pool/a?expandSubcollections=true&\$select=name,partition,membersReference" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q14 Management TLS and Basic auth settings'
curl -s $K -X GET "$F5/mgmt/tm/sys/httpd?\$select=sslProtocol,authPamIdleTimeout,maxClients" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q15 Licence: registration and dates'
curl -s $K -X GET "$F5/mgmt/tm/sys/license" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q16 Token lifetime (for the portal sign-in)'
curl -s $K -X GET "$F5/mgmt/shared/authz/tokens/$TOKEN" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- Q.99 Show all answers (open the Visualize tab)'
curl -s $K -X GET "$F5/mgmt/shared/identified-devices/config/device-info?\$select=product" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 02 Identify device

echo; echo '--- 02.1 BIG-IP or BIG-IQ'
curl -s $K -X GET "$F5/mgmt/shared/identified-devices/config/device-info" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 02.2 Software version'
curl -s $K -X GET "$F5/mgmt/tm/sys/version" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 02.3 Provisioned modules (gtm must be on)'
curl -s $K -X GET "$F5/mgmt/tm/sys/provision?\$select=name,level" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 02.4 Hostname'
curl -s $K -X GET "$F5/mgmt/tm/sys/global-settings?\$select=hostname" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 03 HA and sync

echo; echo '--- 03.1 Failover state'
curl -s $K -X GET "$F5/mgmt/tm/sys/failover" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 03.2 Devices'
curl -s $K -X GET "$F5/mgmt/tm/cm/device?\$select=name,managementIp,failoverState,version" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 03.3 Sync status'
curl -s $K -X GET "$F5/mgmt/tm/cm/sync-status" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 03.4 Device groups'
curl -s $K -X GET "$F5/mgmt/tm/cm/device-group?\$select=name,type,devices" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 03.5 GTM sync group'
curl -s $K -X GET "$F5/mgmt/tm/gtm/global-settings/general?\$select=synchronization,synchronizationGroupName" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 04 Monitoring

echo; echo '--- 04.1 CPU and memory'
curl -s $K -X GET "$F5/mgmt/tm/sys/host-info" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.2 Data center status'
curl -s $K -X GET "$F5/mgmt/tm/gtm/datacenter/stats" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.3 Server status'
curl -s $K -X GET "$F5/mgmt/tm/gtm/server/stats" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.4 A pool status'
curl -s $K -X GET "$F5/mgmt/tm/gtm/pool/a/stats" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 04.5 A Wide IP status and requests'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/a/stats" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 05 Partitions

echo; echo '--- 05.1 List partitions'
curl -s $K -X GET "$F5/mgmt/tm/auth/partition?\$select=name,description" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 05.2 Folders'
curl -s $K -X GET "$F5/mgmt/tm/sys/folder?\$select=name,fullPath" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 06 All data (global)

echo; echo '--- 06.1 Data centers'
curl -s $K -X GET "$F5/mgmt/tm/gtm/datacenter?\$select=name,location,enabled" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 06.2 Servers'
curl -s $K -X GET "$F5/mgmt/tm/gtm/server?\$select=name,datacenter,product,addresses" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 06.3 Servers with virtual servers'
curl -s $K -X GET "$F5/mgmt/tm/gtm/server?expandSubcollections=true" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 06.4 Listeners'
curl -s $K -X GET "$F5/mgmt/tm/gtm/listener" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 06.5 Monitors'
curl -s $K -X GET "$F5/mgmt/tm/gtm/monitor" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 06.6 Topology'
curl -s $K -X GET "$F5/mgmt/tm/gtm/topology" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 06.7 Regions'
curl -s $K -X GET "$F5/mgmt/tm/gtm/region" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 07 All data (every partition)

echo; echo '--- 07.1 A Wide IPs - all partitions'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/a?\$select=name,partition,pools,enabled" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.2 AAAA Wide IPs - all partitions'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/aaaa?\$select=name,partition,pools,enabled" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.3 A pools with members - all partitions'
curl -s $K -X GET "$F5/mgmt/tm/gtm/pool/a?expandSubcollections=true" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.4 AAAA pools with members - all partitions'
curl -s $K -X GET "$F5/mgmt/tm/gtm/pool/aaaa?expandSubcollections=true" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.5 A Wide IPs - one partition'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/a?\$filter=partition+eq+$PARTITION" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.6 A pools - one partition'
curl -s $K -X GET "$F5/mgmt/tm/gtm/pool/a?\$filter=partition+eq+$PARTITION&expandSubcollections=true" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.7 A Wide IPs - paging, first 100'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/a?\$top=100&\$skip=0" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.8 DNS Express zones'
curl -s $K -X GET "$F5/mgmt/tm/ltm/dns/zone" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 07.9 DNS nameservers'
curl -s $K -X GET "$F5/mgmt/tm/ltm/dns/nameserver" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

if [ "$MODE" = "changes" ]; then
# ######## B. CHANGE SEQUENCE (LAB ONLY)
# ================= 08 Create test objects (lab)

echo; echo '--- 08.1 Create partition'
curl -s $K -X POST "$F5/mgmt/tm/auth/partition" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$PARTITION"'"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 08.2 Create data center'
curl -s $K -X POST "$F5/mgmt/tm/gtm/datacenter" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$DATACENTER"'"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 08.3 Create server with 2 virtual servers'
curl -s $K -X POST "$F5/mgmt/tm/gtm/server" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$SERVER"'", "datacenter": "/Common/'"$DATACENTER"'", "product": "generic-host", "addresses": [{"name": "'"$SERVER_IP"'"}], "virtualServers": [{"name": "vs1", "destination": "'"$VS_IP"':80"}, {"name": "vs2", "destination": "'"$VS_IP2"':80"}]}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 08.4 Create A pool (one IP = one-to-one)'
curl -s $K -X POST "$F5/mgmt/tm/gtm/pool/a" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$POOL"'", "partition": "'"$PARTITION"'", "loadBalancingMode": "round-robin", "members": [{"name": "'"$SERVER"':vs1", "partition": "Common"}]}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 08.5 Create A Wide IP'
curl -s $K -X POST "$F5/mgmt/tm/gtm/wideip/a" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$WIDEIP"'", "partition": "'"$PARTITION"'", "pools": [{"name": "'"$POOL"'", "partition": "'"$PARTITION"'"}]}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 08.6 Read back Wide IP'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/a/~$PARTITION~$WIDEIP" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 09 Modify (lab)

echo; echo '--- 09.1 Add second IP (one-to-many)'
curl -s $K -X POST "$F5/mgmt/tm/gtm/pool/a/~$PARTITION~$POOL/members" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$SERVER"':vs2", "partition": "Common"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 09.2 Change load-balancing mode'
curl -s $K -X PATCH "$F5/mgmt/tm/gtm/pool/a/~$PARTITION~$POOL" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"loadBalancingMode": "global-availability"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 09.3 Disable Wide IP'
curl -s $K -X PATCH "$F5/mgmt/tm/gtm/wideip/a/~$PARTITION~$WIDEIP" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"disabled": true}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 09.4 Enable Wide IP'
curl -s $K -X PATCH "$F5/mgmt/tm/gtm/wideip/a/~$PARTITION~$WIDEIP" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 09.5 Read back pool with members'
curl -s $K -X GET "$F5/mgmt/tm/gtm/pool/a/~$PARTITION~$POOL?expandSubcollections=true" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 09.6 Remove second IP'
curl -s $K -X DELETE "$F5/mgmt/tm/gtm/pool/a/~$PARTITION~$POOL/members/~Common~$SERVER:vs2" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 10 Transaction (lab)

echo; echo '--- 10.1 Create transaction'
TRANS_ID=$(curl -s $K -X POST "$F5/mgmt/tm/transaction" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r .transId)
echo "transId: $TRANS_ID"

echo; echo '--- 10.2 Queue: create Wide IP'
curl -s $K -X POST "$F5/mgmt/tm/gtm/wideip/a" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "X-F5-REST-Coordination-Id: $TRANS_ID" \
  -H "Content-Type: application/json" \
  -d '{"name": "tx.'"$WIDEIP"'", "partition": "'"$PARTITION"'", "pools": [{"name": "'"$POOL"'", "partition": "'"$PARTITION"'"}]}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 10.3 Queued commands'
curl -s $K -X GET "$F5/mgmt/tm/transaction/$TRANS_ID/commands" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 10.4 Commit'
curl -s $K -X PATCH "$F5/mgmt/tm/transaction/$TRANS_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "VALIDATING"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 10.5 Transaction status'
curl -s $K -X GET "$F5/mgmt/tm/transaction/$TRANS_ID" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 11 Errors (expected)

echo; echo '--- 11.1 Not found - 404'
curl -s $K -X GET "$F5/mgmt/tm/gtm/wideip/a/~Common~does.not.exist.lab" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 11.2 Duplicate - 409'
curl -s $K -X POST "$F5/mgmt/tm/gtm/datacenter" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'"$DATACENTER"'"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 11.3 Wrong token - 401'
curl -s $K -X GET "$F5/mgmt/tm/sys/version" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: invalid-token" \
  -w "\n[HTTP %{http_code}]\n"

# ================= 12 Save, sync, clean up (lab)

echo; echo '--- 12.1 Save configuration'
curl -s $K -X POST "$F5/mgmt/tm/sys/config" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "save"}' \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 12.2 Sync status'
curl -s $K -X GET "$F5/mgmt/tm/cm/sync-status" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 12.3 Delete transaction Wide IP'
curl -s $K -X DELETE "$F5/mgmt/tm/gtm/wideip/a/~$PARTITION~tx.$WIDEIP" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 12.4 Delete Wide IP'
curl -s $K -X DELETE "$F5/mgmt/tm/gtm/wideip/a/~$PARTITION~$WIDEIP" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 12.5 Delete pool'
curl -s $K -X DELETE "$F5/mgmt/tm/gtm/pool/a/~$PARTITION~$POOL" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 12.6 Delete server'
curl -s $K -X DELETE "$F5/mgmt/tm/gtm/server/~Common~$SERVER" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 12.7 Delete data center'
curl -s $K -X DELETE "$F5/mgmt/tm/gtm/datacenter/~Common~$DATACENTER" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"

echo; echo '--- 12.8 Delete partition'
curl -s $K -X DELETE "$F5/mgmt/tm/auth/partition/$PARTITION" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"
fi

# ######## C. SIGN OUT
# ================= 13 Sign out

echo; echo '--- 13.1 Logout - delete token'
curl -s $K -X DELETE "$F5/mgmt/shared/authz/tokens/$TOKEN" \
  -H "Accept: application/json" \
  -H "X-F5-Auth-Token: $TOKEN" \
  -w "\n[HTTP %{http_code}]\n"
unset PASSWORD TOKEN

# ######## Z. OPTIONAL ONE-TIME STEPS (copy and run by hand)
# 
# # ================= Z1 Provision DNS (GTM) - lab, once
# 
# echo; echo '--- Z1.1 Switch on BIG-IP DNS (services restart)'
# curl -s -k -X PATCH "$F5/mgmt/tm/sys/provision/gtm" \
#   -H "Accept: application/json" \
#   -H "X-F5-Auth-Token: $TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{"level": "nominal"}' \
#   -w "\n[HTTP %{http_code}]\n"
# 
# # ================= Z2 Portal API user - once
# 
# echo; echo '--- Z2.1 Create portal API user'
# curl -s -k -X POST "$F5/mgmt/tm/auth/user" \
#   -H "Accept: application/json" \
#   -H "X-F5-Auth-Token: $TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{"name": "'"$API_USER"'", "password": "'"$API_USER_PASSWORD"'", "partitionAccess": [{"name": "all-partitions", "role": "manager"}]}' \
#   -w "\n[HTTP %{http_code}]\n"
# 
# # ================= Z3 BIG-IQ only (baseUrl = BIG-IQ)
# 
# echo; echo '--- Z3.1 BIG-IPs managed by this BIG-IQ'
# curl -s -k -X GET "$F5/mgmt/shared/resolver/device-groups/cm-bigip-allBigIpDevices/devices?\$select=hostname,address,product,version" \
#   -H "Accept: application/json" \
#   -H "X-F5-Auth-Token: $TOKEN" \
#   -w "\n[HTTP %{http_code}]\n"
