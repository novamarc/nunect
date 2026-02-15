# nunect Protocol Specification (Draft)

**Version:** 0.1  
**Status:** Draft - Consolidating from existing docs  
**Scope:** Base protocol layer - message structure, headers, routing, timing fundamentals

---

## 1. Protocol Architecture

### 1.1 Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                         │
│         (Voice, Data, Media - protocol extensions)           │
├─────────────────────────────────────────────────────────────┤
│                    nunect PROTOCOL LAYER                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Message   │  │   Timing    │  │   QoS/Routing       │  │
│  │  Structure  │  │   & Sync    │  │   (this spec)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    NATS TRANSPORT LAYER                      │
│         (Pub/Sub, Wildcards, Request-Reply, JetStream)       │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Design Principles

1. **NATS-native where possible:** Use NATS subjects, headers, and patterns
2. **Headers for fast path:** Identity, timing, routing in headers for zero-copy decisions
3. **Payload for data:** Immutable raw data (voice frames, JSON, etc.)
4. **Hierarchical subjects:** Enable efficient wildcard subscriptions

---

## 2. Subject Hierarchy

### 2.1 Base Pattern

```
[domain].[tenant].[sourceType].[sourceID].[targetGroup].[dataType]
```

| Level | Pattern | Description |
|-------|---------|-------------|
| `domain` | `nav`, `com`, `ops` | Top-level isolation |
| `tenant` | `bridge`, `engine`, `pax` | Organizational isolation |
| `sourceType` | `vhf`, `tetra`, `web`, `sdr` | Connector technology |
| `sourceID` | `sdr01`, `handheld22` | Unique device/client ID |
| `targetGroup` | `ch16`, `all`, `zoll` | Logical group/channel |
| `dataType` | `voice`, `data`, `meta`, `cmd` | Payload classification |

### 2.2 Operations Domain (`ops.`)

Core infrastructure subjects:

```
ops.heartbeat.{unitID}              # Health beacons
ops.echo.{unitID}                   # RTT probe responder
ops.metric.{type}.{unitID}          # Performance metrics
  ├─ ops.metric.rtt.{unitID}        # RTT measurements
  └─ ops.metric.time.{unitID}       # Time sync status
ops.time.config                     # Global time config
ops.log.{level}.{unitID}            # Structured logging
ops.cmd.{targetType}.{targetID}     # Command dispatch
ops.status.{targetType}.{targetID}  # Status reports
ops.provision.request               # Provisioning requests
ops.provision.response.{unitID}     # Individual responses
ops.provision.broadcast             # Global config updates
```

### 2.3 Communication Domain (`com.`)

Voice and messaging:

```
com.{tenant}.{tech}.{sourceID}.{group}.voice    # Real-time audio
com.{tenant}.{tech}.{sourceID}.{group}.data     # SDS/text messages
com.{tenant}.{tech}.{sourceID}.{group}.presence # Availability
com.{tenant}.{tech}.{sourceID}.{group}.ptt      # PTT control
```

### 2.4 Wildcard Patterns

```javascript
// All voice in a tenant
nc.Subscribe("com.bridge.*.*.*.voice", handler)

// All heartbeats (health monitoring)
nc.Subscribe("ops.heartbeat.*", handler)

// All metrics
nc.Subscribe("ops.metric.>", handler)

// Specific channel across all sources
nc.Subscribe("com.bridge.vhf.*.ch16.voice", handler)

// All logs
nc.Subscribe("ops.log.>", handler)
```

---

## 3. Message Structure

### 3.1 Message Anatomy

Every nunect message consists of:

