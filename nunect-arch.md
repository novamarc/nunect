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
| nats-manager-ui | web/nats-manager/ | Vanilla JS/TS management UI | Phase 1.2 | Cloudflare Worker |

**Deployment Strategy:**
- **Development**: Direct access via port 4280 on dev server
- **Production**: Cloudflare Worker (edge) - no nginx/proxy layer
- Rationale: Serverless edge deployment aligns with NATS distributed architecture
| generic-client-ts | clients/ts/nunect-client/ | Reusable TS/JS NATS client | Phase 1.3 |
| guardian-go | cmd/guardian/ | Application heartbeat publisher | Phase 3 |
| controller-go | cmd/controller/ | Dashboard backend, provisioning orchestration | Phase 3 |
| proman-go | cmd/proman/ | Provisioning execution | Phase 3 |

## Configuration Files

| File | Purpose |
|------|---------|
| .env | Environment variables (servers, ports, credentials) |
| config/nats-server.conf | NATS server configuration |
| config/accounts.conf | Account and user definitions |

## Functional API (Grows Over Time)

**Base provides via NATS:**
- Pub/sub with wildcards
- Request-reply
- JetStream persistence
- $SYS events

**Plugins add:**
- Application health (Guardian)
- Dashboard aggregation (Controller)
- Logging (Generic Client)
when it all works
- Provisioning workflow (Controller + ProMan)
## Isolation Rules

- NATS config in `config/` only
- UI code in `web/` only
- Go services in `cmd/` only
- Shared libraries in `internal/` only
- Client SDKsin `clients/` only

## Base Change Approval Required

Modify this file ONLY if:
- Changing NATS server topology (clustering, gateways)
- Adding new authentication mechanisms
- Modifying subject hierarchy (breaking change)
- Changing plugin isolation boundaries


## Future work

- Provisioning workflow (Controller + ProMan)
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
