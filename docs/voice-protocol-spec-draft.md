# nunect Voice Protocol Specification (Draft)

**Version:** 0.1  
**Status:** Draft  
**Scope:** Voice communication, PTT control, audio streaming, codec handling

---

## 1. Voice Protocol Overview

### 1.1 Design Goals

- Low latency (<150ms acceptable, <70ms excellent)
- Multi-codec support (OPUS, ACELP, AMBE, proprietary)
- PTT floor control with fair arbitration
- Adaptive to network conditions
- Mixed infrastructure support (PTP-synchronized and unsynced)

### 1.2 Protocol Stack

```
┌─────────────────────────────────────────┐
│           PTT APPLICATION               │
│   (Push-to-talk, group management)      │
├─────────────────────────────────────────┤
│           VOICE PROTOCOL                │
│   (This spec: frames, control, QoS)     │
├─────────────────────────────────────────┤
│           BASE PROTOCOL                 │
│   (protocol-spec.md: headers, timing)   │
├─────────────────────────────────────────┤
│           NATS TRANSPORT                │
└─────────────────────────────────────────┘
```

---

## 2. Voice Subjects

### 2.1 Subject Patterns

```
com.{tenant}.{tech}.{sourceID}.{group}.{type}
```

| Type | Description |
|------|-------------|
| `voice` | Audio payload (frames/superframes) |
| `ptt` | PTT control (request/grant/release) |
| `presence` | Availability status |

### 2.2 Examples

```
com.bridge.vhf.sdr01.ch16.voice       # VHF audio on channel 16
com.bridge.opus.web42.all.voice       # OPUS from web client
com.bridge.tetra.gw01.tac1.ptt        # TETRA PTT control
com.bridge.opus.mobile99.all.presence # Mobile client presence
```

### 2.3 Wildcard Subscriptions

```javascript
// All voice on channel 16
nc.Subscribe("com.bridge.*.*.ch16.voice", handler)

// All PTT control for a tenant
nc.Subscribe("com.bridge.*.*.*.ptt", handler)

// Specific client all groups
nc.Subscribe("com.bridge.opus.web42.>.voice", handler)
```

---

## 3. Voice Message Structure

### 3.1 Audio Frame Message

**Subject:** `com.{tenant}.{tech}.{sourceID}.{group}.voice`

**Headers:**
```
# Identity
X-Unit-ID:          web-client-42
X-Origin-ID:        12345
X-Sender-Alias:     Firefighter-Alpha

# Timing (critical for ordering)
X-TX-Timestamp:     1707772800000000123  # Nanoseconds
X-Clock-Source:     ptp
X-Clock-Quality:    locked

# Voice specific
X-Sequence:         42                   # Frame sequence
X-Codec:            OPUS-8K
X-Frame-Size:       20                   # ms (20/40/60)
X-Superframe:       false  packet count              # True if bundled
X-Packet-Loss:      0                    # % loss detected

# Encryption
X-Encryption:       AES256
```

**Payload:** Raw codec frame(s) or superframe structure

### 3.2 Superframe Structure (Strong Links)

For high-quality links, bundle multiple frames:

```
┌────────────────────────────────────────────┐
│  Superframe Header (16 bytes)              │
│  - Magic: 0x53555052 ("SUPR")              │
│  - Frame count: 3                          │
│  - Total size: 480 bytes                   │
│  - First timestamp: 1707772800000000123    │
├────────────────────────────────────────────┤
│  Frame 1: OPUS encoded (160 bytes)         │
│  Frame 2: OPUS encoded (158 bytes)         │
│  Frame 3: OPUS encoded (162 bytes)         │
└────────────────────────────────────────────┘
```

**Header when using superframes:**
```
X-Frame-Size:       60       # Total (3 × 20ms)
X-Superframe:       true
X-Frame-Count:      3
```

---

## 4. PTT Control Protocol

### 4.1 PTT States

```
┌─────────┐    PTT_REQUEST    ┌─────────┐
│  IDLE   │ ─────────────────►│ PENDING │
└─────────┘                   └────┬────┘
      ▲                            │ PTT_GRANT
      │                            ▼
      │ PTT_RELEASE           ┌─────────┐
      └───────────────────────│  ACTIVE │
                              └─────────┘
```

### 4.2 PTT Request

**Subject:** `com.{tenant}.{tech}.{sourceID}.{group}.ptt`  
**Action:** `REQUEST`

**Headers:**
```
X-Unit-ID:          radio-01
X-TX-Timestamp:     1707772800000000123
X-Action:           REQUEST
X-Priority:         normal|emergency
X-Duration-Est:     30                   # Estimated seconds
```

