# nunect Architecture (Draft)

**System architecture and design decisions for the nunect message backbone.**

---

## 1. System Architecture

### 1.1 Layer Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                          │
│  (PTT Voice, Telemetry, Media Streaming, Business Data)         │
├─────────────────────────────────────────────────────────────────┤
│                      PROTOCOL LAYER                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Base       │  │   Voice      │  │   QoS                │   │
│  │  Protocol    │  │  Protocol    │  │  Protocol            │   │
│  │  (Headers,   │  │  (Frames,    │  │  (Adaptive,          │   │
│  │   Timing)    │  │   PTT)       │  │   Mission Critical)  │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                      PLUGIN MODULES                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Guardian   │  │  NATS Mgr    │  │   Generic Client     │   │
│  │   (Go)       │  │  UI (JS/TS)  │  │   (TS/JS)            │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                      NATS TRANSPORT LAYER                       │
│         (Pub/Sub, Wildcards, Request-Reply, JetStream)          │
├─────────────────────────────────────────────────────────────────┤
│                      INFRASTRUCTURE LAYER                       │
│         (PTP/NTP Time, TLS/mTLS, Leaf Nodes, Mesh)              │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Design Philosophy

**We configure NATS. We build plugins.**

| Layer | Source | Rationale |
|-------|--------|-----------|
| Transport | NATS | Battle-tested, efficient, scalable |
| Auth/Security | NATS | JWT, NKeys, TLS - don't reinvent |
| Routing | NATS | Wildcard subjects, pub/sub patterns |
| Health/Metrics | **We build** | Application-level awareness |
| Time Sync | **We build** | PTP/Chrony integration |
| QoS Logic | **We build** | Adaptive algorithms |

---

## 2. Base Orchestrator (NATS)

### 2.1 What NATS Provides

**Authentication:**
- Username/password
- NKeys
- JWT (JSON Web Tokens)
- TLS/mTLS

**Authorization:**
- Per-user pub/sub permissions
- Account isolation (multi-tenancy)
- Subject-based access control

**Transport:**
- TCP, WebSocket, TLS
- Request-reply pattern
- Queue groups for load balancing
- JetStream persistence

**Monitoring:**
- `$SYS` events (CONNECT, DISCONNECT, etc.)
- HTTP API (`/varz`, `/connz`, `/subsz`)
- Connection stats (RTT per connection)

### 2.2 Critical Distinction: HTTP API vs Configuration

| Capability | HTTP API | Config File |
|------------|----------|-------------|
| Read server stats | ✅ `/varz`, `/connz` | ❌ |
| Read live events | ❌ (poll only) | ✅ Subscribe `$SYS.>` |
| Modify users/accounts | ❌ **Not possible** | ✅ Edit `nats-server.conf` |
| Change permissions | ❌ **Not possible** | ✅ Edit + `nats-server -signal reload` |

**Configuration changes require file edit + signal reload.**

### 2.3 Subject Hierarchy Design

```
[domain].[tenant].[sourceType].[sourceID].[targetGroup].[dataType]

Design rationale:
- Hierarchical enables efficient wildcard filtering
- Domain-first allows network-level isolation
- Tenant separates organizations
- Wildcards (*) at upper levels, specifics at lower
```

---

## 3. Plugin Architecture

### 3.1 Plugin Isolation Rules

| Plugin | Location | Responsibility | Production Path |
|--------|----------|----------------|-----------------|
| Guardian | `cmd/guardian/` | Health, RTT, Time sync | Systemd service |
| NATS Manager UI | `web/nats-manager/` | Dashboard | Cloudflare Worker |
| Generic Client | `clients/ts/nunect-client/` | Reusable client lib | npm package |
| TimeSync Lib | `internal/timesync/` | PTP/Chrony interface | Shared library |

### 3.2 Plugin Boundaries

**Plugins MAY:**
- Publish/subscribe to any subject (per permissions)
- Add HTTP endpoints (UI)
- Extend protocol with new subjects

**Plugins MUST NOT:**
- Modify NATS server configuration
- Implement authentication (use NATS)
- Bypass subject hierarchy

### 3.3 Plugin Lifecycle

```
Development → Test → Integration → Production
     │           │          │            │
     ▼           ▼          ▼            ▼
  Local      Docker     Staging    Systemd/Worker
  Dev         Test      Validate    Deploy
```

---

## 4. Time Synchronization Architecture

### 4.1 Clock Sources Hierarchy

```
Stratum 0: GPS RTK (Primary)
    │
    ▼
Stratum 1: ptp4l Grandmaster (Hardware PTP)
    │
    ├──► Leaf Node A: ptp4l -s (PTP Slave)
    │       └── Guardian publishes ops.metric.time
    │
    └──► Leaf Node B: chronyd (NTP fallback)
            └── Guardian publishes ops.metric.time
```

### 4.2 Guardian Time Sync Flow

