# nunect Implementation Todo

**Current Phase: Phase 1 - Foundation**

---

## Phase 1.1: NATS Core Server

- [ ] Create `scripts/nats-server.sh` startup script
  - [ ] Read config from .env
  - [ ] Start with proper data dir
  - [ ] Enable JetStream
- [ ] Create `config/nats-server.conf`
  - [ ] Define SYS account for monitoring
  - [ ] Define initial test accounts
  - [ ] Enable HTTP monitoring on port 8222
  - [ ] Configure JetStream
- [ ] Create `.env` with server configuration
  - [ ] NATS_PORT, NATS_HTTP_PORT
  - [ ] Data directories
  - [ ] Initial credentials (dev only)
- [ ] Test: Server starts, responds to `/varz`

---

## Phase 1.2: NATS Management UI

- [ ] Create `web/nats-manager/` directory structure
- [ ] Implement vanilla TS/JS component
  - [ ] Fetch and display `/varz` (server stats)
  - [ ] Fetch and display `/connz` (connections)
  - [ ] Subscribe `$SYS.ACCOUNT.>.CONNECT` (live events)
  - [ ] Subscribe `$SYS.ACCOUNT.>.DISCONNECT` (live events)
  - [ ] Display `/subsz` (subscriptions)
  - [ ] Display `/routez` (cluster routes, if clustered)
- [ ] Rudimentary display: raw JSON acceptable for now
- [ ] Test: UI shows live connection events

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