```
┌─────────────────────────────────────────────────────────────┐
│  SUBJECT   →  Logical routing (hierarchical, wildcardable)  │
├─────────────────────────────────────────────────────────────┤
│  HEADERS   →  Protocol meta (timing, codecs, identity, QoS) │
├─────────────────────────────────────────────────────────────┤
│  PAYLOAD   →  Raw data (codec frames, JSON, binary)         │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Header Classification

| Category | Headers | Purpose |
|----------|---------|---------|
| **Identity** | `X-Unit-ID`, `X-Origin-ID`, `X-Tenant` | Source identification |
| **Timing** | `X-TX-Timestamp`, `X-Clock-Source`, `X-Clock-offset`, `X-Clock-Quality` | Synchronization |
| **Network** | `X-RTT-Native`, `X-RTT-App`, `X-Link-Quality` | QoS metrics |
| **Sequencing** | `X-Sequence`, `X-Gate-Timestamp` | Ordering & latency |
| **Media** | `X-Codec`, `X-Protocol-Origin` | Payload interpretation |

### 3.3 Standard Headers (All Messages)

```
# Identity
X-Unit-ID:          sdr-bridge-01
X-Origin-ID:        SSI-12345
X-Tenant:           bridge
X-Sender-Alias:     Captain

# Timing
X-TX-Timestamp:     1707772800000000123  # Unix nanoseconds
X-Clock-Source:     ptp|ntp|gps|unsynced
X-Clock-Quality:    locked|tracking|acquiring|freerun
X-NTP-Offset:       0.5                  # ms from reference
X-PTP-Offset:       -150                 # ns from PTP master

# Network
X-RTT-Native:       187452               # µs, transport layer
X-RTT-App:          291326               # µs, full pipeline
X-Link-Quality:     RSSI:-85,BER:0.04

# Sequencing
X-Sequence:         42
X-Gate-Timestamp:   1707689100.123       # Ingress timestamp

# Media
X-Codec:            OPUS-8K|ACELP|AMBE
X-Protocol-Origin:  TETRA|DMR|OPUS|VHF
X-Encryption:       TEA2|AES256|NONE
```

---

## 4. Timing & Synchronization Protocol

### 4.1 Clock Sources

| Source | Stratum | Accuracy | Use Case |
|--------|---------|----------|----------|
| **PTP** | 0-1 | <1µs | Radio sites with GPS |
| **NTP** | 1-15 | <10ms | General infrastructure |
| **GPS** | 0 | <100ns | Edge/mobile with GPS module |
| **Unsynced** | 16 | N/A | Fallback, indoor operation |

### 4.2 Time Sync Architecture

```
Master Node (Stratum 1)              Leaf Node
┌─────────────────────┐              ┌─────────────────────┐
│  GPS RTK ──► ptp4l  │◄────────────►│  ptp4l -s (slave)   │
│                     │   PTP        │       │             │
│  chronyd (backup)   │              ▼       ▼             │
└─────────────────────┘         ┌──────────────┐           │
                                │   Guardian   │           │
                                │  (publishes) │           │
                                └──────┬───────┘           │
                                       │                   │
                         ops.metric.time.{unitID}         │
                         ops.time.config                  │
```

### 4.3 Time Metrics Publication

**Subject:** `ops.metric.time.{unitID}`

**Headers:**
```
X-Unit-ID:          sdr-bridge-01
X-Clock-Source:     ptp
X-Clock-Quality:    locked
X-TX-Timestamp:     1707772800000000123
```

**Payload (JSON):**
```json
{
  "ts": 1707772800000,
  "unit_id": "sdr-bridge-01",
  "seq": 42,
  "ptp_enabled": true,
  "ptp_master": "00:11:22:33:44:55",
  "ptp_offset_ns": -150,
  "ntp_enabled": true,
  "ntp_offset_ms": 0.519,
  "active_source": "ptp",
  "clock_quality": "locked"
}
```

### 4.4 Clock Quality Levels

| Quality | PTP Offset | NTP Offset | Description |
|---------|------------|------------|-------------|
| `locked` | <1µs | <1ms | Fully synchronized |
| `tracking` | <100µs | <10ms | Converging |
| `acquiring` | >100µs | >10ms | Initial sync |
| `freerun` | N/A | N/A | No sync source |

### 4.5 Latency Calculation Modes

#### GPS Everywhere (Simple Subtraction)
When all sites use GPS/PTP:
```javascript
latency = receiverTime - senderTimestamp
```

#### Mixed Clocks (Offset Correction)
When sites use different time sources:
```javascript
const senderOffset = message.headers['X-NTP-Offset'];  // From sender
const myOffset = localTimeOffset;                       // From Guardian
const apparentLatency = myTime - senderTimestamp;
const trueLatency = apparentLatency - (myOffset - senderOffset);
```

---

## 5. RTT Measurement Protocol

### 5.1 Two-Layer Measurement

| Layer | Method | Precision | Purpose |
|-------|--------|-----------|---------|
| **Native** | `nc.RTT()` (Go) / echo (JS) | µs | Transport latency |
| **App** | Echo request-reply | µs | Full pipeline |

### 5.2 Echo Pattern

```
Client A                    Client B (Guardian)
   │                              │
   ├─ Request(ops.echo.B) ───────►│
   │  X-Sent-At: 1234567890       │
   │                              ├─ Record received timestamp
   │◄─ Response ──────────────────┤
   │  X-Server-Received-At        │
   │                              │
   └─ Calculate RTT ──────────────┘
