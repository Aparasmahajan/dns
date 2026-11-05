# DNS Management Portal: static demo

The same portal as `../portal`, with every screen and rule, but **without any server**. All data is
kept in the browser's `localStorage`. Use it to demo or review the portal on any PC with only a browser.

## Open it

Double-click **`dist/index.html`** (Edge or Chrome). That one file contains everything, so no web server,
Docker or internet connection is needed. It can also be copied or e-mailed as a single file, or served from any
static web host.

Demo accounts are listed on the sign-in page: click one to fill in the ID and password.

| User ID | Name | Password | What it shows |
|---|---|---|---|
| `admin` | Portal Administrator | `Admin@Portal2026` | Admin: users, partitions, audit, rollback, demo tools |
| `140122` | Pravez | `12345677` | Read + Write on `Internet_Banking`, `UPI_Payments` (local account) |
| `140123` | Abhash | `12345677` | Read + Write on `Core_Banking` (local account) |
| `140124` | Anoop Tiwari | `12345677` | Bank directory user: the Admin grants **Checker** |
| `140125` | Rahul KP | `12345677` | Bank directory user: the Admin grants **Checker** |
| `140126` | Paras Mahajan | `12345677` | Bank directory user who never used the portal: raises an access request |

A short walkthrough:
1. Sign in as `admin`, open *Users & Access → Add from Bank directory*, look up `140124` and grant **Checker**.
2. Sign in as `140122` (Pravez) and create a record in `Internet_Banking`. It waits for approval.
3. Sign in as `140124` (Anoop), open *Change Requests → Awaiting my approval* and approve it. It is "applied"
   at DC, DR and AZ (mock F5) as v1.0.
4. Sign in as `140126` (Paras), fill in the access request, then handle it as `admin` under *Pending access*.

## Same as the real portal

These run through the same rules as the Spring Boot backend, ported to TypeScript in `src/mock/`:
- **Sign-in:** portal accounts first, then the (mock) Bank directory. A first directory sign-in raises an access
  request; lockout after 5 failures (15 min); forced password change and password rules for local accounts.
- **Permissions:** Read, Read + Write (own partitions only), Checker and Admin, checked on every call
  (the same URL rules as the real `SecurityConfig`).
- **Partitions (F5 naming rule):** maker-checker, direct Checker/Admin changes, DNS validation (one-to-one,
  one-to-many, PTR), versions v1.0 → v1.1 …
- **Scheduling:** only updates (modify) and Admin rollbacks can be scheduled; creating or deleting a record
  runs straight away or on approval. Scheduled jobs run only while the site role is Active, and a change goes
  stale if the record changed meanwhile.
- **Admin:** version compare, rollback now or scheduled, held rollbacks, restoring deleted records.
- **Mock F5:** per-site results. Domains ending `.fail.test` fail at DR.
- **Audit trail:** every action, with user ID and name on user events, and search.
- **Requests are all-or-nothing:** a failed call changes nothing, but failed sign-ins and denied attempts are
  still recorded, as in the real portal.

## Only in the static demo: *Demo data* page (Admin)

It replaces what the real portal does with scripts and `.env`:
- **Mock Bank directory:** add or remove directory users (ID, name, email, password).
- **Site role Active / Standby:** shows that a standby (DR) site does not run scheduled jobs.
- **Directory sign-in:** turn it on or off.
- **Mock F5 failure suffix:** which domains the mock F5 rejects.
- **Departments:** the list shown in the department dropdowns (`DEPARTMENTS` in the real portal).
- **Export, import or reset:** export to a JSON file, import it in another browser, or reset to the sample data.
  *Reset demo data* is also on the sign-in page.

## Limits (by design)

- **Not secure, demo only.** Anyone using the browser can read or change `localStorage`. Passwords are stored as
  salted SHA-256 hashes, not plain text, but do not use real passwords.
- **Data is per browser and per profile.** Another PC or browser starts with fresh sample data; use
  Export/Import to move it. Clearing site data resets the demo.
- **The scheduler runs only while a portal tab is open**, checking every 15 s. Jobs that fell due while it was
  closed run as soon as it is opened again.
- **No backend services.** No F5, ITSM or SIEM, and no log files: the audit trail stays in the browser, newest
  5,000 events.
- **Open tabs share the data.** Two tabs acting at the same moment: the last save wins.

## Build and test (developers)

```powershell
npm install          # already done: node_modules was copied from ../portal/frontend
npm test             # 66 end-to-end checks of the in-browser backend
npm run build        # type-check, build, then inline everything into dist/index.html
npm run dev          # live development at http://localhost:5174
```

## Layout

```
static-portal/
├── dist/index.html       the whole portal in one file (open this). Not in git: run `npm run build` after cloning
│                         (node_modules is not in git either: run `npm install`)
├── src/                  same screens as ../portal/frontend/src, plus pages/Demo.tsx
│   ├── api.ts            calls the in-browser backend instead of the network
│   └── mock/             the "backend": server.ts (routes + access rules), auth.ts, changes.ts,
│                         admin.ts, context.ts, rules.ts, db.ts (localStorage + sample data), sha256.ts
├── tests/api.test.ts     end-to-end checks (npm test)
└── scripts/              inline.mjs (single-file build), test.mjs
```

`../portal` is not changed by this folder. When the real portal changes, port the screen or rule change here.
