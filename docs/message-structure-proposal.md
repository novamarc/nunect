# Message Structure Analysis & Proposal

## Current State

### What NATS Provides Natively

| Feature | NATS Native | Notes |
|---------|-------------|-------|
| Connection ID (CID) | ✅ Yes | Unique per connection |
| IP Address | ✅ Yes | Source IP (127.0.0.1 behind proxy) |
| Connection RTT | ✅ Yes | Measured at handshake time only |
| Timestamp | ❌ No | No native message timestamp |
| Sequence | ❌ No | No native per-publisher sequence |
| $SYS Events | ✅ Yes | CONNECT, DISCONNECT, etc. |
| Headers | ✅ Yes | Custom headers supported |

### Current Custom Headers (Guardian Heartbeat)

```
X-Unit-ID:       sdr-bridge-01
X-Sequence:      42
X-Native-RTT:    187.452µs
X-App-RTT:       291.326µs
X-Timestamp:     1707772800000
X-Clock-Source:  ntp
X-Clock-Quality: locked
```

### Current JSON Payloads

**RTT Metrics:**
```json
{
  "ts": 1707772800000,
  "unit_id": "sdr-bridge-01",
  "seq": 42,
  "native_rtt_us": 187,
  "app_rtt_us": 291
}
```

**Time Status:**
```json
{
  "ts": 1707772800000,
  "unit_id": "sdr-bridge-01",
  "seq": 42,
  "ptp_enabled": true,
  "ptp_master": "00:11:22:33:44:55",
  "ptp_offset_ns": -150,
  "ntp_enabled": true,
  "ntp_offset_ms": 0.5,
  "active_source": "ntp",
  "clock_quality": "locked"
}
```

---

## Problem: One-Way Latency Without Sync

**Current:** We only measure RTT (round-trip)
- RTT = 2 × one-way + processing time
- We approximate: one-way ≈ RTT/2
- **But:** Paths may be asymmetric (5G upload ≠ download)

**With Synchronized Clocks:**
```
Client A sends:    T1 (wall clock)
Server receives:   T2 (wall clock)
One-way latency:   T2 - T1 (TRUE latency, not approximation)
```

**Clock Synchronization Quality:**
| Source | Typical Accuracy | Use Case |
|--------|------------------|----------|
| PTP (hardware) | < 1µs | Leaf nodes, audio sync |
| PTP (software) | < 100µs | Servers, good enough for PTT |
| NTP/Chrony | < 10ms | Mobile clients, acceptable |
| No sync | Unknown | RTT/2 approximation only |

---

## Proposal: Unified Header Structure

### Design Principles

1. **Headers for routing/timing** (fast path, no payload parsing)
2. **Payload for detailed metrics** (bulk data, historical analysis)
3. **NTP shared = calculate clock difference**
4. **PTP locked = calculate true one-way latency**

### Standard Header Set (All Messages)

```
# Identity
X-Unit-ID:           sdr-bridge-01           # Who sent this
X-Sequence:          42                      # Per-unit sequence
X-Session-ID:        abc123                  # Connection session

# Timing (all times in Unix nanoseconds for precision)
X-TX-Timestamp:      1707772800000000123     # When sent (sender clock)
X-Clock-Source:      ptp|ntp|unsynced        # Sender's clock source
X-Clock-Quality:     locked|tracking|...     # Sender's clock quality
X-NTP-Offset:        0.5                     # ms from NTP (if NTP)
X-PTP-Offset:        -150                    # ns from PTP (if PTP)

# Network Path
X-RTT-Native:        187452                  # µs, last measured
X-Link-Quality:      99.5                    # % packet success

# Application
X-Message-Type:      heartbeat|voice|data
X-Priority:          critical|normal|low
```

### Time Sync Information Flow

```
Step 1: Guardian reads local time sync state
        └─ PTP offset from master (if PTP)
        └─ NTP offset from server (if NTP)
        
Step 2: Publishes with headers
        X-TX-Timestamp:     1707772800000000123 (local PHC time)
        X-Clock-Source:     ptp
        X-Clock-Quality:    locked
        X-PTP-Offset:       -150 (ns, from ptp4l)
        
Step 3: Receiver calculates
        Receive time:       1707772800000500000 (receiver clock)
        One-way (approx):   (T2 - T1) = 499.877µs
        
        If both have PTP locked (<1µs error):
        True one-way:       499.877µs ± 1µs
        
        If both have NTP (<10ms error):
        True one-way:       499.877µs ± 10ms (less precise)
```

### Clock Difference Calculation (Same NTP Pool)

```
Client A: NTP offset = +2.5ms (A is 2.5ms ahead of its NTP server)
Client B: NTP offset = -1.2ms (B is 1.2ms behind its NTP server)

Clock skew between A and B: 2.5 - (-1.2) = 3.7ms

If A sends timestamp 1000.0, B receives at 1003.7 (local)
Adjusted one-way: (1003.7 - 1000.0) - 3.7 = 0.0ms
```

---

## Recommended Message Structure Changes

### 1. Guardian Heartbeat

**Current:** Mixed headers + JSON payload

**Proposed:** Headers only (leaner, faster parsing)

```
Subject: ops.heartbeat.{unitID}
Headers:
  X-Unit-ID:          sdr-bridge-01
  X-Sequence:         42
  X-TX-Timestamp:     1707772800000000123
  X-Clock-Source:     ntp
  X-Clock-Quality:    locked
  X-NTP-Offset:       0.5
  X-NTP-Server:       192.168.1.1
  X-RTT-Native:       187452
  X-RTT-App:          291326
  X-CPU-Load:         12
  X-Mem-Usage:        45
Payload: (empty or minimal JSON)
  {"status": "healthy"}
```

