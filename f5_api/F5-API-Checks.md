# F5 BIG-IP DNS API checks: curl commands, requests and expected output

Starlight Data Solutions · DNS Management Portal · 05-Nov-2026
Target: F5 BIG-IP DNS (GTM) 16.1 at DC, DR and AZ, through the iControl REST API.

These checks show which F5 APIs work on the Bank's devices and what they return, before the portal uses them.

- Sections 1–9 **change nothing on the F5**. They are GET requests, plus the login (POST) and deleting your own login token (DELETE).
- **Appendix A** creates and deletes one test object. Run it on **UAT only**, with the F5 admin's agreement.
- The same checks, run in one go with every answer saved to files: `f5-api-check.sh` in this folder (see section 10).

Where each item comes from:

| Tag | Meaning |
|---|---|
| **[Guide p.N]** | Stated in the iControl REST User Guide 16.1 from Starlight (page N) |
| **[GTM ref]** | Listed in F5's online GTM API reference (`APIRef_tm_gtm`) |
| **[Rule]** | Follows a rule in the guide, for example "add `/stats` to get what `tmsh show` shows" (p.32). The exact field names still need to be seen on a real device. |
| **[Not in docs]** | Not in the documents we received. Run it and tell us the HTTP code: that is the answer. |

All JSON below is example output, shortened. Names, IPs and counts will differ on the Bank's devices.

---

## 0. Before you start

Run these in **Git Bash** on Windows, or on a Linux jump host that can reach the F5 management address (port 443).

```bash
F5=https://<f5-management-address>        # e.g. the DC BIG-IP DNS management IP
F5_USER=<f5-username>                     # ideally a read-only account
read -s -p "F5 password: " F5_PASS; echo  # typed password is not shown
TLS="--cacert f5-mgmt-ca.pem"             # the F5 management certificate or its CA (PEM)
# TLS=-k                                  # lab only: -k skips the certificate check. Never use it for production.
```

Notes:
- `-s` hides curl's progress bar. To see why a call fails, use `-v` instead.
- To read JSON more easily, add `| python -m json.tool` (or `| jq .`) at the end of any command.
- Inside double quotes, `$select`, `$filter` and `$top` must be written `\$select`, `\$filter`, `\$top`. Otherwise bash treats them as variables [Guide p.27].
- Reference: F5 uses `~` in place of `/` in object names in URLs, so `/Common/my-pool` becomes `~Common~my-pool` [Guide p.12].

---

## 1. Is the REST API reachable?

**Request:** `GET /mgmt/tm/sys/version`, with no credentials.

```bash
curl -s $TLS -o /dev/null -w "%{http_code}\n" "$F5/mgmt/tm/sys/version"
```

**Expected:** `401`. The API is up and refuses calls without a login [Guide p.124].

| You get | Meaning |
|---|---|
| `000` | No connection: wrong address, firewall, or the certificate was rejected. Rerun with `-v`. |
| `200` | Basic authentication may be on. Tell us: the guide recommends turning it off (`httpd.basic_auth`) [Guide p.19]. |

---

## 2. Log in and get a token

**Request** [Guide p.20]:
```
POST /mgmt/shared/authn/login
Content-Type: application/json

{ "username": "<user>", "password": "<password>", "loginProviderName": "tmos" }
```

```bash
curl -s $TLS -X POST "$F5/mgmt/shared/authn/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$F5_USER\",\"password\":\"$F5_PASS\",\"loginProviderName\":\"tmos\"}"; echo
```

**Expected:** HTTP 200. The response has the same shape as [Guide p.22]:
```json
{
  "username": "portal-monitor",
  "loginProviderName": "tmos",
  "token": {
    "token": "492D3316E5456378B4AC9B5E2FA923595F0DA65A",
    "name": "492D3316E5456378B4AC9B5E2FA923595F0DA65A",
    "userName": "portal-monitor",
    "timeout": 1200,
    "startTime": "2026-11-05T10:14:34.305+0530",
    "partition": "[All]",
    "expirationMicros": 1793866074305000,
    "kind": "shared:authz:tokens:authtokenitemstate",
    "selfLink": "https://localhost/mgmt/shared/authz/tokens/492D3316E5456378B4AC9B5E2FA923595F0DA65A"
  }
}
```

