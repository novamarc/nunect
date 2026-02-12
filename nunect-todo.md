# nunect Implementation Todo

**Current Phase: Phase 1 - Foundation**

---

## Phase 1.1: NATS Core Server

- [x] Create `scripts/nats-server.sh` startup script
  - [ ] Read config from .env
  - [ ] Start with proper data dir
  - [ ] Enable JetStream
- [x] Create `config/nats-server.conf`
  - [x] Define SYS account for monitoring
  - [x] Define initial test accounts (BRIDGE, ENGINE, PROVISION)
  - [x] Enable HTTP monitoring
  - [x] Configure JetStream
- [x] Create `.env` from template
  - [ ] NATS_PORT, NATS_HTTP_PORT
  - [ ] Data directories
  - [ ] Initial credentials (dev only)
- [x] Test: Server starts on port 4223, responds to `/varz` on 8223

---

## Phase 1.2: NATS Management UI

- [x] Create `web/nats-manager/` directory structure
- [x] Create simple HTTP server (Python) on port 4280
- [x] Configure domain and CORS in `.env`
  - [x] `NATS_MANAGER_DOMAIN=dev.nunet.one`
  - [x] `NATS_MANAGER_CORS_ORIGINS` for allowed origins
  - [x] `NATS_MANAGER_BIND` for interface binding
- [x] Implement vanilla TS/JS component
  - [x] Fetch and display `/varz` (server stats) from port 8223
  - [x] Fetch and display `/connz` (connections) from port 8223
  - [x] Display `/subsz` (subscriptions) from port 8223
  - [x] Display current domain in UI header
  - [x] WebSocket connection to NATS WSS (port 8443) - TLS enabled
  - [ ] Subscribe `$SYS.ACCOUNT.>.CONNECT` (live events) - test WSS
  - [ ] Subscribe `$SYS.ACCOUNT.>.DISCONNECT` (live events) - test WSS
- [x] Document: HTTP API is read-only, config changes require file edit + reload
- [x] Rudimentary display: raw JSON acceptable for now
- [x] Script handles port conflicts (kills stale processes)
- [ ] Test: UI shows live connection events - needs WebSocket fix

---

## Phase 1.3: Generic TS/JS Client

- [ ] Create `clients/ts/nunect-client/` package
  - [ ] package.json with dependencies (nats.ws or nats.js)
  - [ ] tsconfig.json
- [ ] Implement core client class
  - [ ] WebSocket connection to NATS
  - [ ] Authentication (JWT or username/password)
  - [ ] Connection lifecycle (connect, disconnect, reconnect)
  - [ ] Publish with headers
  - [ ] Subscribe with wildcards
  - [ ] Unsubscribe
  - [ ] Request-reply pattern
- [ ] Implement logger module
  - [ ] `logger.info()`, `logger.warn()`, `logger.error()`
  - [ ] Publishes to `ops.log.{level}.{unitID}`
- [ ] Test: Client connects, pubs/subs work

---

## Phase 2: Testing

- [ ] Connection tests
  - [ ] Auth with username/password
  - [ ] Auth with JWT
  - [ ] Reconnect on disconnect
  - [ ] Multiple concurrent clients
- [ ] Management API tests
  - [ ] All HTTP endpoints reachable
  - [ ] $SYS events received
- [ ] Integration test
  - [ ] UI shows client connections live

---

## Phase 3: Provisioning & Health (Future)

- [ ] Guardian (Go heartbeat)
- [ ] Controller (Go dashboard backend)
- [ ] ProMan (Go provisioning)

---

## Blocked/Issues

None currently.

---

## Completed

- [x] Architecture definition (nunect-arch.md)
- [x] Initial README with subject hierarchy
