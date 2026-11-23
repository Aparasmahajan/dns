1. The user logs in through the bank's SSO API and MFA if any.
LLD part:- Normal API hitting and validating response.

2. The portal fetches the user role from the bank's role API or we have some info for user role.
LLD part:- we will check for user info from pk if present if not then we will store and update our db if present save info in session.

3. The user fills in the bank defined form for wach config for create, delete and modifying the config.
LLD part:- UI checks and field management. Needed records list for modify and delete thing saved in local db or cache.

4. The portal validates it with local checks(format, duplicates and CNAME loops against the synced inventory, TTL).
LLD part:- Required clarity for fields and pre form validation checks will be performed on client side.

5. The portal saves the request and creates the ITSM ticket(hits bank's API for their ticketing).
LLD part:- Request in open state with certain request id and bank's internal tool api is being hit for admin approval.

6. The bank admin approves it in ITSM.
LLD part:- It has certain request or transaction id, order is pushed in cache and db session.

7. ITSM calls our approval API.
LLD part:- Bank will hit our endpoint with that transaction id also with a yes or no and metadeta of the request.

8. The portal verifies that call, checks the request hasnt changed and the approval is still valid, then schedules or executes the change.
LLD part:- Request processing and logs in user and our logger.

9. The portal calls the bank's (or F5) change API, records the result per site, updates or closes the ticket, and raises an incident on failure.
LLD part:- Bank's api is now hit and response is processed if success order marked as success with response logged in db if failed then putting failed with reason and response in db.

10. Everything goes to the audit trail and SIEM.



Pending:
1. Bank's API 1. SSO, MFA for login
              2. Active DNS configs all the resources data
            IMP: needed API's timeout, retries and behaviour beforehand
2. Configuration part entire pages data to show and checks to be performed


Navjeet sir: DNS records change schedules etc. what is it J1.8
             Also how RBAC hierarchy imp if things required approval within this portal J1.3
             Any notification services required if approval for this portal is needed out of scope
             DC/DR switchover then how to handle that are they totally in sync