```

### 5.3 RTT Metrics Publication

**Subject:** `ops.metric.rtt.{unitID}`

**Payload (JSON):**
```json
{
  "ts": 1707772800000,
  "unit_id": "sdr-bridge-01",
  "seq": 42,
  "native_rtt_us": 168,
  "app_rtt_us": 438
}
```

---

## 6. Client Identification Protocol

### 6.1 Unit ID Format

```
{prefix}-{type}-{os}-{random}

Examples:
  nats-ui-mobile-mac-a7b3     # iPhone Safari
  nats-ui-laptop-win-def4     # Windows Chrome
  nats-ui-tablet-ios-xyz9     # iPad
  guardian-deber              # Server Guardian - Germany, Berlin 
  sdr-bridge-01               # Hardware connector
```

### 6.2 Detection Logic

- **Type:** `mobile` (Mobi/Android/iPhone) vs `laptop` (desktop)
- **OS:** `win`, `mac`, `linux`, `ios`, `android`
- **Random:** 4-character base36 suffix

### 6.3 Override Mechanism

URL parameter for explicit identity:
```
https://nats.nunet.one:4280/?client=laptop-caia
https://nats.nunet.one:4280/?client=tablet-ops
```

---

## 7. Heartbeat Protocol

### 7.1 Client Heartbeat

**Subject:** `ops.heartbeat.{unitID}`  
**Frequency:** 5 seconds (configurable)

**Headers:**
```
X-Unit-ID:              sdr-bridge-01
X-Health-Status:        OK|DEGRADED|CRITICAL
X-CPU-Load:             12%
X-Memory-Usage:         45%
X-Uptime:               86400
X-Clock-Source:         ptp
X-Clock-Quality:        locked
X-RTT-Native:           187452
X-Sequence:             42
```

**Payload (optional detailed metrics):**
```json
{
  "active_connections": 3,
  "packets_sent": 15234,
  "packets_received": 15201
}
```

### 7.2 Health Status Levels

| Status | Description | Action |
|--------|-------------|--------|
| `OK` | Fully operational | None |
| `DEGRADED` | Reduced functionality | Monitor |
| `CRITICAL` | Core functions failing | Alert |
| `OFFLINE` | No heartbeat > timeout | Alert |

---

## 8. Provisioning Protocol

### 8.1 Flow Overview

```
Client                          Master
  │                               │
  ├── ops.provision.request ─────►│
  │   X-Hardware-ID               │
  │   X-Bootstrap-Hash            │
  │   X-Public-Key                │
  │                               │
  │◄── ops.provision.response.{unitID} ─┤
  │   (encrypted payload)         │
  │                               │
  ├── ops.provision.broadcast ───►│ (ongoing updates)
