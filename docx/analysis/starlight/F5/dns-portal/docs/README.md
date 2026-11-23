# SBI F5 DNS Portal: Engineering Pack

| Doc | What it holds |
|---|---|
| [00-context.md](00-context.md) | Consolidated requirements, scale targets, tech decisions, open decisions D1–D8 |
| [01-LLD.md](01-LLD.md) | Low-level design: components, flows, state machines, scale/queue/cache, HA/DR, security, sizing |
| [02-data-model.sql](02-data-model.sql) | PostgreSQL 16 DDL (migration 0001); verified to apply cleanly |
| [03-openapi.yaml](03-openapi.yaml) | REST contract (OpenAPI 3.1) for UI and automation |
| [04-traceability.md](04-traceability.md) | RFP J1–J5 → design → test, plus workbook remarks |
| [05-delivery-plan.md](05-delivery-plan.md) | Team, 10 sprints in 20 weeks, DoD, risks, week-1 asks |

**Stack:** Next.js 15 + NestJS (TypeScript, Node 22) · PostgreSQL 16 (Patroni, 3-site etcd) · Redis 7 cache · Postgres-backed durable queue (Graphile Worker) · Fluent Bit → SIEM · Vault/KMS.

**The one idea to remember:** the F5 management API is the throughput ceiling. Every F5 write is queued, batched per zone, serialised per zone and rate-capped per target. PostgreSQL is the only stateful system, which keeps DR simple.
