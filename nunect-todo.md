# nunect Implementation Todo

**Current Phase: Phase 1 - Foundation**

---

## Phase 1.1: NATS Core Server ✅ COMPLETE

- [x] Create `scripts/nats-server.sh` startup script
  - [x] Read config from .env
  - [x] Start with proper data dir
  - [x] Enable JetStream
- [x] Create `config/nats-server.conf`
  - [x] Define SYS account for monitoring
  - [x] Define initial test accounts (BRIDGE, ENGINE, PROVISION)
  - [x] Enable HTTPS monitoring (port 8444)
  - [x] Enable WSS WebSocket (port 8443)
  - [x] Configure JetStream
- [x] Create `.env` from template
  - [x] NATS_PORT, NATS_HTTPS_PORT
  - [x] Data directories
  - [x] Initial credentials (dev only)
- [x] Test: Server starts on port 4222, responds to `/varz` on 8444

---

## Phase 1.2: NATS Management UI ✅ MOSTLY COMPLETE

- [x] Create `web/nats-manager/` directory structure
- [x] Create HTTPS server (Python) on port 4280
- [x] Configure domain and CORS in `.env`
  - [x] `NATS_MANAGER_DOMAIN=nats.nunet.one`
  - [x] `NATS_MANAGER_CORS_ORIGINS` for allowed origins
  - [x] `NATS_MANAGER_BIND` for interface binding
- [x] Implement vanilla TS/JS component
  - [x] Fetch and display `/varz` (server stats)
  - [x] Fetch and display `/connz` (connections)
  - [x] Fetch and display `/subsz` (subscriptions)
  - [x] Fetch and display `/routez` (routes/gateways)
  - [x] Fetch and display `/jsz` (JetStream)
  - [x] Display accounts table with connection counts
  - [x] Display current domain in UI header
  - [x] WebSocket connection to NATS WSS - TLS enabled
  - [x] Subscribe `$SYS.>` (live events) - WORKING
  - [x] Parse CONNECT/DISCONNECT events
  - [x] Connection activity log
- [x] Document: HTTP API is read-only, config changes require file edit + reload
- [x] Rudimentary display: functional first
- [x] Script handles port conflicts (kills stale processes)
- [x] Test: UI shows live connection events - WORKING via Cloudflare

---

## Phase 1.3: Generic TS/JS Client 🟡 IN PROGRESS

- [x] Create `clients/ts/nunect-client/` package
  - [x] package.json with dependencies (nats.ws)
  - [x] tsconfig.json
- [x] Implement core client class
  - [x] WebSocket connection to NATS
  - [x] Authentication (username/password)
  - [x] Connection lifecycle (connect, disconnect, reconnect)
  - [x] Publish with headers
  - [x] Subscribe with wildcards
  - [x] Unsubscribe
  - [x] Request-reply pattern
- [x] Implement logger module
  - [x] `logger.info()`, `logger.warn()`, `logger.error()`
  - [x] Publishes to `ops.log.{level}.{unitID}`
- [ ] Test: Client connects, pubs/subs work

---

## Phase 2: Testing 🟡 IN PROGRESS

- [x] Connection tests
  - [x] Auth with username/password (WSS working)
  - [ ] Auth with JWT
  - [x] Reconnect on disconnect (library handles this)
  - [ ] Multiple concurrent clients
- [x] Management API tests
  - [x] All HTTP endpoints reachable
  - [x] $SYS events received
- [ ] Integration test
  - [x] UI shows live connection data
  - [ ] Playwright/Chromium automated tests

---

## Phase 3: Provisioning & Health (Future)

- [ ] Guardian (Go heartbeat) - stub exists
- [ ] Controller (Go dashboard backend)
- [ ] ~~ProMan (Go provisioning)~~ - DEFERRED per requirements

---

## Blocked/Issues

None currently.

---

## Completed

- [x] Architecture definition (nunect-arch.md)
- [x] Initial README with subject hierarchy
- [x] WebSocket connection working via Cloudflare Tunnel
- [x] Dashboard with Routes, JetStream, Accounts views
