# nunect - novamarc NATS Data Backend

## Overview

nunect is novamarc's multi-mime data-queue based on NATS. It serves as a universal and agnostic data-backbone connecting voice, data, and media services to their users and amongst each other.

### Supported Data Types

| Category | Services |
|----------|----------|
| **Data** | Business Information, Telemetry, Messaging, Geo |
| **Voice** | PTT-PoC, PTT-PMR (DMR, P25, TETRA, Analog), Voice Chat, Voice Transcription |
| **Media** | Real-time streams, Recordings, AI-processing |

---

## Core Design Principles

```
┌─────────────────────────────────────────────────────────────────┐
│                     nunect Message Anatomy                       │
├─────────────────────────────────────────────────────────────────┤
│  SUBJECT  →  Logical Routing (Who needs to know? Where to?)      │
│  HEADERS  →  Protocol Metadata (What is it? How is it packaged?) │
│  PAYLOAD  →  Immutable Raw Data (Opus/DMR/Tetra block)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## I. Subject Hierarchy (Optimized for Routing)

### 1.1 Base Structure

The subject hierarchy uses a 6-level dot-notation optimized for NATS wildcard filtering:

```
[domain].[tenant].[sourceType].[sourceID].[targetGroup].[dataType]
```

| Level | Example | Description |
|-------|---------|-------------|
| `domain` | `nav`, `com`, `ops` | Top-level isolation (Navigation, Communication, Operations) |
| `tenant` | `bridge`, `engine`, `pax` | Organizational isolation |
| `sourceType` | `vhf`, `tetra`, `web`, `edi` | Connector technology |
| `sourceID` | `sdr01`, `handheld22` | Unique physical device/client ID |
| `targetGroup` | `ch16`, `all`, `zoll` | Logical group or channel |
| `dataType` | `voice`, `data`, `meta`, `cmd` | Payload classification |

### 1.2 Domain-Specific Subjects

#### ops. - Operations & Management

```
ops.heartbeat.{unitID}              → Client health beacons
ops.provision.request               → Provisioning requests (new clients)
ops.provision.response.{unitID}     → Individual provisioning response
ops.provision.broadcast             → Global config updates
ops.log.{level}.{unitID}            → Structured logging stream
ops.metric.{type}.{unitID}          → Performance metrics
ops.cmd.{targetType}.{targetID}     → Command dispatch
ops.status.{targetType}.{targetID}  → Status reports
```

#### com. - Communication (PTT/Messaging)

```
com.{tenant}.{tech}.{sourceID}.{group}.voice    → Real-time audio
com.{tenant}.{tech}.{sourceID}.{group}.data     → SDS/text messages
com.{tenant}.{tech}.{sourceID}.{group}.presence → Availability status
```

#### nav. - Navigation & Telemetry

```
nav.{tenant}.{sensor}.{sourceID}.all.data       → Position/telemetry
nav.{tenant}.{sensor}.{sourceID}.all.ais        → AIS vessel data
nav.{tenant}.{sensor}.{sourceID}.all.gmdss      → Distress signals
```

### 1.3 Wildcard Patterns for Efficient Filtering

```go
// Subscribe to all voice in a tenant
nc.Subscribe("com.bridge.*.*.*.voice", handler)

// Subscribe to all heartbeats (health monitoring)
nc.Subscribe("ops.heartbeat.*", handler)

// Subscribe to all operations logs
nc.Subscribe("ops.log.>", handler)