**Payload:**
```json
{
  "action": "REQUEST",
  "timestamp": 1707772800000000123,
  "priority": "normal",
  "estimated_duration": 30
}
```

### 4.3 PTT Grant

**Subject:** `com.{tenant}.{tech}.{sourceID}.{group}.ptt`  
**Action:** `GRANT` (sent by controller/arbitrator)

**Headers:**
```
X-Unit-ID:          ptt-controller
X-Action:           GRANT
X-Granted-To:       radio-01
X-Queue-Position:   0                    # 0 = granted, >0 = queued
X-Max-Duration:     60                   # Seconds allowed
```

### 4.4 PTT Release

**Subject:** `com.{tenant}.{tech}.{sourceID}.{group}.ptt`  
**Action:** `RELEASE`

**Headers:**
```
X-Unit-ID:          radio-01
X-Action:           RELEASE
X-Actual-Duration:  23
X-Reason:           complete|timeout|override
```

### 4.5 PTT Deny

**Headers:**
```
X-Action:           DENY
X-Reason:           channel_busy|priority_override|not_authorized
X-Queue-Position:   2                    # Position in queue
X-Est-Wait:         15                   # Estimated wait seconds
```

---

## 5. PTT Floor Control Arbitration

### 5.1 Arbitration Criteria

PTT grants are determined by (in order):

1. **Priority:** Emergency > Normal
2. **Timestamp:** Earlier request wins (fairness)
3. **Clock Sync Quality:** GPS-locked > NTP > Unsynced (skew correction)

### 5.2 Clock Skew Correction

When comparing timestamps from mixed clock sources:

```go
// PTT Server / Arbitration Logic
func comparePTTRequests(reqA, reqB PTTRequest) {
    // Get offsets from global status
    offsetA := getClockOffset(reqA.UnitID)  // From ops.metric.time
    offsetB := getClockOffset(reqB.UnitID)
    
    // Adjust timestamps to common reference
    adjustedA := reqA.Timestamp - offsetA
    adjustedB := reqB.Timestamp - offsetB
    
    // Compare adjusted times
    if adjustedA < adjustedB {
        grantTo(reqA)
    } else {
        grantTo(reqB)
    }
}
```

### 5.3 Latency Budget for Arbitration

| Component | Budget |
|-----------|--------|
| Network RTT | <150ms |
| Clock sync precision | <10ms (NTP) / <1ms (PTP) |
| Arbitration compute | <5ms |
| **Total** | **<165ms worst case** |

Human perception threshold: ~200ms for PTT response feels "instant"

---

## 6. Adaptive Frame Sizing

### 6.1 Frame Size Options

| Size | Use Case | Latency Impact |
|------|----------|----------------|
| 20ms | Weak links, NTP-only, mobile | Low (1 frame = 20ms) |
| 40ms | Medium links, mixed conditions | Medium |
| 60ms | Strong links, GPS-locked | Higher but efficient |

### 6.2 Decision Matrix

| Clock Source | Link Quality | Frame Size | Redundancy |
|--------------|--------------|------------|------------|
| GPS + strong | -70dBm+ | 60ms / superframe | None |
| GPS + weak | <-70dBm | 20ms | Optional |
| NTP + strong | -70dBm+ | 40ms | None |
| NTP + weak | <-70dBm | 20ms | Recommended |
| Unsynced | any | 20ms | Required |

### 6.3 Guardian Advisory

Guardian publishes recommended settings:

**Subject:** `qos.local.advisory` (per node)  
**Subject:** `qos.global.advisory` (global aggregation)

**Payload:**
```json
{
  "node_id": "guardian-alpha-01",
  "timestamp": 1707772800000,
  "link_quality": {
    "rssi_dbm": -72,
    "packet_loss_percent": 0.5,
    "rtt_ms": 45
  },
  "clock_status": {
    "source": "ptp",
    "quality": "locked",
    "offset_ms": 0.001
  },
  "recommended": {
    "frame_size_ms": 20,
    "bitrate_kbps": 8,
    "buffer_ms": 100,
    "redundancy": false
  },
  "alternative": {
    "frame_size_ms": 60,
    "conditions": "if_rssi_above_-65"
  }
}
```

### 6.4 Client Adaptation

Clients vote their strategy based on advisory:

```javascript
// Client receives qos.local.advisory
const advisory = JSON.parse(message.data);

// Client decides (can override with local knowledge)
if (localBattery < 20) {
  // Force 60ms to save power despite weak signal
  useFrameSize(60);
} else {
  useFrameSize(advisory.recommended.frame_size_ms);
}

// Publish client's decision
nc.publish('qos.client.status', {
  unit_id: myUnitID,
  chosen_frame_size: currentFrameSize,
  reason: 'guardian_advisory'
});
```

