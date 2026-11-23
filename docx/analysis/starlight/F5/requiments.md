We are working on an F5 BIG-IP DNS implementation for our customer. As part of this project, we are building a web portal for managing DNS (the Front-End Management System, FMS). It will connect to the BIG-IP DNS devices through REST APIs. The portal uses React for the frontend and Python FastAPI for the backend.

Please share the official REST API documentation, the list of supported endpoints and any related technical guides. The details we need are listed below.

A. Objects we will create, update and delete

1. DNS records in zones: A, AAAA, CNAME, PTR, TXT, MX and NS records in zones hosted on BIG-IP DNS (ZoneRunner / DNS Express), including reverse zones for PTR records. If REST is not supported for these, please tell us the recommended method, for example DNS Dynamic Update with TSIG, or zone transfer.
2. Wide IPs: all Wide IP types (A, AAAA, CNAME, MX, SRV, NAPTR).
3. DNS pools and pool members: including member status and settings.

B. Objects we only need to read (read-only access)

4. Device health: availability, system status, CPU, memory and health statistics. If the devices run on VELOS, please also share the F5OS API reference for hardware health.
5. GTM servers and their virtual servers, with status.
6. Data centers.
7. DNS listeners.
8. DNS monitors.
9. Load-balancing methods and related settings.
10. Topology records and regions.
11. Statistics: Wide IP, pool, server, listener and DNS query statistics. This is for dashboards and is lower priority.

C. How changes should be made

12. Whether we should connect to BIG-IQ Centralized Management or to each BIG-IP device directly (iControl REST). If BIG-IQ, please share the BIG-IQ API reference.
13. How a change made on one device reaches the DC, DR and AZ devices: does the GTM sync group copy it automatically, or must we call each device? Is a save or sync call needed after every change?
14. Whether transactions are supported (several steps applied together), and what happens if one step fails.
15. F5's recommended approach for DNS/GSLB automation: iControl REST or AS3.

D. Reading data and detecting changes

16. How to list all objects when there are very large numbers of them (paging details).
17. How to detect changes, including changes made directly on the device. For example, SOA serial checks, or whether zone transfers (AXFR/IXFR) can be allowed from the portal's IP address.

E. Access, security and limits

18. How API authentication works: the token login flow and how long a token stays valid.
19. The recommended least-privilege role or partition for the portal's API service account.
20. Supported TLS versions on the management interface.
21. Limits: maximum concurrent REST sessions, recommended request rate, and any rate limits.
22. The error response format, and how long-running (async) tasks are handled.

F. For every endpoint

23. The full URL and supported methods (GET, POST, PUT, PATCH, DELETE).
24. Parameters, with mandatory fields marked.
25. Sample request and response JSON.

G. Versions and prerequisites

26. The exact BIG-IP DNS software version deployed, and any API differences between supported versions.
27. Any licensing, provisioning or configuration needed to enable REST API access.
28. Once the documentation is shared, we will also need UAT/test access (for example a BIG-IP VE) on the same version, to build and test the integration.