// Subscribe to specific group across all sources
nc.Subscribe("com.bridge.vhf.*.ch16.voice", handler)
```

---

## II. NATS Header Specification

### 2.1 Universal Radio Header

All messages MUST include these headers for protocol interoperability:

| Header | Example | Purpose |
|--------|---------|---------|
| `X-Protocol-Origin` | `TETRA`, `DMR`, `OPUS` | Source technology |
| `X-Origin-ID` | `SSI-12345`, `DMR-ID-789` | Original device identifier |
| `X-Sequence` | `5589` | Packet sequence for ordering/recovery |
| `X-Codec` | `ACELP`, `OPUS-8K`, `AMBE` | Audio codec information |
| `X-Encryption` | `TEA2`, `AES256`, `NONE` | Encryption status |
| `X-Gate-Timestamp` | `1707689100.123` | Ingress timestamp (Unix seconds.ms) |
| `X-Tenant` | `bridge`, `engine` | Tenant isolation marker |
| `X-Unit-ID` | `sdr-bridge-01` | Originating unit identifier |

### 2.2 Quality & Routing Headers

| Header | Example | Purpose |
|--------|---------|---------|
| `X-Link-Quality` | `RSSI:-85,BER:0.04` | Physical layer quality metrics |
| `X-Packet-Sequence` | `10234` | Global sequence for reconstruction |
| `X-Origin-TS` | `1707689100.123` | Original transmission timestamp |
| `X-Sender-Alias` | `Captain`, `SDR-Bridge-1` | Human-readable identifier |
| `X-Security-Context` | `BOS-TEA2`, `AES256` | Security classification |
| `X-Routing-Hops` | `3` | Hop count for loop detection |

### 2.3 Health Check Headers

| Header | Example | Purpose |
|--------|---------|---------|
| `X-Health-Status` | `OK`, `DEGRADED`, `CRITICAL` | Component health state |
| `X-CPU-Load` | `12%` | System CPU utilization |
| `X-Memory-Usage` | `45%` | Memory utilization |
| `X-Uptime` | `86400` | Seconds since start |
| `X-RSSI` | `-60dBm` | Signal strength (if applicable) |
| `X-RTT` | `23ms` | Round-trip time measurement |

---

## III. Master-Assistant Provisioning Architecture

### 3.1 Overview

The provisioning system enables secure, automated onboarding of new clients through a Master-Assistant pattern:

```
┌─────────────┐      Request       ┌──────────────┐
│   Client    │ ─────────────────> │   Master     │
│  (Booting)  │                    │ (Provisioning)│
│             │ <───────────────── │              │
│             │   Encrypted Config  │              │
└───────────────┘                    └──────────────┘
         │                                  │
         │         ops.provision.*          │
         └──────────────────────────────────┘
```

### 3.2 Provisioning Flow

```
1. CLIENT BOOT
   └── Generate ephemeral keypair
   └── Load bootstrap token (pre-shared or from secure storage)

2. PROVISIONING REQUEST
   └── Publish to: ops.provision.request
   └── Headers:
       X-Client-Version: "1.2.3"
       X-Hardware-ID: "hw:aa:bb:cc:dd"
       X-Bootstrap-Hash: "sha256:..." (partial token hash for validation)
       X-Public-Key: "-----BEGIN PUBLIC KEY-----..."

3. MASTER VALIDATION
   └── Verify bootstrap token hash
   └── Generate unique UnitID
   └── Create client-specific profile

4. ENCRYPTED RESPONSE
   └── Publish to: ops.provision.response.{unitID}
   └── Payload encrypted with client's public key
   └── Contains:
       - JWT for NATS authentication
       - Subject whitelist (capabilities)
       - Encryption keys for data channels
       - Master public key for verification

5. CLIENT ACTIVATION
   └── Decrypt response with private key
   └── Configure NATS connection with JWT
   └── Begin normal operation
```

### 3.3 Provisioning Subject Specification

```
ops.provision.request
  → Clients: PUBLISH
  → Master: SUBSCRIBE
  → Headers: X-Hardware-ID, X-Bootstrap-Hash, X-Public-Key, X-Client-Version
  → Payload: JSON with capabilities request

ops.provision.response.{unitID}
  → Master: PUBLISH
  → Target Client: SUBSCRIBE (ephemeral subscription)
  → Headers: X-Response-Code (200, 401, 403)
  → Payload: Encrypted provisioning package

ops.provision.broadcast
  → Master: PUBLISH
  → All Clients: SUBSCRIBE
  → Purpose: Global config updates, revocation notices
