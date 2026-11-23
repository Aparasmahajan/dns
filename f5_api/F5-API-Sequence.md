# F5 BIG-IP DNS API: step-by-step sequence (lab)

Prepared by: Starlight Data Solutions · 19-Nov-2026 · Lab device: BIG-IP VE 21.1.0.1

The order to call the iControl REST APIs, from sign-in to sign-out: first check the device, then read
everything (health, partitions, DNS objects), then make and verify a change, then clean up.
Each step has the `curl` command and the matching request in the Postman collection
`F5-BIGIP-DNS-Lab.postman_collection.json` (folder number in brackets).

## 0. Set up the shell once

```bash
export F5=https://10.1.1.5          # management address of the BIG-IP (lab)
export F5_USER=admin
read -s -p "F5 password: " F5_PASS; echo
export P=Portal_Lab                 # partition used for the test objects
K=-k                                # LAB ONLY: skips the self-signed certificate check. Never use -k in production.
```

Paths that name one object use `~Partition~name`, for example `/mgmt/tm/gtm/wideip/a/~Portal_Lab~app.lab.example`.
`jq` is optional; it only makes the output shorter.

---

## Step 1. Sign in and get a token  [00]

```bash
TOKEN=$(curl -s $K -X POST "$F5/mgmt/shared/authn/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$F5_USER\",\"password\":\"$F5_PASS\",\"loginProviderName\":\"tmos\"}" \
  | jq -r .token.token)
echo "$TOKEN"
H=(-H "X-F5-Auth-Token: $TOKEN" -H "Accept: application/json")
```

- From here on, every call sends `X-F5-Auth-Token`. Never send the password again, and don't use Basic auth.
- `loginProviderName`: `tmos` for local F5 accounts. A remote (LDAP / TACACS) account needs the provider name from the F5 admin.

## Step 2. Set up the token  [00]

```bash
curl -s $K "${H[@]}" "$F5/mgmt/shared/authz/tokens/$TOKEN" | jq '{timeout, expirationMicros}'   # check it
curl -s $K "${H[@]}" -X PATCH "$F5/mgmt/shared/authz/tokens/$TOKEN" \
  -H "Content-Type: application/json" -d '{"timeout":3600}' | jq .timeout                       # extend to 1 hour
```

- Default lifetime is 1200 s (20 minutes); the maximum is 36000 s.
- The portal signs in again shortly before expiry (the Postman collection does this automatically).

## Step 3. Identify the device: BIG-IP or BIG-IQ?  [01]

```bash
curl -s $K "${H[@]}" "$F5/mgmt/shared/identified-devices/config/device-info" \
  | jq '{product, version, build, hostname, managementAddress}'
```

`product` is `BIG-IP` or `BIG-IQ`. This is the quickest way to tell which one an address is. See section 10 for how
to check whether a BIG-IQ manages the BIG-IPs.

## Step 4. Device checks (once per session)  [01, 03]

```bash
curl -s $K "${H[@]}" "$F5/mgmt/tm/sys/version"                                   # exact version
curl -s $K "${H[@]}" "$F5/mgmt/tm/sys/provision?\$select=name,level" \
  | jq -r '.items[] | "\(.name) \(.level)"'                                        # gtm must not be "none"
curl -s $K "${H[@]}" "$F5/mgmt/tm/sys/failover"                                   # active / standby
curl -s $K "${H[@]}" "$F5/mgmt/tm/cm/device?\$select=name,managementIp,failoverState,version"
curl -s $K "${H[@]}" "$F5/mgmt/tm/cm/sync-status" | jq '.entries[].nestedStats.entries | {status: .status.description, color: .color.description}'
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/global-settings/general?\$select=synchronization,synchronizationGroupName"
```

- If `gtm` is `none`, BIG-IP DNS is off and every `/mgmt/tm/gtm/...` call fails. **Lab only:** switch it on with
  `curl -s $K "${H[@]}" -X PATCH -H "Content-Type: application/json" -d '{"level":"nominal"}' "$F5/mgmt/tm/sys/provision/gtm"`.
  Services restart for a few minutes.
- `synchronization: yes` and a `synchronizationGroupName` mean the GTM config is shared with the other devices
  in that sync group (the DC / DR / AZ question).

## Step 5. Monitoring: health and statistics  [01, 09]