```

### 8.2 Request

**Subject:** `ops.provision.request`  
**Headers:**
```
X-Client-Version:   "1.2.3"
X-Hardware-ID:      "hw:aa:bb:cc:dd"
X-Bootstrap-Hash:   "sha256:..."
X-Public-Key:       "-----BEGIN PUBLIC KEY-----..."
```

### 8.3 Response

**Subject:** `ops.provision.response.{unitID}`  
**Headers:**
```
X-Response-Code:    200|401|403
```

**Payload (encrypted):**
```json
{
  "v": "1.0",
  "iat": 1707772800,
  "exp": 1707776400,
  "id": {
    "unit_id": "sdr-bridge-01",
    "tenant": "bridge",
    "role": "gateway"
  },
  "creds": {
    "jwt": "...",
    "seed": "..."
  },
  "caps": [...]
}
```

---

## 9. Logging Protocol

### 9.1 Log Subjects

```
ops.log.DEBUG.{unitID}      # Development
ops.log.INFO.{unitID}       # Normal operations
ops.log.WARN.{unitID}       # Anomalies
ops.log.ERROR.{unitID}      # Failures
ops.log.FATAL.{unitID}      # System halt
```

### 9.2 Log Format

**Headers:**
```
X-Unit-ID:      sdr-bridge-01
X-Timestamp:    2024-01-12T15:30:00Z
```

**Payload (JSON):**
```json
{
  "ts": "2024-01-12T15:30:00Z",
  "lvl": "INFO",
  "unit": "sdr-bridge-01",
  "comp": "ingestor",
  "msg": "PTT activated",
  "fields": {"channel": "ch16"},
  "trace": "req-12345"
}
```

---

## 10. Configuration

### 10.1 Environment Variables

```bash
# Time Sync
TIME_SYNC_MODE=auto           # ptp, chrony, or auto
PTP_MASTER_ADDRESS=10.0.0.1   # PTP Grandmaster
PTP_DOMAIN=0
NTP_SERVERS=pool.ntp.org,time.google.com
PTP_HW_TIMESTAMP=true

# NATS
NATS_URL=nats://localhost:4222
NATS_SYS_USER=sys
NATS_SYS_PASSWORD=...

# Guardian
GUARDIAN_HEARTBEAT_INTERVAL=5s
GUARDIAN_RTT_INTERVAL=30s
```

### 10.2 Connector Profile (YAML)

```yaml
metadata:
  unit_id: "sdr-bridge-01"
  tenant: "bridge"
  role: "gateway"

connection:
  urls: ["nats://vm1:4222", "nats://vm2:4222"]
  reconnect_wait: 5s

health:
  heartbeat_interval: 5s

capabilities:
  - subject: "com.bridge.vhf.>.voice"
    allow: ["pub", "sub"]
```

---

## Appendix A: Subject Quick Reference

| Purpose | Subject Pattern |
|---------|-----------------|
| All heartbeats | `ops.heartbeat.*` |
| All RTT metrics | `ops.metric.rtt.>` |
| All time metrics | `ops.metric.time.>` |
| Time config | `ops.time.config` |
| Echo probe | `ops.echo.{unitID}` |
| Provisioning | `ops.provision.request` |
| Voice channel | `com.{tenant}.vhf.*.ch16.voice` |
| All logs | `ops.log.>` |
| Error logs | `ops.log.ERROR.>` |

## Appendix B: Header Quick Reference

| Category | Headers |
|----------|---------|
| Identity | `X-Unit-ID`, `X-Origin-ID`, `X-Tenant`, `X-Sender-Alias` |
| Timing | `X-TX-Timestamp`, `X-Clock-Source`, `X-Clock-Quality`, `X-NTP-Offset` |
| Network | `X-RTT-Native`, `X-RTT-App`, `X-Link-Quality` |
| Sequencing | `X-Sequence`, `X-Gate-Timestamp` |
| Media | `X-Codec`, `X-Protocol-Origin`, `X-Encryption` |
| Health | `X-Health-Status`, `X-CPU-Load`, `X-Memory-Usage`, `X-Uptime` |

---

**See Also:**
- `voice-protocol-spec-draft.md` - Voice/PTT specific protocol
- `qos-protocol-spec-draft.md` - QoS mechanisms and adaptive modes