```

### 3.4 Encrypted Provisioning Package Format

```go
type ProvisioningPackage struct {
    Version      string          `json:"v"`          // Package format version
    IssuedAt     int64           `json:"iat"`        // Unix timestamp
    ExpiresAt    int64           `json:"exp"`        // Expiration timestamp
    
    Identity struct {
        UnitID       string      `json:"unit_id"`
        Tenant       string      `json:"tenant"`
        Role         string      `json:"role"`       // gateway, client, repeater
    } `json:"id"`
    
    Credentials struct {
        JWT          string      `json:"jwt"`        // NATS JWT
        Seed         string      `json:"seed"`       // Encrypted seed
        MasterKey    string      `json:"master_key"` // For verification
    } `json:"creds"`
    
    Capabilities []Capability   `json:"caps"`        // Subject permissions
    
    Encryption struct {
        DataKey      string      `json:"data_key"`   // For payload encryption
        Algorithm    string      `json:"alg"`        // e.g., "AES-256-GCM"
    } `json:"enc"`
}
```

---

## IV. Health Check Architecture

### 4.1 Health Check Types

#### Client → Server (Heartbeat)

```
Subject: ops.heartbeat.{unitID}
Frequency: 5 seconds (configurable)
Headers:
  X-Unit-ID: "sdr-bridge-01"
  X-Health-Status: "OK" | "DEGRADED" | "CRITICAL"
  X-CPU-Load: "12%"
  X-Memory-Usage: "45%"
  X-Uptime: "86400"
  X-Active-Connections: "3"
  
Payload: Optional detailed metrics JSON
```

#### Server → Client (Health Probe)

```
Subject: ops.cmd.{unitType}.{unitID}
Command: HEALTH_PROBE

Response on: ops.status.{unitType}.{unitID}
Headers:
  X-Response-To: "HEALTH_PROBE"
  x-RSSI-Wifi: "-85"
  x-RSSI-5G: "-76"
  X-RTT-Wifi: "23ms"
  X-Health-Status: "OK"
  X-GPS: "53.85764, 13.10756"
```

#### Server ↔ Server (Inter-node Health)

```
Subject: ops.health.cluster.{nodeID}
Purpose: Cluster-aware health for distributed setups
Headers:
  X-Node-ID: "nats-vm-01"
  X-Cluster-State: "HEALTHY" | "DEGRADED" | "PARTITIONED"
  X-Peer-Count: "3"
  X-Stream-Lag: "0"
```

### 4.2 Health Status Levels

| Status | Description | Action Required |
|--------|-------------|-----------------|
| `OK` | Fully operational | None |
| `DEGRADED` | Reduced functionality | Monitor closely |
| `CRITICAL` | Core functions failing | Immediate attention |
| `OFFLINE` | No heartbeat received | Alert operators |

---

## V. Logging Architecture

### 5.1 Log Subjects

```
ops.log.{severity}.{unitID}

Severity levels:
  - DEBUG   → Development/troubleshooting
  - INFO    → Normal operations
  - WARN    → Anomalies, recoverable errors
  - ERROR   → Failures, data loss risk
  - FATAL   → System halt, unrecoverable
```

### 5.2 Log Message Format

```go
type LogEntry struct {
    Timestamp   string          `json:"ts"`         // RFC3339
    Level       string          `json:"lvl"`        // DEBUG, INFO, WARN, ERROR, FATAL
    UnitID      string          `json:"unit"`       // Source unit
    Component   string          `json:"comp"`       // e.g., "ingestor", "codec"
    Message     string          `json:"msg"`        // Human-readable
    Fields      map[string]any  `json:"fields"`     // Structured data
    TraceID     string          `json:"trace"`      // Request correlation
}
```

### 5.3 Log Routing Patterns

```go
// Centralized logging service
nc.Subscribe("ops.log.>", logHandler)

// Error-only alerting
nc.Subscribe("ops.log.ERROR.*", alertHandler)
nc.Subscribe("ops.log.FATAL.*", pageOnCallHandler)

// Per-unit log aggregation
nc.Subscribe("ops.log.*.sdr-bridge-01", unitLogHandler)
```

---

## VI. Reusable Component Architecture

### 6.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    nunect Component Library                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Connector  │  │ Provisioner  │  │ HealthCheck  │           │
│  │    Core      │  │              │  │              │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│         │                 │                 │                    │
│  ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐            │
│  │   NATS     │   │   Crypto    │   │   Metrics   │            │
│  │   Client   │   │   (Token)   │   │   (RTT, etc)│            │
│  └─────────────┘   └─────────────┘   └─────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Connector Interface

```go
// Connector is the base interface for all nunect connectors
package connector

