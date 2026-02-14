# nunect Implementation Todo

**Current Phase: Phase 3 - Health & Time Sync (COMPLETE)**

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

## Phase 1.2: NATS Management UI ✅ COMPLETE

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
- [x] Client Identification
  - [x] Auto-generate unit ID from browser fingerprint
  - [x] Detect mobile vs laptop, OS type
  - [x] URL override parameter (`?client=name`)
- [x] Message Header Strategy
  - [x] Document: Headers for timing/routing, Payload for bulk
  - [x] Standard header definitions (X-Unit-ID, X-TX-Timestamp, etc.)
- [x] Document: HTTP API is read-only, config changes require file edit + reload
- [x] Rudimentary display: functional first
- [x] Script handles port conflicts (kills stale processes)
- [x] Test: UI shows live connection events - WORKING via Cloudflare

---

## Phase 1.3: Generic TS/JS Client ✅ COMPLETE

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
- [x] Test: Client connects, pubs/subs work

---

## Phase 2: Testing ✅ COMPLETE

- [x] Connection tests
  - [x] Auth with username/password (WSS working)
  - [x] Reconnect on disconnect (library handles this)
  - [x] Multiple concurrent clients (UI + Guardian tested)
- [x] Management API tests
  - [x] All HTTP endpoints reachable
  - [x] $SYS events received
- [x] Integration test
  - [x] UI shows live connection data
  - [x] UI displays RTT metrics from Guardian
  - [x] Real-world mobile network test (50-150ms WiFi, 240-317ms 4G)

---

## Phase 3: Health, RTT & Time Sync ✅ COMPLETE

### Guardian Service
- [x] Create `cmd/guardian/` with management script
  - [x] `scripts/guardian.sh` - start/stop/status/build commands
  - [x] Reads credentials from `.env` (NATS_SYS_USER/PASSWORD)
  - [x] Publishes to `ops.heartbeat.{unitID}`
  - [x] Echo responder on `ops.echo.{unitID}`
- [x] RTT Measurement
  - [x] Native RTT via `nc.RTT()` (transport layer)
  - [x] App RTT via echo request-reply (full pipeline)
  - [x] Publishes to `ops.metric.rtt.{unitID}`

### Time Synchronization
- [x] Create `internal/timesync/` library
  - [x] PTP status reader (ptp4l via pmc or status file)
  - [x] Chrony/NTP status reader (chronyc tracking)
  - [x] Auto-selection: PTP preferred, fallback to NTP
  - [x] Quality assessment: locked/tracking/acquiring/freerun
- [x] Guardian integration
  - [x] Publishes `ops.metric.time.{unitID}`
  - [x] Publishes `ops.time.config` for client configuration
  - [x] Adds time headers to heartbeats (X-Clock-Source, X-Clock-Quality)
- [x] Environment configuration (.env)
  - [x] TIME_SYNC_MODE (ptp/chrony/auto)
  - [x] PTP_MASTER_ADDRESS
  - [x] NTP_SERVERS
  - [x] PTP_DOMAIN, PTP_HW_TIMESTAMP

### UI Updates
- [x] RTT Metrics table
  - [x] Subscribes to `ops.metric.rtt.>`
  - [x] Displays Unit ID, Seq, Native RTT, App RTT, Last Seen
  - [x] Color-coded latency (green/yellow/red)
- [x] Time Sync Metrics table
  - [x] Subscribes to `ops.metric.time.>`
  - [x] Displays Source (PTP/NTP), Quality, Offsets
- [x] Local Time Status box
  - [x] Shows active source, quality, PTP master, offsets

### Real-World Validation
- [x] Field tests completed
  - [x] WiFi path: 50-150ms App RTT
  - [x] Mobile 4G path: 240-317ms App RTT
  - [x] Guardian: ~200-250µs Native RTT, ~250-300µs App RTT (localhost)
  - [x] UI auto-publishes its own metrics

---

## Phase 4: Leaf Nodes & Distributed Architecture (Next)

### Hardware Platform
- [ ] Select hardware (Banana Pi BPI-R4 or equivalent)
  - [ ] Intel 2.5G NICs with PTP hardware timestamping
  - [ ] M.2 slots for WiFi (2.4GHz) and 5GHz backhaul
  - [ ] GPS module for Stratum 1 (optional)
- [ ] OpenWRT image with:
  - [ ] NATS Leaf Node support
  - [ ] ptp4l (linuxptp)
  - [ ] chronyd
  - [ ] LuCI or custom dashboard

### Leaf Node Software
- [ ] NATS Leaf configuration
  - [ ] `leafnodes { remotes [{ url: "tls://central:7422" }] }`
  - [ ] Local account mirroring
  - [ ] Interest-based subject propagation
- [ ] Guardian on OpenWRT
  - [ ] Cross-compile for ARM64
  - [ ] Systemd init script
  - [ ] PTP/Chrony integration

### Network Topology
- [ ] Festival/commercial compound layout
  - [ ] 3+ leaf nodes with 5GHz PtP backhaul
  - [ ] 6-8 APs per leaf (2.4GHz client access)
  - [ ] Ring topology with redundancy
- [ ] PTP Grandmaster setup
  - [ ] GPS RTK for Stratum 1
  - [ ] Hardware timestamp validation

### Registry & Routing
- [ ] Subject registry service
  - [ ] Track which subjects needed at which leaf
  - [ ] Optimize inter-leaf traffic
  - [ ] Cell handoff support

---

## Blocked/Issues

None currently.

---

## Completed

- [x] Architecture definition (nunect-arch.md)
- [x] Initial README with subject hierarchy
- [x] WebSocket connection working via Cloudflare Tunnel
- [x] Dashboard with Routes, JetStream, Accounts views
- [x] Guardian with RTT measurement
- [x] Time sync (PTP/Chrony) integration
- [x] UI with RTT and Time Sync metrics tables
- [x] Real-world latency validation (WiFi + Mobile)
- [x] Guardian management script (guardian.sh)
- [x] Echo pattern for application-level RTT
