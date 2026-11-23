1. The user logs in through the bank's SSO API and MFA if any.
2. The portal fetches the user role from the bank's role API or we have some info for user role.
3. The user fills in the bank defined form for wach config for create, delete and modifying the config.
4. The portal validates it with local checks(format, duplicates and CNAME loops against the synced inventory, TTL).
5. The portal saves the request and creates the ITSM ticket(hits bank's API for their ticketing).
6. The bank admin approves it in ITSM.
7. ITSM calls our approval API.
8. The portal verifies that call, checks the request hasnt changed and the approval is still valid, then schedules or executes the change.
9. The portal calls the bank's (or F5) change API, records the result per site, updates or closes the ticket, and raises an incident on failure.
10. Everything goes to the audit trail and SIEM.