type Connector interface {
    // Lifecycle
    Start() error
    Stop() error
    
    // Connection
    Connect(urls []string, jwt string) error
    IsConnected() bool
    
    // Publishing
    Publish(subject string, payload []byte, headers nats.Header) error
    PublishAsync(subject string, payload []byte, headers nats.Header) error
    
    // Subscribing
    Subscribe(subject string, handler MessageHandler) (*Subscription, error)
    SubscribeQueue(subject, queue string, handler MessageHandler) (*Subscription, error)
    
    // Health
    Health() HealthStatus
    Metrics() Metrics
}

// MessageHandler processes incoming messages
type MessageHandler func(msg *Message) error

// Message wraps NATS message with nunect context
type Message struct {
    Subject     string
    Headers     nats.Header
    Payload     []byte
    ReceivedAt  time.Time
    ReplyFunc   func([]byte, nats.Header) error
}
```

### 6.3 Provisioner Component

```go
package provisioner

// Client-side provisioner
type Client struct {
    bootstrapToken string
    privateKey     crypto.PrivateKey
    onProvisioned  func(Config) error
}

func NewClient(bootstrapToken string, onProvisioned func(Config) error) *Client
func (c *Client) RequestProvisioning(masterURL string) error
func (c *Client) DecryptResponse(encrypted []byte) (*Config, error)

// Server-side provisioner
type Server struct {
    validator     TokenValidator
    keyGenerator  KeyGenerator
    configBuilder ConfigBuilder
}

func NewServer(validator TokenValidator) *Server
func (s *Server) HandleRequest(req Request) (*Response, error)
func (s *Server) Revoke(unitID string) error
```

### 6.4 Health Check Component

```go
package health

// Client-side heartbeat
type Heartbeater struct {
    interval   time.Duration
    unitID     string
    statusFunc func() Status
    nc         *nats.Conn
}

func NewHeartbeater(unitID string, interval time.Duration, nc *nats.Conn) *Heartbeater
func (h *Heartbeater) Start() error
func (h *Heartbeater) Stop() error
func (h *Heartbeater) UpdateStatus(status Status)

// Server-side health monitor
type Monitor struct {
    timeout      time.Duration
    onOffline    func(unitID string)
    onDegraded   func(unitID string, status Status)
}

func NewMonitor(timeout time.Duration) *Monitor
func (m *Monitor) StartTracking(unitID string)
func (m *Monitor) StopTracking(unitID string)
func (m *Monitor) HandleHeartbeat(hb Heartbeat) error
```

### 6.5 Logger Component

```go
package logger

type Logger struct {
    unitID    string
    minLevel  Level
    nc        *nats.Conn
    fields    map[string]any
}

func New(unitID string, nc *nats.Conn, minLevel Level) *Logger
func (l *Logger) WithField(key string, value any) *Logger
func (l *Logger) Debug(msg string)
func (l *Logger) Info(msg string)
func (l *Logger) Warn(msg string)
func (l *Logger) Error(msg string)
func (l *Logger) Fatal(msg string)

// Usage example:
// logger.New("sdr-01", nc, logger.INFO).
//     WithField("channel", "ch16").
//     Info("PTT activated")
```

---

## VII. Protocol Translation Workflow

### 7.1 The Translation Pipeline

```
┌──────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────┐
│  TETRA   │───>│  Ingestor   │───>│  Transcoder  │───>│  Vue.js  │
│ Gateway  │    │  (Go)       │    │  (Go)        │    │  Client  │
└──────────┘    └─────────────┘    └──────────────┘    └──────────┘
                       │                   │
                       v                   v
              com.bridge.tetra.    com.bridge.opus.
              sdr01.ch16.voice     web.*.ch16.voice