```
1. Detect active time source
   ├─ Read /run/ptp/status (PTP)
   ├─ Query pmc (PTP management client)
   └─ Query chronyc (NTP)

2. Determine quality
   ├─ locked: PTP <1µs, NTP <1ms
   ├─ tracking: PTP <100µs, NTP <10ms
   ├─ acquiring: PTP >100µs, NTP >10ms
   └─ freerun: no sync source

3. Publish metrics
   ├─ ops.metric.time.{unitID} (JSON payload)
   ├─ ops.time.config (global config)
   └─ Add headers to heartbeats
```

### 4.3 Distributed Timing Strategies

**GPS Everywhere:**
- All sites GPS-locked
- Direct timestamp comparison
- Simple subtraction for latency

**Mixed Clocks:**
- Some GPS, some NTP
- Guardian publishes global offsets
- Client-side skew correction

**All Unsynced:**
- Indoor/emergency operation
- Mission Critical mode
- Windowed playback with late insertion

---

## 5. RTT Measurement Architecture

### 5.1 Two-Layer Design

| Layer | Mechanism | Precision | Information |
|-------|-----------|-----------|-------------|
| **Native** | `nc.RTT()` (Go) | µs | Transport latency only |
| **App** | Echo request-reply | µs | Full pipeline (network + app) |

### 5.2 Why Two Layers?

- **Native:** Separates transport issues from application issues
- **App:** Captures real user-perceived latency
- **Difference:** Reveals processing overhead

### 5.3 Echo Pattern

```
Client A                              Client B
   │                                     │
   ├─ Publish(ops.echo.B) ──────────────►│
   │   Headers:                          │
   │   X-Sent-At: T1                     │
   │   X-Unit-ID: A                      │
   │                                     │
   │◄─ Publish(ops.echo.A) ──────────────┤
   │   Headers:                          │
   │   X-Server-Received-At: T2          │
   │   X-Sent-At: T3                     │
   │                                     │
   │  App RTT = (T4 - T1) - (T3 - T2)    │
   │                                     │
```

---

## 6. QoS Architecture

### 6.1 Guardian Advises, Clients Vote

```
                    ┌─────────────────┐
                    │   qos.global    │
                    │    .status      │
                    │  (aggregation)  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Guardian    │    │   Guardian    │    │   Guardian    │
│   Node A      │    │   Node B      │    │   Node C      │
│               │    │               │    │               │
│ qos.local     │    │ qos.local     │    │ qos.local     │
│ .advisory     │    │ .advisory     │    │ .advisory     │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│    Client     │    │    Client     │    │    Client     │
│      A1       │    │      B1       │    │      C1       │
│               │    │               │    │               │
│ qos.client    │    │ qos.client    │    │ qos.client    │
│ .status       │    │ .status       │    │ .status       │
└───────────────┘    └───────────────┘    └───────────────┘
```

### 6.2 Local vs Global QoS

| Aspect | Local (Guardian) | Global (Aggregation) |
|--------|-----------------|---------------------|
| **Scope** | Single node | All nodes |
| **Frequency** | Every 5-30s | Every 30-60s |
| **Data** | Link quality, local clock | Network health, clock skew |
| **Decision** | Frame size, buffer | Playback mode |
| **Subject** | `qos.local.advisory` | `qos.global.advisory` |

### 6.3 Adaptive Parameters

| Parameter | Local Control | Global Override |
|-----------|--------------|-----------------|
| Frame size (20/40/60ms) | ✅ | ❌ |
| Bitrate | ✅ | ❌ |
| Buffer size | ✅ | ✅ (min/max) |
| Playback mode | ❌ | ✅ |
| Redundancy/FEC | ✅ | ❌ |

---

## 7. Scaling Architecture

### 7.1 Scale Spectrum

```
Femto Node              Mesh                    Enterprise         Global
(nuNode)               (MANET)                   (Leaf)           (Core)
   │                     │                        │                │
Raspberry Pi    ←──►  Fire Dept             ←──►  Regional    ←──►  Cloud
+$15 Radio           Team Mesh                  Office            Cluster

$50                   $500                     $5k               $50k+
2W power             20W                       200W              Unlimited
500mW radio          Multi-radio               Fiber/5G          Backbone
```

### 7.2 Deployment Patterns

**Femto Node (nuNode):**
- Raspberry Pi Zero 2 W + AliExpress 500mW radio
- OpenWRT, BATMAN-adv mesh
- NATS Leaf Node
- Guardian with battery/thermal monitoring

**Mesh Network:**
- Multiple nuNodes with mesh routing
- Self-healing topology
- Guardian neighbor discovery
- QoS-based handover

**Enterprise Leaf:**
- Banana Pi BPI-R4 or x86
- PTP hardware timestamping
- 5GHz PtP backhaul
- Local JetStream persistence