```bash
curl -s $K "${H[@]}" "$F5/mgmt/tm/sys/host-info"            | jq '.entries[].nestedStats.entries | {cpuCount: .cpuCount.value, memoryTotal: .memoryTotal.value, memoryUsed: .memoryUsed.value}'
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/datacenter/stats"     # data center availability
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/server/stats"         # server availability
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/pool/a/stats"         # pool availability
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/wideip/a/stats"       # Wide IP status and request counts
```

In each stats item, `status.availabilityState` is `available`, `offline` or `unknown`, and `status.enabledState`
is `enabled` or `disabled`.

## Step 6. Partitions  [01, 02]

```bash
curl -s $K "${H[@]}" "$F5/mgmt/tm/auth/partition?\$select=name,description" | jq -r '.items[].name'
```

These are the portal's groups. The lab device has `Common`, `Client_01`, `External_User` and `Internal_User`.

## Step 7. All data, partition by partition  [04 – 10]

Data centers and servers are global (always in `Common`). Pools and Wide IPs belong to a partition.

```bash
# global objects
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/datacenter?\$select=name,location,enabled"
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/server?\$select=name,datacenter,product,addresses"
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/server/~Common~<server>/virtual-servers"
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/listener"
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/monitor"
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/topology"

# everything in every partition
for PART in $(curl -s $K "${H[@]}" "$F5/mgmt/tm/auth/partition" | jq -r '.items[].name'); do
  echo "=== $PART"
  curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/wideip/a?\$filter=partition+eq+$PART&\$select=name,pools,enabled"
  curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/wideip/aaaa?\$filter=partition+eq+$PART&\$select=name,pools,enabled"
  curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/pool/a?\$filter=partition+eq+$PART&expandSubcollections=true"
  curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/pool/aaaa?\$filter=partition+eq+$PART&expandSubcollections=true"
done

# DNS Express zones (standard records; ZoneRunner records are not available through REST, F5 K14724629)
curl -s $K "${H[@]}" "$F5/mgmt/tm/ltm/dns/zone"
curl -s $K "${H[@]}" "$F5/mgmt/tm/ltm/dns/nameserver"
```

**Large inventories: page through them**, for example 100 at a time:

```bash
curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/wideip/a?\$top=100&\$skip=0"     # then $skip=100, 200 … until items is empty
```

## Step 8. Make a change and check it  [02, 04 – 07]

The full chain for one name, with each object depending on the one before:

```bash
J=(-H "Content-Type: application/json")
curl -s $K "${H[@]}" "${J[@]}" -X POST "$F5/mgmt/tm/auth/partition" -d "{\"name\":\"$P\"}"
curl -s $K "${H[@]}" "${J[@]}" -X POST "$F5/mgmt/tm/gtm/datacenter" -d '{"name":"DC_Lab"}'
curl -s $K "${H[@]}" "${J[@]}" -X POST "$F5/mgmt/tm/gtm/server" -d '{
  "name":"srv_lab","datacenter":"/Common/DC_Lab","product":"generic-host",
  "addresses":[{"name":"10.1.20.10"}],
  "virtualServers":[{"name":"vs1","destination":"10.1.20.11:80"},{"name":"vs2","destination":"10.1.20.12:80"}]}'
curl -s $K "${H[@]}" "${J[@]}" -X POST "$F5/mgmt/tm/gtm/pool/a" -d "{
  \"name\":\"pool_lab_a\",\"partition\":\"$P\",\"loadBalancingMode\":\"round-robin\",
  \"members\":[{\"name\":\"srv_lab:vs1\",\"partition\":\"Common\"}]}"
curl -s $K "${H[@]}" "${J[@]}" -X POST "$F5/mgmt/tm/gtm/wideip/a" -d "{
  \"name\":\"app.lab.example\",\"partition\":\"$P\",\"pools\":[{\"name\":\"pool_lab_a\",\"partition\":\"$P\"}]}"
```

- **One-to-one → one-to-many**: add a member to the pool:
  `curl -s $K "${H[@]}" "${J[@]}" -X POST "$F5/mgmt/tm/gtm/pool/a/~$P~pool_lab_a/members" -d '{"name":"srv_lab:vs2","partition":"Common"}'`