```

### 7.2 Multi-Constraint Voting

Vue clients can implement intelligent packet selection:

```go
// Client receives same packet via multiple paths
packets := []Packet{
    // Via P5G (IP network)
    {Source: "IP", Latency: 20ms, RSSI: -50, Seq: 5589},
    // Via SAT (TETRA gateway)
    {Source: "TETRA-GW", Latency: 400ms, RSSI: -70, Seq: 5589},
}

// Voting decision based on headers only (zero-copy)
best := selectBestPacket(packets)
// Result: Select P5G, cache SAT as fallback
```

---

## VIII. Configuration Example

### 8.1 Connector Profile (YAML)

```yaml
# connector-profile.yaml
metadata:
  unit_id: "sdr-bridge-01"
  tenant: "bridge"
  role: "gateway"
  version: "1.2.3"

connection:
  urls:
    - "nats://vm1:4222"
    - "nats://vm2:4222"
    - "nats://vm3:4222"
  reconnect_wait: 5s
  max_reconnects: 10

provisioning:
  bootstrap_token: "${BOOTSTRAP_TOKEN}"  # From env
  master_url: "nats://provision.novamarc.local:4222"
  auto_provision: true

health:
  heartbeat_interval: 5s
  report_metrics: true

capabilities:
  - subject: "com.bridge.vhf.>.voice"
    allow: ["pub", "sub"]
  - subject: "nav.bridge.vhf.>.data"
    allow: ["pub"]
  - subject: "ops.heartbeat.sdr-bridge-01"
    allow: ["pub"]
  - subject: "ops.cmd.gateway.sdr-bridge-01"
    allow: ["sub"]
  - subject: "ops.log.INFO.sdr-bridge-01"
    allow: ["pub"]

logging:
  min_level: "INFO"
  include_fields: ["X-Origin-ID", "X-Link-Quality"]
