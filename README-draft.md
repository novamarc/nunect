# nunect - novamarc NATS Data Backend

**Universal message backbone for mission-critical communications.**

From a $50 Raspberry Pi in a firefighter's backpack to a global cloud cluster, nunect provides the same protocol, security, and QoS-aware messaging.

---

## Quick Start

```bash
# 1. Start NATS server
./scripts/nats-server.sh start

# 2. Start management UI
./scripts/nats-server.sh ui

# 3. Start Guardian (metrics/heartbeat)
./scripts/guardian.sh start

# 4. Open dashboard
open https://localhost:4280

# 5. View logs
tail -f logs/nats-server.log logs/guardian.log
```

**Configuration:**
```bash
cp .env.template .env
# Edit .env with your TLS certificates, credentials, time sync settings
```

---

## What is nunect?

nunect is novamarc's multi-mime data backbone based on NATS:

| Category | Services |
|----------|----------|
| **Data** | Telemetry, Messaging, Geo, Business Info |
| **Voice** | PTT-PoC, PTT-PMR (DMR, P25, TETRA), Voice Chat |
| **Media** | Real-time streams, Recordings, AI-processing |

### Core Message Model

```
┌─────────────────────────────────────────────────────────────────┐
│  SUBJECT  →  Logical Routing (hierarchical, wildcardable)        │
├─────────────────────────────────────────────────────────────────┤
│  HEADERS  →  Protocol Metadata (timing, identity, QoS)          │
├─────────────────────────────────────────────────────────────────┤
│  PAYLOAD  →  Immutable Raw Data (Opus/DMR/Tetra block)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture

### Base Orchestrator (NATS)

**We configure, not build:**
- Authentication (username/password, NKeys, JWT, TLS)
- Authorization (per-user pub/sub permissions)
- Message routing (pub/sub with wildcards)
- Monitoring (`$SYS` events, HTTP API)

### Plugin Modules (We Build)

| Module | Location | Purpose | Status |
|--------|----------|---------|--------|
| Guardian | `cmd/guardian/` | Heartbeat, RTT, Time sync publisher | ✅ Active |
| NATS Manager UI | `web/nats-manager/` | Real-time dashboard | ✅ Active |
| Generic Client | `clients/ts/nunect-client/` | Reusable TS/JS NATS client | ✅ Active |
| TimeSync Lib | `internal/timesync/` | PTP/Chrony monitoring | ✅ Active |

---

## Subject Hierarchy

```
[domain].[tenant].[sourceType].[sourceID].[targetGroup].[dataType]

Examples:
  ops.heartbeat.guardian-01           # Health beacon
  ops.metric.rtt.guardian-01          # RTT metrics
  ops.metric.time.guardian-01         # Time sync status
  com.bridge.vhf.sdr01.ch16.voice     # VHF audio channel 16
  com.bridge.tetra.gw01.tac1.ptt      # TETRA PTT control
```

### Wildcard Patterns

```javascript
// All heartbeats
nc.Subscribe("ops.heartbeat.*", handler)

// All metrics
nc.Subscribe("ops.metric.>", handler)

// Specific channel across all sources
nc.Subscribe("com.bridge.vhf.*.ch16.voice", handler)

// All logs
nc.Subscribe("ops.log.>", handler)
```

---

## Implemented Features

### ✅ Time Synchronization

- **PTP (Hardware):** <1µs precision with GPS RTK master
- **NTP Fallback:** <10ms precision
- **Auto-selection:** PTP preferred, NTP backup
- **Quality levels:** locked/tracking/acquiring/freerun

Published on: `ops.metric.time.{unitID}`

### ✅ RTT Measurement

- **Native RTT:** Transport layer via `nc.RTT()`
- **App RTT:** Full pipeline via echo pattern
- **Dual-layer:** Native (~200µs) + App (~250µs local, 50-300ms WAN)

Published on: `ops.metric.rtt.{unitID}`

### ✅ Client Identification

Auto-generated Unit IDs from browser fingerprint:
```
nats-ui-mobile-mac-a7b3     # iPhone Safari
nats-ui-laptop-win-def4     # Windows Chrome
guardian-server-linux-x2k9  # Server Guardian
```

Override: `https://nats.nunet.one:4280/?client=my-name`

### ✅ Adaptive QoS (Partial)

- Guardian publishes local link quality advisories
- Frame size recommendations (20/40/60ms)
- Clock skew detection for mixed infrastructure
- Real-time metrics dashboard