### 2. Time Sync Metrics

**Current:** JSON payload only

**Proposed:** Keep JSON for detailed info, add key headers

```
Subject: ops.metric.time.{unitID}
Headers:
  X-Unit-ID:          sdr-bridge-01
  X-TX-Timestamp:     1707772800000000123
  X-Clock-Source:     ptp
  X-Clock-Quality:    locked
Payload (JSON):
  {
    "ts": 1707772800000,
    "unit_id": "sdr-bridge-01",
    "seq": 42,
    "ptp": {
      "enabled": true,
      "master": "00:11:22:33:44:55",
      "offset_ns": -150,
      "path_delay_ns": 5000,
      "stratum": 1
    },
    "ntp": {
      "enabled": true,
      "servers": ["pool.ntp.org", "time.google.com"],
      "current_server": "192.168.1.1",
      "offset_ms": 0.5,
      "stratum": 2,
      "sync_log": [           // Last 3 sync events
        {"ts": 1707772795000, "offset_ms": 0.4, "source": "192.168.1.1"},
        {"ts": 1707772790000, "offset_ms": 0.6, "source": "192.168.1.1"},
        {"ts": 1707772785000, "offset_ms": 0.5, "source": "pool.ntp.org"}
      ]
    },
    "active_source": "ptp",
    "clock_quality": "locked"
  }
```

### 3. RTT Metrics

**Current:** JSON payload

**Proposed:** Headers for fast path, JSON for history

```
Subject: ops.metric.rtt.{unitID}
Headers:
  X-Unit-ID:          sdr-bridge-01
  X-TX-Timestamp:     1707772800000000123
  X-RTT-Native:       187452
  X-RTT-App:          291326
Payload (JSON):
  {
    "ts": 1707772800000,
    "unit_id": "sdr-bridge-01",
    "seq": 42,
    "native_rtt_us": 187,
    "app_rtt_us": 291,
    "measurement_method": "echo",  // echo | nc_rtt
    "path": {
      "hops": 3,
      "asymmetric": false          // flag if detected
    }
  }
```

### 4. Echo (RTT Probe) Response

**Current:** Basic echo with received timestamp

**Proposed:** Full timing chain for calculation

```
Request:
  Subject: ops.echo.{unitID}
  Headers:
    X-TX-Timestamp:     1707772800000000123 (sender's clock)
    X-Clock-Source:     ntp
    X-Clock-Quality:    locked
    X-Sequence:         42

Response:
  Headers:
    X-Server-RX-Timestamp:   1707772800000100000 (server's clock when received)
    X-Server-TX-Timestamp:   1707772800000200000 (server's clock when sent)
    X-Server-Clock-Source:   ptp
    X-Server-Clock-Quality:  locked
    
Client calculates:
  Network RTT = (T4 - T1) - (T3 - T2)
  Where:
    T1 = Original send time (client clock)
    T2 = Server receive time (server clock)
    T3 = Server send time (server clock)
    T4 = Client receive time (client clock)
```

---

## UI Updates Needed

### 1. RTT Metrics Table - Add Explanation

```
┌─ Client RTT Metrics ──────────────────────────────────────────┐
│                                                               │
│ Native RTT: Transport layer latency (TCP/WebSocket handshake) │
│ App RTT:    Full round-trip including NATS processing         │
│ Calculation: Echo request-reply with microsecond timestamps   │
│                                                               │
│ Unit ID              Native    App       Last Seen            │
│ nats-ui-laptop...    187µs     291µs     2s ago               │
│ sdr-bridge-01        235µs     332µs     0s ago               │
└───────────────────────────────────────────────────────────────┘
```

### 2. Time Sync Table - Add NTP Details

```
┌─ Time Sync Metrics ───────────────────────────────────────────┐
│                                                               │
│ NTP Servers: pool.ntp.org, time.google.com                    │
│ Current:     192.168.1.1 (stratum 2)                          │
│ Sync Log:                                                     │
│   [11:55:20] offset +0.5ms from 192.168.1.1                  │
│   [11:54:50] offset +0.4ms from 192.168.1.1                  │
│   [11:54:20] offset +0.6ms from pool.ntp.org                 │
│                                                               │
│ Unit ID    Source  Quality  Offset    Last Seen               │
│ sdr-01     ntp     locked   0.5ms     0s ago                  │
└───────────────────────────────────────────────────────────────┘
```

---

## Implementation Priority

1. **Phase 1:** Add X-TX-Timestamp to all messages (ns precision)
2. **Phase 2:** Add X-Clock-Source/Quality to all messages
3. **Phase 3:** Add X-NTP-Offset for clock difference calc
4. **Phase 4:** Add sync_log to TimeStatus JSON
5. **Phase 5:** Update UI with explanations and NTP details

---

## Summary: What's Needed vs What's Native

| Metric | NATS Native | Custom Header | Payload |
|--------|-------------|---------------|---------|
| CID | ✅ | - | - |
| Connection RTT | ✅ (stale) | X-RTT-Native | JSON history |
| Per-message RTT | ❌ | X-RTT-App | JSON details |
| Timestamp | ❌ | X-TX-Timestamp | - |
| Clock sync status | ❌ | X-Clock-* | JSON details |
| NTP server info | ❌ | X-NTP-Server | JSON sync_log |
| Sequence | ❌ | X-Sequence | JSON seq |