```

---

## IX. Quick Reference

### 9.1 Subject Quick Reference

| Purpose | Subject Pattern | Wildcard |
|---------|-----------------|----------|
| All voice in tenant | `com.bridge.>.voice` | `>` |
| Specific channel | `com.bridge.vhf.*.ch16.voice` | `*` |
| All heartbeats | `ops.heartbeat.*` | `*` |
| All logs | `ops.log.>` | `>` |
| Error logs only | `ops.log.ERROR.>` | `>` |
| Provisioning requests | `ops.provision.request` | - |
| Individual response | `ops.provision.response.{unitID}` | - |

### 9.2 Header Quick Reference

| Category | Headers |
|----------|---------|
| Identity | `X-Unit-ID`, `X-Origin-ID`, `X-Sender-Alias`, `X-Tenant` |
| Timing | `X-Gate-Timestamp`, `X-Origin-TS` |
| Media | `X-Codec`, `X-Encryption`, `X-Protocol-Origin` |
| Quality | `X-Link-Quality`, `X-RSSI`, `X-RTT` |
| Routing | `X-Sequence`, `X-Routing-Hops` |
| Health | `X-Health-Status`, `X-CPU-Load`, `X-Memory-Usage`, `X-Uptime` |

---

---

## XI. Architecture: Native vs Custom Boundary

**Design principle: Use NATS native functionality wherever possible. Build only what NATS does not provide.**

### NATS Core Provides (we configure, not build)

| Feature | NATS Mechanism | Our Usage |
|---------|---------------|-----------|
| Authentication | Username/password, NKeys, JWT, TLS | Configure per deployment |
| Authorization | Per-user pub/sub permissions | Define in config |
| Account isolation | Multi-tenancy via Accounts | One account per tenant |
| Message routing | Pub/sub with wildcards | Subject hierarchy defined |
| Connection events | `$SYS.ACCOUNT.*.CONNECT/DISCONNECT` | Subscribe for monitoring |
| Connection stats | HTTP `/connz`, RTT per connection | Dashboard queries |
| Server health | HTTP `/varz`, `$SYS.REQ.SERVER.PING` | Dashboard queries |
| Slow consumer detection | Server closes lagging connections | Monitor `$SYS` events |
| Transport encryption | TLS/mTLS | Configure certificates |

### We Build (what NATS lacks)

| Component | Purpose | Why Custom |
|-----------|---------|------------|
| **Guardian** (Go) | Application heartbeat publisher | NATS knows connection state, not app health (CPU, memory, RSSI) |
| **Controller** (Go + Vue) | Dashboard, provisioning orchestration | Business logic, tenant assignment, human UI |
| **ProMan** (Go) | Provisioning execution | Receives orders from Controller, interacts with `nsc`/resolver |
| **Generic Client** (TS/JS) | Browser/client connectivity, logging | WebSocket support, application logging |

### Security Boundary

- **NATS handles**: Connection authentication, transport security, message authorization
- **We handle**: Bootstrap token validation, provisioning workflow, application-level access control
- **Critical**: We do NOT reimplement NATS auth; we use NATS native auth mechanisms

---

## XII. Implementation Roadmap

### Phase 1: Foundation

#### 1.1 NATS Core Server ✅ COMPLETE
- [x] `scripts/nats-server.sh` - startup script with config
- [x] `config/nats-server.conf` - base configuration:
  - [x] Accounts for tenants (SYS, BRIDGE, ENGINE, PROVISION)
  - [x] System account (`SYS`) for monitoring
  - [x] HTTPS monitoring port (8444) with TLS
  - [x] WebSocket Secure port (8443) with TLS
  - [x] JetStream enabled for log persistence
  - [x] Initial users for development

#### 1.2 NATS Management UI (Vue-ready vanilla component) 🟡 IN PROGRESS
- [x] `web/nats-manager/` - vanilla JS/TS component
- [x] Core Features:
  - [x] Display server stats (`/varz`)
  - [x] Display connections (`/connz`)
  - [x] Display subscriptions (`/subsz`)
  - [x] Real-time events via WebSocket (`$SYS.>`)
  - [x] TLS/WSS connection to NATS
- [ ] Dashboard Features:
  - [ ] Display routes/gateways (cluster view via `/routez`)
  - [ ] Display JetStream streams/consumers (`/jsz`)
  - [ ] Per-account connection view
  - [ ] Parsed CONNECT/DISCONNECT events (not raw JSON)
- [x] Rudimentary display: functional first
- [x] Cloudflare-ready: works via tunnel

#### 1.3 Generic TS/JS Client 🟡 IN PROGRESS
- [x] `clients/ts/nunect-client/` - package structure
- [ ] Core Client (`NunectClient` class):
  - [ ] WebSocket connection to NATS
  - [ ] Authentication (username/password)
  - [ ] Publish with headers
  - [ ] Subscribe with wildcards
  - [ ] Unsubscribe
  - [ ] Request-reply pattern
  - [ ] Connection lifecycle (connect, disconnect, reconnect)
- [ ] Logger Module:
  - [ ] `logger.info()`, `logger.warn()`, `logger.error()`
  - [ ] Publishes to `ops.log.{level}.{unitID}`
- [ ] TypeScript declarations
- [ ] Basic tests

### Phase 2: Testing 🟡 IN PROGRESS

- [x] Connection tests: WSS working via Cloudflare
- [x] Management API tests: HTTPS endpoints reachable
- [ ] Generic client tests: pub/sub, headers, request-reply
- [ ] Integration: UI shows live connection data
- [ ] Playwright/Chromium automated tests

### Phase 3: Provisioning & Health (Future)

- [ ] Guardian (Go): heartbeat publisher with health headers
- [ ] Controller (Go): dashboard backend, provisioning orchestration
- [ ] ~~ProMan (Go): provisioning execution~~ (DEFERRED)
- [ ] Log module: `$SYS` event aggregation

### Phase 4: Protocol Integration (Future)

- [ ] TETRA ingestor
- [ ] DMR bridge
- [ ] Audio transcoding pipeline

---

## XIII. Quick Start (Development)

```bash
# 1. Start NATS server
./scripts/nats-server.sh

# 2. Open management UI
open http://localhost:8080/nats-manager/

# 3. Run generic client test
npm run test --workspace=clients/ts/nunect-client

# 4. Verify connection in UI
#    → Should show new connection in /connz
```

---

**Next commit starts with Phase 1.1: NATS server config and startup script.**