**Global Core:**
- Cloud cluster (K8s)
- Multi-region with gateways
- Central provisioning
- Analytics aggregation

### 7.3 Leaf Node Architecture

```
Central Cluster                    Leaf Node (Site)
┌─────────────┐                   ┌───────────────┐
│  NATS Core  │◄────── TLS ──────►│  NATS Leaf    │
│             │    Leaf Conn      │               │
│  Accounts   │                   │  Local Cache  │
│  JetStream  │                   │  Local QoS    │
└─────────────┘                   └───────┬───────┘
                                          │
                              ┌───────────┼───────────┐
                              ▼           ▼           ▼
                         ┌────────┐  ┌────────┐  ┌────────┐
                         │ Radio  │  │  WiFi  │  │  PTP   │
                         │ Gateway│  │   APs  │  │ Master │
                         └────────┘  └────────┘  └────────┘
```

---

## 8. Security Architecture

### 8.1 NATS Security (We Configure)

| Layer | Mechanism |
|-------|-----------|
| Transport | TLS 1.3 / mTLS |
| Authentication | JWT, NKeys, username/password |
| Authorization | Subject permissions per user |
| Accounts | Multi-tenancy isolation |

### 8.2 Application Security (We Build)

| Component | Security |
|-----------|----------|
| Provisioning | Bootstrap tokens + asymmetric encryption |
| Payload | AES-256-GCM per tenant |
| Keys | Hardware security modules (production) |

### 8.3 Security Boundary

```
┌─────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                           │
├─────────────────────────────────────────────────────────────┤
│  TLS/mTLS           →  Transport encryption (NATS)           │
├─────────────────────────────────────────────────────────────┤
│  JWT/NKeys          →  Connection authentication (NATS)      │
├─────────────────────────────────────────────────────────────┤
│  Subject Perms      →  Authorization (NATS config)           │
├─────────────────────────────────────────────────────────────┤
│  Bootstrap Tokens   →  Provisioning auth (We build)          │
├─────────────────────────────────────────────────────────────┤
│  Payload Encryption →  Application layer (We build)          │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Configuration Management

### 9.1 Configuration Files

| File | Purpose | Mutable At Runtime |
|------|---------|-------------------|
| `.env` | Environment variables | ❌ (restart required) |
| `config/nats-server.conf` | NATS configuration | ⚠️ (reload signal) |
| `config/nats-server-runtime.conf` | Generated config | ❌ |
| `connector-profile.yaml` | Client capabilities | ❌ |

### 9.2 Environment Variables

```bash
# Core
NATS_URL, NATS_HTTP_URL, NATS_WS_URL
NATS_SYS_USER, NATS_SYS_PASSWORD

# Time Sync
TIME_SYNC_MODE, PTP_MASTER_ADDRESS
NTP_SERVERS, PTP_DOMAIN

# UI
NATS_MANAGER_DOMAIN, NATS_MANAGER_CORS_ORIGINS

# Feature Flags
ENABLE_PTP, ENABLE_METRICS_DEBUG
```

---

## 10. Development Guidelines

### 10.1 Code Organization

```
cmd/           → Go services (Guardian)
internal/      → Shared libraries (timesync)
web/           → UI components (NATS Manager)
clients/       → SDKs (TS/JS client)
config/        → Configuration files
scripts/       → Startup/management scripts
```

### 10.2 Isolation Rules

- **NATS config** in `config/` only
- **UI code** in `web/` only
- **Go services** in `cmd/` only
- **Shared libs** in `internal/` only
- **Client SDKs** in `clients/` only

### 10.3 Change Approval

Modify architecture ONLY for:
- NATS topology changes (clustering, gateways)
- New authentication mechanisms
- Subject hierarchy changes (breaking)
- Plugin boundary changes
- New time sync protocols

---

## Appendix A: Subject Reference

| Domain | Pattern | Purpose |
|--------|---------|---------|
| `ops` | `ops.heartbeat.*` | Health monitoring |
| `ops` | `ops.metric.>` | All metrics |
| `ops` | `ops.log.>` | All logs |
| `ops` | `ops.provision.*` | Provisioning |
| `com` | `com.{t}.*.*.*.voice` | Voice traffic |
| `com` | `com.{t}.*.*.*.ptt` | PTT control |
| `nav` | `nav.{t}.*.*.*.data` | Navigation |
| `qos` | `qos.local.advisory` | Local QoS |
| `qos` | `qos.global.*` | Global QoS |

---

## Appendix B: Protocol Documents

| Document | Scope |
|----------|-------|
| `protocol-spec-draft.md` | Base protocol: messages, headers, timing |
| `voice-protocol-spec-draft.md` | Voice/PTT: frames, control, codecs |
| `qos-protocol-spec-draft.md` | QoS: adaptive algorithms, Mission Critical |

---

**Vision:** *Guardian advises. Clients vote. The network adapts. One codebase. Infinite scalability.*