Save the token for the next calls:
```bash
TOKEN=<paste the value of token.token>
# or extract it automatically:
TOKEN=$(curl -s $TLS -X POST "$F5/mgmt/shared/authn/login" -H "Content-Type: application/json" \
  -d "{\"username\":\"$F5_USER\",\"password\":\"$F5_PASS\",\"loginProviderName\":\"tmos\"}" \
  | grep -oE '"token" *: *"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/'); echo "token length: ${#TOKEN}"
```
If the password contains `"` or `\`, these login commands send broken JSON and you get `400` or `401`. In that case use the script in section 10, which handles those characters.

**Note down:**
- `timeout`: how long the token lasts, in seconds. The guide's text says 8 hours (p.20), but its example shows 1200 seconds, which is 20 minutes (p.22). We need the Bank's real value.
- `partition`: which F5 partitions this account can see. The portal's monitoring account should show `[All]`.
- `401` here means a wrong username or password, or the account is a remote one (LDAP/TACACS) that needs a different `loginProviderName`. Ask the F5 admin.

Every call below sends the token in the header `X-F5-Auth-Token` [Guide p.20, p.22].

---

## 3. Device checks

### 3.1 Software version
**Request:** `GET /mgmt/tm/sys/version`

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/sys/version"; echo
```
**Expected:** HTTP 200, in the statistics format ("entries" → "nestedStats" → "entries") [Guide p.32–35]:
```json
{
  "kind": "tm:sys:version:versionstats",
  "selfLink": "https://localhost/mgmt/tm/sys/version?ver=16.1.x",
  "entries": {
    "https://localhost/mgmt/tm/sys/version/0": {
      "nestedStats": {
        "entries": {
          "Build":   { "description": "0.0.x" },
          "Edition": { "description": "Point Release x" },
          "Product": { "description": "BIG-IP" },
          "Title":   { "description": "Main Package" },
          "Version": { "description": "16.1.x" }
        }
      }
    }
  }
}
```
**Look for:** `Version` 16.1.x.

### 3.2 Which modules are switched on
**Request:** `GET /mgmt/tm/sys/provision?$select=name,level` (`$select` returns only these fields [Guide p.26]).

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/sys/provision?\$select=name,level"; echo
```
**Expected:** HTTP 200.
```json
{
  "kind": "tm:sys:provision:provisioncollectionstate",
  "items": [
    { "name": "gtm", "level": "nominal" },
    { "name": "ltm", "level": "nominal" },
    { "name": "asm", "level": "none" }
  ]
}
```
**Look for:** `gtm` must not be `none`. A module that is not switched on does not appear in the API [Guide p.25].

### 3.3 Device name, management IP, active or standby
**Request:** `GET /mgmt/tm/cm/device`

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/cm/device"; echo
```
**Expected:** HTTP 200. There is one item per device that this F5 knows; `selfDevice` marks the one you are talking to.
```json
{
  "kind": "tm:cm:device:devicecollectionstate",
  "items": [
    {
      "name": "gtm-dc-01.bank.local",
      "hostname": "gtm-dc-01.bank.local",
      "managementIp": "10.x.x.x",
      "failoverState": "active",
      "version": "16.1.x",
      "build": "0.0.x",
      "selfDevice": "true"
    }
  ]
}
```
**Look for:** `failoverState` (`active` / `standby`). How many items appear tells us whether each site is one device or a pair.

