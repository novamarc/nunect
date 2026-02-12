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

## Plugin Modules (Iterative)

**Disposable/Experimental - Iterate Freely**

| Plugin | Location | Purpose | Status |
|--------|----------|---------|--------|
| nats-manager-ui | web/nats-manager/ | Vanilla JS/TS management UI | Phase 1.2 |
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