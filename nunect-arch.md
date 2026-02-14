# nunect Architecture

## Base Orchestrator (NATS Server)

**Stable - Rarely Changes**

| Component | Technology | Responsibility |
|-----------|------------|----------------|
| NATS Server | nats-io/nats-server | Message routing, auth, $SYS events, HTTP monitoring |
| Configuration | nats-server.conf | Accounts, users, permissions, JetStream, TLS |
| Startup | scripts/nats-server.sh | Launch with proper config |

**NATS Native We Configure (NOT Build):**
- Authentication: username/password, NKeys, JWT
- Authorization: per-user pub/sub permissions
- Account isolation: multi-tenancy
- Monitoring: HTTP port 8222, $SYS subjects
- Transport: TLS/mTLS

**Important Distinction - HTTP API vs Configuration:**

| Capability | HTTP Monitoring API | Configuration Management |
|------------|---------------------|--------------------------|
| Read server stats | ✅ `/varz`, `/connz`, `/subsz` | N/A |
| Read live events | ❌ (poll only) | ✅ Subscribe `$SYS.>` via WebSocket |
| Modify users | ❌ **Not possible** | Edit `config/nats-server.conf` |
| Modify accounts | ❌ **Not possible** | Edit config + `nats-server -signal reload` |
| Change permissions | ❌ **Not possible** | Edit config + reload signal |

**Configuration changes require file edit + signal reload - NOT via HTTP API**

## Plugin Modules (Iterative)

**Disposable/Experimental - Iterate Freely**

| Plugin | Location | Purpose | Status | Production Path |
|--------|----------|---------|--------|-----------------|
| nats-manager-ui | web/nats-manager/ | Vanilla JS management UI with RTT/Time metrics | ✅ Phase 1.2 Complete | Cloudflare Worker |
| generic-client-ts | clients/ts/nunect-client/ | Reusable TS/JS NATS client | ✅ Phase 1.3 Complete | npm package |
| guardian-go | cmd/guardian/ | Application heartbeat + RTT + Time sync publisher | ✅ Phase 3 Complete | Systemd service |
| timesync-go | internal/timesync/ | PTP/Chrony time synchronization monitor | ✅ Complete | Shared library |

**Deployment Strategy:**
- **Development**: Direct access via port 4280 on dev server
- **Production**: Cloudflare Worker (edge) - no nginx/proxy layer
- **Leaf Nodes**: OpenWRT on BPi-R4 with NATS Leaf + PTP/Chrony

## New Components

### Time Synchronization Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TIME INFRASTRUCTURE                       │
├─────────────────────────────────────────────────────────────┤
│  Master Node (Stratum 1)                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  GPS RTK    │──►│  ptp4l      │──►│  chronyd (backup) │  │
│  │  (Primary)  │  │  (Hardware) │  │  (NTP fallback)   │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    LEAF NODE (Guardian)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  ptp4l -s   │──►│  chronyd    │◄── config: PTP_MASTER │  │
│  │  (Slave)    │  │  (Fallback) │    Fallback: NTP_POOL │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│           │                                                 │
│           ▼                                                 │
│  ┌──────────────────────────────────────┐                  │
│  │  Guardian: Publishes ops.metric.time │                  │
│  │  - Active source (PTP/NTP/unsynced)  │                  │
│  │  - Clock quality (locked/tracking)   │                  │
│  │  - Offset values                     │                  │
│  └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

**Time Sync Flow:**
1. **PTP Master** (GPS RTK) distributes time via hardware timestamping
2. **Leaf Nodes** run `ptp4l -s` to sync local PHC (PTP Hardware Clock)
3. **Guardian** reads `/run/ptp/status` or queries via `pmc`
4. **Fallback**: Chrony NTP if PTP unavailable
5. **Publishing**: `ops.metric.time.{unitID}` with sync status

**Configuration (.env):**
```
TIME_SYNC_MODE=auto           # ptp, chrony, or auto
PTP_MASTER_ADDRESS=10.0.0.1   # PTP Grandmaster
PTP_DOMAIN=0
NTP_SERVERS=pool.ntp.org,time.google.com
```