### 3.4 Configuration sync status
**Request:** `GET /mgmt/tm/cm/sync-status` [Rule]

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/cm/sync-status"; echo
```
**Expected:** HTTP 200, in the statistics format.
```json
{
  "entries": {
    "https://localhost/mgmt/tm/cm/sync-status/0": {
      "nestedStats": {
        "entries": {
          "color":   { "description": "green" },
          "mode":    { "description": "high-availability" },
          "status":  { "description": "In Sync" },
          "summary": { "description": "..." }
        }
      }
    }
  }
}
```
**Look for:** `status`, for example `In Sync`, `Standalone` or `Changes Pending`. This is the device-group sync. Sync between BIG-IP DNS devices at DC, DR and AZ is covered in section 7 (first row).

### 3.5 CPU and memory (optional)
**Request:** `GET /mgmt/tm/sys/host-info` [Rule]

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/sys/host-info"; echo
```
**Expected:** HTTP 200, statistics format. **Look for** fields such as `cpuCount`, `memoryTotal` and `memoryUsed`. A `404` here is fine; just tell us.

---

## 4. Partitions

**Request:** `GET /mgmt/tm/sys/folder?$select=name,fullPath`. Every partition has a folder [Guide p.40].

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/sys/folder?\$select=name,fullPath"; echo
```
**Expected:** HTTP 200.
```json
{
  "items": [
    { "name": "/",                "fullPath": "/" },
    { "name": "Common",           "fullPath": "/Common" },
    { "name": "Internet_Banking", "fullPath": "/Internet_Banking" }
  ]
}
```
**Look for:** whether the Bank uses partitions besides `Common`, and what they are called. This tells us how the portal's partitions should map to F5.

---

## 5. BIG-IP DNS (GTM) configuration

### 5.1 What the GTM module offers on this device
**Request:** `GET /mgmt/tm/gtm`. Lists the GTM collections [Guide p.22–25].

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm"; echo
```
**Expected:** HTTP 200, a list of links:
```json
{
  "kind": "tm:gtm:gtmcollectionstate",
  "items": [
    { "reference": { "link": "https://localhost/mgmt/tm/gtm/datacenter?ver=16.1.x" } },
    { "reference": { "link": "https://localhost/mgmt/tm/gtm/server?ver=16.1.x" } },
    { "reference": { "link": "https://localhost/mgmt/tm/gtm/wideip?ver=16.1.x" } },
    { "reference": { "link": "https://localhost/mgmt/tm/gtm/pool?ver=16.1.x" } },
    { "reference": { "link": "https://localhost/mgmt/tm/gtm/listener?ver=16.1.x" } }
  ]
}
```
**Look for:** the full list. F5's GTM reference lists datacenter, distributed-app, global-settings, link, listener, monitor, persist, pool, prober-pool, region, rule, server, topology and wideip [GTM ref]. Tell us anything that is extra or missing.

### 5.2 Data centres
**Request:** `GET /mgmt/tm/gtm/datacenter` [GTM ref]

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/datacenter"; echo
```
**Expected:** HTTP 200.
```json
{ "items": [
  { "name": "DC", "partition": "Common", "fullPath": "/Common/DC", "enabled": true, "location": "..." },
  { "name": "DR", "partition": "Common", "fullPath": "/Common/DR", "enabled": true },
  { "name": "AZ", "partition": "Common", "fullPath": "/Common/AZ", "enabled": true }
] }
```

### 5.3 Servers (the BIG-IPs and other servers that BIG-IP DNS checks)
**Request:** `GET /mgmt/tm/gtm/server` [GTM ref]

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/server"; echo
```
**Expected:** HTTP 200.
```json
{ "items": [
  { "name": "ltm-dc-01", "partition": "Common", "fullPath": "/Common/ltm-dc-01",
    "datacenter": "/Common/DC", "product": "bigip", "monitor": "/Common/bigip",
    "virtualServerDiscovery": "disabled",
    "devicesReference":        { "link": "https://localhost/mgmt/tm/gtm/server/~Common~ltm-dc-01/devices", "isSubcollection": true },
    "virtualServersReference": { "link": "https://localhost/mgmt/tm/gtm/server/~Common~ltm-dc-01/virtual-servers", "isSubcollection": true } }
] }
```

### 5.4 Virtual servers of one server
**Request:** `GET /mgmt/tm/gtm/server/~Common~<server-name>/virtual-servers`