**In Development:**
- Mission Critical mode (windowed playback, late packet insertion)
- Global QoS aggregation
- Mesh roaming

---

## Documentation

| Document | Purpose |
|----------|---------|
| `docs/protocol-spec-draft.md` | Base protocol: messages, headers, timing, routing |
| `docs/voice-protocol-spec-draft.md` | Voice/PTT protocol: frames, control, codecs |
| `docs/qos-protocol-spec-draft.md` | QoS mechanisms: adaptive algorithms, Mission Critical mode |
| `nunect-arch-draft.md` | System architecture and design decisions |
| `nunect-todo.md` | Implementation phases and status |

---

## Protocol Specifications

### Standard Headers

```
X-Unit-ID:          sdr-bridge-01
X-Sequence:         42
X-TX-Timestamp:     1707772800000000123  # Unix nanoseconds
X-Clock-Source:     ptp|ntp|gps|unsynced
X-Clock-Quality:    locked|tracking|acquiring|freerun
X-NTP-Offset:       0.5                  # ms from reference
X-RTT-Native:       187452               # µs
X-RTT-App:          291326               # µs
X-Codec:            OPUS-8K|ACELP|AMBE
X-Frame-Size:       20|40|60             # ms
```

### Message Types

| Subject | Type | Description |
|---------|------|-------------|
| `ops.heartbeat.{unitID}` | Health | 5s health beacons |
| `ops.echo.{unitID}` | RTT | Echo responder |
| `ops.metric.rtt.{unitID}` | Metrics | RTT measurements (JSON) |
| `ops.metric.time.{unitID}` | Metrics | Time sync status (JSON) |
| `qos.local.advisory` | QoS | Guardian recommendations |
| `com.{t}.{tech}.{id}.{grp}.voice` | Voice | Audio frames |
| `com.{t}.{tech}.{id}.{grp}.ptt` | Control | PTT request/grant/release |

---

## Configuration

### Environment Variables

```bash
# NATS
NATS_URL=nats://localhost:4222
NATS_HTTP_PORT=8223
NATS_WS_PORT=8443
NATS_SYS_USER=sys
NATS_SYS_PASSWORD=...

# Time Sync
TIME_SYNC_MODE=auto           # ptp, chrony, or auto
PTP_MASTER_ADDRESS=10.0.0.1
PTP_DOMAIN=0
NTP_SERVERS=pool.ntp.org,time.google.com

# Guardian
GUARDIAN_HEARTBEAT_INTERVAL=5s
GUARDIAN_RTT_INTERVAL=30s
```

### Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `nats-server.sh` | `start` | Start NATS server |
| `nats-server.sh` | `ui` | Start management UI |
| `nats-server.sh` | `stop` | Stop NATS server |
| `guardian.sh` | `start` | Start Guardian |
| `guardian.sh` | `stop` | Stop Guardian |
| `guardian.sh` | `status` | Check Guardian status |
| `guardian.sh` | `build` | Build Guardian binary |

---

## Real-World Performance

| Path | Native RTT | App RTT | Notes |
|------|------------|---------|-------|
| Local | ~200µs | ~250µs | Guardian → NATS localhost |
| WiFi | N/A | 50-150ms | Mobile → AP → Server |
| 4G Mobile | N/A | 240-317ms | LTE → Internet → Server |
| PTP Link | ~5µs | N/A | Hardware timestamped |

---

## Development Status

### ✅ Phase 1-3: Foundation Complete
- NATS Core Server with TLS/WSS
- Management UI with real-time metrics
- Guardian with RTT and Time Sync
- Real-world latency validation

### 🟡 Phase 4: Leaf Nodes & Distributed Architecture
- Hardware platform (Banana Pi BPI-R4)
- OpenWRT with NATS Leaf
- PTP Grandmaster validation

### 🟡 Phase 5: Mission Critical Mode
- Windowed playback buffer
- Late packet insertion
- Automatic mode switching

### ⏳ Phase 6: Universal Backbone
- Femto nodes (nuNodes)
- Mesh roaming
- Transport agnostic (LoRaWAN, satellite)

See `nunect-todo.md` for detailed phase breakdown.

---

## Design Philosophy

> **Guardian advises. Clients vote. The network adapts.**

- **NATS-native:** Use NATS where possible, build only what's missing
- **Distributed QoS:** Local decisions with global awareness
- **Graceful degradation:** Quality reduces smoothly, never drops
- **One codebase:** From $50 femto node to global cloud

---

**Vision:** *One protocol. Infinite scalability. Same security. Same audit trail.*