- **Modify**: `PATCH` with only the fields that change, e.g. `{"disabled":true}` or `{"loadBalancingMode":"global-availability"}`.
- **Check (read back)**: `curl -s $K "${H[@]}" "$F5/mgmt/tm/gtm/wideip/a/~$P~app.lab.example"` and
  `.../pool/a/~$P~pool_lab_a?expandSubcollections=true`. The portal reads back after every change, at every site.
- **Several changes, all or nothing**: use a transaction (Postman folder 11): `POST /mgmt/tm/transaction`,
  send each change with header `X-F5-REST-Coordination-Id: <transId>`, then
  `PATCH /mgmt/tm/transaction/<transId>` with `{"state":"VALIDATING"}` to commit.

## Step 9. Save, sync and verify  [01, 03]

```bash
curl -s $K "${H[@]}" "${J[@]}" -X POST "$F5/mgmt/tm/sys/config" -d '{"command":"save"}'           # save to disk
curl -s $K "${H[@]}" "${J[@]}" -X POST "$F5/mgmt/tm/cm" -d '{"command":"run","utilCmdArgs":"config-sync to-group <device-group>"}'   # only with a device group
curl -s $K "${H[@]}" "$F5/mgmt/tm/cm/sync-status"                                                # expect "In Sync"
```

With a GTM sync group, then read the same object on the other devices (DR, AZ) to confirm the change arrived.

## Step 10. BIG-IP or BIG-IQ: the commands

| Question | Command | Answer |
|---|---|---|
| Is this address a BIG-IP or a BIG-IQ? | `curl -s $K "${H[@]}" "$F5/mgmt/shared/identified-devices/config/device-info" \| jq .product` | `"BIG-IP"` or `"BIG-IQ"` |
| (same, second way) | `curl -s $K "${H[@]}" "$F5/mgmt/tm/sys/version" \| jq -r '.entries[].nestedStats.entries.Product.description'` | `BIG-IP` or `BIG-IQ` |
| Which BIG-IPs does a BIG-IQ manage? *(run against the BIG-IQ)* | `curl -s $K "${H[@]}" "$BIGIQ/mgmt/shared/resolver/device-groups/cm-bigip-allBigIpDevices/devices?\$select=hostname,address,product,version"` | The managed BIG-IPs. If SBI's DNS devices are listed, the portal should go through BIG-IQ |

A BIG-IP does not reliably show by itself whether a BIG-IQ manages it. Ask SBI / F5 for the BIG-IQ address, or run
the last command on their BIG-IQ. The lab device answers `"BIG-IP"` and is standalone (no BIG-IQ).

## Step 11. Errors to expect  [12]

| Case | HTTP | Body |
|---|---|---|
| Object does not exist | 404 | `{"code":404,"message":"01020036:3: The requested … was not found.","errorStack":[]}` |
| Already exists | 409 | `{"code":409,"message":"… already exists …"}` |
| Wrong or expired token | 401 | `{"code":401,"message":"X-F5-Auth-Token does not exist."}` → sign in again |
| Invalid value | 400 | `{"code":400,"message":"…"}` |

The portal shows `code` and `message` exactly as returned, per site. (Exact message texts can differ by version;
check them on the lab device.)

## Step 12. Clean up and sign out  [99, 00]

```bash
for path in "gtm/wideip/a/~$P~app.lab.example" "gtm/pool/a/~$P~pool_lab_a" "gtm/server/~Common~srv_lab" \
            "gtm/datacenter/~Common~DC_Lab" "auth/partition/$P"; do
  curl -s $K "${H[@]}" -X DELETE "$F5/mgmt/tm/$path" -o /dev/null -w "%{http_code} $path\n"
done
curl -s $K "${H[@]}" -X DELETE "$F5/mgmt/shared/authz/tokens/$TOKEN" -o /dev/null -w "logout %{http_code}\n"
unset F5_PASS TOKEN
```

Delete in this order (Wide IP → pool → server → data center → partition): an object in use cannot be deleted.

---

### What the portal does in this order
1. Sign in (step 1–2), renewing the token before it expires.
2. On start-up and on the dashboard: steps 3–5.
3. Inventory sync: steps 6–7 with paging.
4. For each approved change: step 8 (inside a transaction where several objects change), then read back,
   then step 9 at every site, storing each site's result.
5. Before a rollback: read the live object (step 7) and compare with the portal's version (drift check).