```bash
SERVER=ltm-dc-01   # a name from 5.3
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/server/~Common~$SERVER/virtual-servers"; echo
```
**Expected:** HTTP 200, with items that include `name` and `destination` (IP:port). These are the answers that wide IPs can give.

### 5.5 Wide IPs: type A (IPv4 names)
**Request:** `GET /mgmt/tm/gtm/wideip/a` [GTM ref]

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/a"; echo
```
**Expected:** HTTP 200.
```json
{ "items": [
  { "name": "netbanking.bank.example", "partition": "Common", "fullPath": "/Common/netbanking.bank.example",
    "enabled": true, "poolLbMode": "round-robin", "ttlPersistence": 3600,
    "pools": [ { "name": "pool_netbanking", "partition": "Common", "order": 0, "ratio": 1 } ] }
] }
```
**Look for:** the partition the DNS names are in, and the naming style of the pools.

### 5.6 Wide IPs: type AAAA (IPv6 names)
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/aaaa"; echo
```
**Expected:** HTTP 200, the same shape as 5.5. An empty `items` list means there are no IPv6 wide IPs yet.

### 5.7 Pools: type A, with members
**Request:** `GET /mgmt/tm/gtm/pool/a?expandSubcollections=true`. `expandSubcollections` includes the members [Guide p.28–31].

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/pool/a?expandSubcollections=true"; echo
```
**Expected:** HTTP 200.
```json
{ "items": [
  { "name": "pool_netbanking", "partition": "Common", "fullPath": "/Common/pool_netbanking",
    "loadBalancingMode": "round-robin", "ttl": 30, "maxAnswersReturned": 1, "monitor": "default",
    "membersReference": { "isSubcollection": true, "items": [
      { "name": "ltm-dc-01:/Common/vs_netbanking", "partition": "Common", "enabled": true, "ratio": 1, "memberOrder": 0 }
    ] } }
] }
```
Since version 11.6 the member field `order` is called `member-order` (`memberOrder` in REST) [Guide p.6].

### 5.8 Pools: type AAAA
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/pool/aaaa?expandSubcollections=true"; echo
```
**Expected:** HTTP 200, the same shape as 5.7.

### 5.9 DNS listeners
**Request:** `GET /mgmt/tm/gtm/listener` [GTM ref]

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/listener"; echo
```
**Expected:** HTTP 200, one item per listener, showing the address and port (normally 53) on which the F5 answers DNS.

### 5.10 Query options: first 2 items, selected fields
**Request:** `GET /mgmt/tm/gtm/wideip/a?$top=2&$select=name,partition,fullPath` [Guide p.25–28]

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/a?\$top=2&\$select=name,partition,fullPath"; echo
```
**Expected:** HTTP 200, at most 2 items. Paging fields such as `totalItems`, `pageIndex`, `totalPages` and `nextLink` may also appear [Guide p.25, p.27].

### 5.11 Query options: one partition only
**Request:** `GET /mgmt/tm/gtm/wideip/a?$filter=partition eq Common`. Only `eq` is supported, and only for the partition [Guide p.26, p.31].

```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/a?\$filter=partition%20eq%20Common&\$select=name,partition"; echo
```
**Expected:** HTTP 200, only the wide IPs in `Common`. Replace `Common` with a Bank partition from check 4 to try that partition.

---

## 6. Monitoring: status and statistics