---

## 7. Codec Specifications

### 7.1 Supported Codecs

| Codec | Bitrate | Frame Sizes | Use Case |
|-------|---------|-------------|----------|
| **OPUS** | 6-24 kbps | 2.5, 5, 10, 20, 40, 60ms | Primary (web/mobile) |
| **ACELP** | 4.8 kbps | 20ms | TETRA compatible |
| **AMBE** | 2.4-4.0 kbps | 20ms | DMR/Proprietary |
| **PCM** | 64 kbps | 20ms | High quality bridge |

### 7.2 Codec Header Values

```
X-Codec: OPUS-8K        # OPUS at 8kbps
X-Codec: OPUS-16K       # OPUS at 16kbps  
X-Codec: ACELP-4.8K     # TETRA ACELP
X-Codec: AMBE-4.0K      # DMR AMBE
X-Codec: PCM-64K        # Raw PCM
X-Codec: PCM-16K        # Compressed PCM
```

### 7.3 Codec Negotiation

During provisioning or via capability exchange:

```json
{
  "capabilities": {
    "codecs": ["OPUS-8K", "OPUS-16K", "ACELP-4.8K"],
    "preferred": "OPUS-8K",
    "min_bitrate": 6000,
    "max_bitrate": 24000
  }
}
```

---

## 8. Latency Targets & Quality Levels

### 8.1 Latency Thresholds

| Latency | Quality | User Perception |
|---------|---------|-----------------|
| <70ms | Excellent | Instant, like direct radio |
| 70-150ms | Good | Normal conversation |
| 150-300ms | Acceptable | Slight delay noticeable |
| >300ms | Poor | Uncomfortable, turn-taking issues |

### 8.2 Quality Metrics

Published by voice clients:

**Subject:** `ops.metric.voice.{unitID}`

```json
{
  "ts": 1707772800000,
  "unit_id": "web-client-42",
  "jitter_ms": 5.2,
  "packet_loss_percent": 0.1,
  "latency_ms": 85,
  "concealment_ratio": 0.02,
  "mos_score": 4.2
}
```

---

## 9. Mixed Infrastructure Operation

### 9.1 GPS Everywhere (Simple Mode)

All participants GPS-locked:
```
Direct timestamp comparison
No offset correction needed
20ms frames acceptable everywhere
```

### 9.2 Mixed Clocks (Corrected Mode)

Some GPS, some NTP, some unsynced:
```
Guardian publishes global clock offsets
Clients apply skew correction
20ms frames for unsynced participants
Late packet insertion for fairness
```

### 9.3 All Unsynced (Mission Critical Mode)

Indoor/emergency, no GPS:
```
Windowed playback (200-500ms buffer)
Late packet insertion with markers
Voice frames prioritized over strict ordering
See: qos-protocol-spec-draft.md Mission Critical Mode
```

---

## 10. Presence Protocol

### 10.1 Presence Update

**Subject:** `com.{tenant}.{tech}.{sourceID}.{group}.presence`

**Headers:**
```
X-Unit-ID:          radio-01
X-Status:           available|busy|offline
X-Capabilities:     OPUS,ACELP
```

**Payload:**
```json
{
  "status": "available",
  "groups": ["ch16", "tac1"],
  "capabilities": {
    "codecs": ["OPUS-8K", "ACELP-4.8K"],
    "max_bitrate": 16000,
    "ptt_supported": true
  },
  "last_seen": 1707772800000
}
```

---

## Appendix A: Voice Header Reference

| Header | Values | Description |
|--------|--------|-------------|
| `X-Codec` | OPUS-8K, ACELP-4.8K, AMBE-4.0K | Audio codec |
| `X-Frame-Size` | 20, 40, 60 | Milliseconds per frame |
| `X-Superframe` | true, false | Bundled frames |
| `X-Frame-Count` | 1-5 | Frames in superframe |
| `X-Packet-Loss` | 0-100 | Detected loss % |
| `X-Action` | REQUEST, GRANT, RELEASE, DENY | PTT action |
| `X-Priority` | normal, emergency | PTT priority |
| `X-Granted-To` | unit-id | Current PTT holder |
| `X-Queue-Position` | 0-N | Position in queue |

---

**See Also:**
- `protocol-spec-draft.md` - Base protocol (headers, timing, subjects)
- `qos-protocol-spec-draft.md` - QoS mechanisms, Mission Critical mode