### RTT (Round-Trip Time) Measurement

**Two-layer measurement:**

| Layer | Method | Precision | Purpose |
|-------|--------|-----------|---------|
| **Native** | `nc.RTT()` (nats.go) | µs | Transport latency |
| **App** | Echo request-reply | µs | Full pipeline latency |

**Echo Pattern:**
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

**Published Metrics:**
- `ops.metric.rtt.{unitID}` - JSON with native_rtt_us, app_rtt_us
- `ops.heartbeat.{unitID}` - Headers with X-Native-RTT, X-App-RTT

### Client Identification

**Problem:** Multiple UI clients behind Cloudflare Tunnel appear as 127.0.0.1 with same name.

**Solution:** Auto-generated unit ID from browser fingerprint:
```javascript
// Format: nats-ui-{type}-{os}-{random}
// Examples:
//   nats-ui-mobile-mac-a7b3   (iPhone)
//   nats-ui-laptop-win-def4   (Windows laptop)
//   nats-ui-tablet-ios-xyz9   (iPad)
```

**Detection:**
- Type: mobile (Mobi/Android/iPhone) vs laptop (desktop)
- OS: win, mac, linux, ios, android
- Random: 4-char base36 for uniqueness

**Override:** URL parameter `?client=custom-name` for explicit identity

## Configuration Files

| File | Purpose |
|------|---------|
| .env | Environment variables (servers, ports, credentials, time sync) |
| config/nats-server.conf | NATS server configuration |
| config/nats-server-runtime.conf | Generated config with envsubst |
| connector-profile.yaml | Guardian client profile (capabilities) |

## Functional API (Grows Over Time)

**Base provides via NATS:**
- Pub/sub with wildcards
- Request-reply
- JetStream persistence
- $SYS events
- Leaf Node connections (for distributed setups)

**Plugins add:**
- Application health (Guardian heartbeats)
- RTT metrics (echo pattern)
- Time sync status (PTP/Chrony monitoring)
- Dashboard aggregation (UI)
- Logging (Generic Client)

## Isolation Rules

- NATS config in `config/` only
- UI code in `web/` only
- Go services in `cmd/` only
- Shared libraries in `internal/` only
- Client SDKs in `clients/` only
- Time sync library in `internal/timesync/` only

## Base Change Approval Required

Modify this file ONLY if:
- Changing NATS server topology (clustering, gateways, leaf nodes)
- Adding new authentication mechanisms
- Modifying subject hierarchy (breaking change)
- Changing plugin isolation boundaries
- Adding new time sync protocols

## HTTPS / TLS Setup

For HTTPS access to NATS HTTP API and WSS WebSocket:

### Option A: Reverse Proxy (Recommended)

Use nginx, traefik, or caddy to terminate TLS and proxy to NATS:

```nginx
server {
    listen 443 ssl;
    server_name dev.nunet.one;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Proxy to NATS HTTP monitoring
    location /nats/ {
        proxy_pass http://localhost:8223/;
        proxy_http_version 1.1;
    }
    
    # Proxy to UI
    location / {
        proxy_pass http://localhost:4280/;
    }
}
```

Update `.env`:
```
NATS_HTTP_URL=https://dev.nunet.one/nats
NATS_WS_URL=wss://dev.nunet.one/nats-ws
```

### Option B: NATS Native TLS

Configure NATS with certificates in `nats-server.conf`:
```
tls {
    cert_file: /path/to/cert.pem
    key_file: /path/to/key.pem
}
```

### Option C: Cloudflare Tunnel (dev)

For development with Cloudflare:
```bash
cloudflared tunnel --url http://localhost:8223
```

Then update `.env` with the https URL provided.

## Future Work

- Leaf Node deployment on OpenWRT/BPi-R4
- PTP hardware timestamping validation
- Multi-region clustering with gateways
- Provisioning workflow (Controller + ProMan)
- Audio codec integration (Opus for PTT)