Adding `/stats` to a URL returns what `tmsh show` shows [Guide p.32]. Each object comes back as one entry with these status fields (the same names as the guide's LTM example on p.33–35):

| Field | Values | Portal shows |
|---|---|---|
| `status.availabilityState` | `available`, `offline`, `unknown` | Up / Down / Not checked |
| `status.enabledState` | `enabled`, `disabled` | Enabled / Disabled |
| `status.statusReason` | text | the reason, as written |

### 6.1 Data centre status
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/datacenter/stats"; echo
```

### 6.2 Server status
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/server/stats"; echo
```
**Expected for 6.1–6.6:** HTTP 200, for example [Rule]:
```json
{
  "kind": "tm:gtm:server:serverstats",
  "entries": {
    "https://localhost/mgmt/tm/gtm/server/~Common~ltm-dc-01/stats": {
      "nestedStats": {
        "entries": {
          "tmName":                   { "description": "/Common/ltm-dc-01" },
          "status.availabilityState": { "description": "available" },
          "status.enabledState":      { "description": "enabled" },
          "status.statusReason":      { "description": "..." }
        }
      }
    }
  }
}
```

### 6.3 Wide IP status and request counts: type A
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/a/stats"; echo
```
**Look for:** the three status fields, plus counters such as request counts. Send us the counter names you see.

### 6.4 Wide IP status: type AAAA
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/aaaa/stats"; echo
```

### 6.5 Pool status: type A
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/pool/a/stats"; echo
```

### 6.6 Pool status: type AAAA
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/pool/aaaa/stats"; echo
```

### 6.7 One wide IP only
```bash
WIP="~Common~netbanking.bank.example"   # fullPath from 5.5 with / replaced by ~
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/a/$WIP/stats"; echo
```
**Expected:** HTTP 200, the same entry as in 6.3 for this one name. The portal will use this to show the live status of one DNS name.

---

## 7. Unknowns: the HTTP code is the answer [Not in docs]

| # | Command | What we learn |
|---|---|---|
| 7.1 | `curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/iquery"; echo` | Whether the iQuery connections between the BIG-IP DNS devices (how DC, DR and AZ share status and sync) can be read over REST |
| 7.2 | `curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/ltm/dns/zone"; echo` | Whether DNS zones (DNS Express) exist on the F5 |
| 7.3 | `curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/shared/appsvcs/info"; echo` | Whether AS3 is installed (`404` = not installed). If the Bank uses AS3, direct API changes can be overwritten by AS3 [AS3 GSLB page] |

**Important open point: PTR and plain zone records.** The GTM reference has wide IPs only for the types A, AAAA, CNAME, MX, NAPTR and SRV. It has **no PTR type and no ZoneRunner (zone record) API** [GTM ref]. We need F5 or the Bank to tell us where the Bank's A, AAAA and PTR records live today: ZoneRunner on the BIG-IP, wide IPs, or another DNS server.

---

## 8. Error behaviour

### 8.1 Object that does not exist
```bash
curl -s $TLS -w "\nHTTP %{http_code}\n" -H "X-F5-Auth-Token: $TOKEN" \
  "$F5/mgmt/tm/gtm/wideip/a/~Common~portal-check-does-not-exist.example"
```
**Expected:** `HTTP 404`, with a JSON error body like [Guide p.37, p.124]:
```json
{ "code": 404, "message": "...", "errorStack": [] }
```
The portal will show F5's `message` text to the user.

### 8.2 Wrong token
```bash
curl -s $TLS -o /dev/null -w "%{http_code}\n" -H "X-F5-Auth-Token: INVALID0TOKEN0FOR0TEST" "$F5/mgmt/tm/sys/version"
```
**Expected:** `401`. When the portal gets this, it logs in again.

### 8.3 Expired token (optional)
Rerun check 3.1 after the `timeout` from check 2 has passed. **Expected:** `401`.

---

## 9. Log out: delete your own token [Not in docs]
The token's own address appears as `selfLink` in the login answer [Guide p.22]. Deleting it should end the login early.
```bash
curl -s $TLS -X DELETE -o /dev/null -w "%{http_code}\n" -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/shared/authz/tokens/$TOKEN"
```
**Expected:** `200`. After that, check 3.1 with the same token should return `401`. Tell us the codes you get. This decides whether the portal can log out cleanly or must wait for tokens to expire.

---

## 10. Run all of the above in one go (optional)

```bash
chmod +x f5-api-check.sh
./f5-api-check.sh https://<f5-management-address> <f5-username> --cacert f5-mgmt-ca.pem
```
The script asks for the password, runs everything in sections 1–9 and prints a table: HTTP code, expected code, OK or CHECK. It saves every answer in a new folder `f5-check-<address>-<date-time>/`. The token is masked in every saved file; the password is never written. Run it once per site (DC, DR, AZ).

---

## 11. Other F5 APIs (only if they apply)

### 11.1 Basic authentication still on?
`-u` with only the username makes curl ask for the password.
```bash
curl -s $TLS -u "$F5_USER" -o /dev/null -w "%{http_code}\n" "$F5/mgmt/tm/sys/version"
```
`200` means basic authentication is on, `401` means it is off. The portal uses tokens either way. The guide recommends switching basic authentication off [Guide p.19].

### 11.2 BIG-IQ (only if the Bank manages BIG-IP DNS through BIG-IQ)
The login is the same as in check 2, but on the BIG-IQ address with `"loginProviderName": "local"`. BIG-IQ's documentation says its token lasts 300 seconds [BIG-IQ API docs].
```bash
BIGIQ=https://<bigiq-address>
curl -s $TLS -H "X-F5-Auth-Token: $BIGIQ_TOKEN" "$BIGIQ/mgmt/cm/dns/working-config/wideip/a"; echo
```
**Expected:** HTTP 200, with wide IPs and the `deviceGroupReference` (DNS sync group) each is deployed to.

### 11.3 VELOS chassis health (only if BIG-IP DNS runs on VELOS and chassis health should appear in the portal)
This is a different API (F5OS) on the **system controller** address, port **8888**, with a separate F5OS account. F5's VELOS training pages show basic authentication and this header:
```bash
VELOS=https://<system-controller-address>:8888
H='Accept: application/yang-data+json'
curl -s $TLS -u "<f5os-user>" -H "$H" "$VELOS/restconf/data/openconfig-platform:components/component=chassis"; echo
curl -s $TLS -u "<f5os-user>" -H "$H" "$VELOS/restconf/data/openconfig-platform:components/component=controller-1"; echo
curl -s $TLS -u "<f5os-user>" -H "$H" "$VELOS/restconf/data/openconfig-platform:components/component=fantray-1"; echo
curl -s $TLS -u "<f5os-user>" -H "$H" "$VELOS/restconf/data/openconfig-platform:components/component=psu-1"; echo
curl -s $TLS -u "<f5os-user>" -H "$H" "$VELOS/restconf/data/openconfig-platform:components/component=blade-1"; echo
curl -s $TLS -u "<f5os-user>" -H "$H" "$VELOS/restconf/data/f5-chassis-cluster:cluster"; echo
```
**Expected:** HTTP 200 for each. The controller entry shows CPU, memory and temperature; the fan tray shows fan speeds; the cluster entry shows whether the controllers and blades are ready. F5's training pages do not show the paths for active alarms or tenant status, so we still need those.

---

## 12. What to send back

Run sections 1–9 once per site and fill in this table, or send the `00-summary.txt` and JSON files from the script. Look through them first: they contain F5 names and internal IP addresses, but no password or token.

| Check | DC | DR | AZ | Notes |
|---|---|---|---|---|
| 1 Reachable (401) | | | | |
| 2 Login (200), token `timeout`, `partition` | | | | |
| 3.1 Version | | | | |
| 3.2 gtm provisioned | | | | |
| 3.3 Device(s), failoverState | | | | |
| 3.4 Sync status | | | | |
| 4 Partitions | | | | |
| 5.x GTM config (200?) | | | | |
| 6.x Stats (200?) | | | | |
| 7 iQuery / DNS zone / AS3 codes | | | | |
| 8 Error codes (404, 401) | | | | |
| 9 Token delete code | | | | |

Please also answer:
1. Where do the Bank's A, AAAA and **PTR** records live today: ZoneRunner, wide IPs, or another DNS server? (See section 7.)
2. Are the BIG-IP DNS devices at DC, DR and AZ in **one sync group**, so that a change made on one is copied to the others?
3. Is there a **read-only** F5 account for portal monitoring, and a separate **change** account for later?
4. Is AS3 or BIG-IQ used to manage BIG-IP DNS today?
5. Which certificate or CA should the portal trust for the F5 management addresses?

---

## Appendix A: UAT only, write test (later, with a change account)

This creates one test wide IP inside a **transaction**: several steps applied together as one unit, or not at all [Guide p.43–46]. It then deletes the test wide IP. Use a name the F5 admin agrees to.

```bash
NAME=portal-api-test.bank.example
```

**A1. Start a transaction.** `POST /mgmt/tm/transaction` with body `{}` [Guide p.44]
```bash
curl -s $TLS -X POST -H "X-F5-Auth-Token: $TOKEN" -H "Content-Type: application/json" -d '{}' "$F5/mgmt/tm/transaction"; echo
```
Expected: `{"transId":1389812351,"state":"STARTED","timeoutSeconds":120,...}`. You have **120 seconds** to add steps.
```bash
TX=<transId>
```

**A2. Add "create wide IP" to the transaction.** The header `X-F5-REST-Coordination-Id` puts the request into the transaction instead of running it [Guide p.45].
```bash
curl -s $TLS -X POST -H "X-F5-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  -H "X-F5-REST-Coordination-Id: $TX" -d "{\"name\":\"$NAME\",\"partition\":\"Common\"}" \
  "$F5/mgmt/tm/gtm/wideip/a"; echo
```
Expected: the transaction again, with `"state":"STARTED"`. Nothing has been created yet.

**A3. Dry run (optional).** `validateOnly` checks the transaction without changing anything [Guide p.44].
```bash
curl -s $TLS -X PATCH -H "X-F5-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"state":"VALIDATING","validateOnly":true}' "$F5/mgmt/tm/transaction/$TX"; echo
```
Expected: HTTP 200 if the change would work. To really apply it, repeat A1–A2 in a new transaction and go on to A4.

**A4. Apply (commit).** [Guide p.46]
```bash
curl -s $TLS -X PATCH -H "X-F5-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"state":"VALIDATING"}' "$F5/mgmt/tm/transaction/$TX"; echo
```
Expected: HTTP 200, `"state":"COMPLETED"`. If any step fails, F5 undoes all of them.

**A5. Check that the wide IP exists**, on this site and on the other sites (this answers question 2):
```bash
curl -s $TLS -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/a/~Common~$NAME"; echo
```

**A6. Delete the test wide IP.** [Guide p.13]
```bash
curl -s $TLS -X DELETE -o /dev/null -w "%{http_code}\n" -H "X-F5-Auth-Token: $TOKEN" "$F5/mgmt/tm/gtm/wideip/a/~Common~$NAME"
```
Expected: `200` with no body [Guide p.40].

**A7. Save the configuration.** Changes made through the API are live straight away; `save` also writes them to the saved configuration [Guide p.54].
```bash
curl -s $TLS -X POST -H "X-F5-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"command":"save"}' "$F5/mgmt/tm/sys/config"; echo
```

---

## Appendix B: HTTP codes [Guide p.124–125]

| Code | Meaning |
|---|---|
| 200 | Success |
| 400 | Bad request: malformed request or wrong resource name |
| 401 | Not logged in, wrong or expired token, or not enough rights |
| 403 | Not allowed, or an unsupported action (e.g. deleting a property) |
| 404 | The object or URL does not exist |
| 409 | Conflict: the object already exists (create) |
| 415 | Wrong Content-Type, or malformed JSON |
| 500 | F5's REST service is not running or has failed |
| 501 | The URL or tmsh command is not supported |

On the F5 itself, REST calls are logged in `/var/log/restjavad-audit.0.log` (every call, with user and source IP) and `/var/log/restjavad.0.log` (errors) [Guide p.125]. The F5 admin can use these to confirm the portal's calls.

---

## Appendix C: documents we could not read

These F5 knowledge-base articles in F5's link list need a my.f5.com login and could not be opened: K16153652, K45508216, K14724629, K000152849, K000092968. Please export them to PDF and add them to this folder. They may cover token limits and other settings that affect these checks.
