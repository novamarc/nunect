# nunect QoS Protocol Specification (Draft)

**Version:** 0.1  
**Status:** Draft  
**Scope:** Quality of Service mechanisms, adaptive algorithms, Mission Critical mode, network health

---

## 1. QoS Architecture Overview

### 1.1 Design Principles

1. **Guardian advises, clients vote:** Distributed decision making
2. **Local optimization first:** Per-node adaptation without global coordination
3. **Graceful degradation:** Quality reduces smoothly as conditions worsen
4. **Transparency:** Clients understand *why* decisions are made

### 1.2 QoS Components

```
┌─────────────────────────────────────────────────────────────┐
│                      QoS LAYERS                              │
├─────────────────────────────────────────────────────────────┤
│  GLOBAL QoS                                                  │
│  ├─ Network health aggregation (all nodes)                   │
│  ├─ Clock skew detection                                     │
│  └─ Mode recommendations (Realtime/Corrected/Mission Crit)   │
├─────────────────────────────────────────────────────────────┤
│  LOCAL QoS (Guardian)                                        │
│  ├─ Link quality monitoring (RSSI, loss, RTT)                │
│  ├─ Time sync status (PTP/NTP quality)                       │
│  ├─ Per-client recommendations                               │
│  └─ Mesh handover advisory                                   │
├─────────────────────────────────────────────────────────────┤
│  CLIENT QoS                                                  │
│  ├─ Frame size adaptation                                    │
│  ├─ Buffer management                                        │
│  ├─ Playback mode selection                                  │
│  └─ Late packet handling                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. QoS Subjects

### 2.1 Subject Hierarchy

```
ops.metric.{type}.{unitID}           # Raw metrics
ops.qos.local.{type}.{unitID}        # Local QoS events
ops.qos.global.{type}                # Global QoS aggregation
qos.local.advisory                   # Guardian recommendations
qos.global.status                    # Network-wide status
qos.global.advisory                  # Global recommendations
qos.mesh.handover.advisory           # Mesh roaming hints
qos.client.status                    # Client decisions
```

### 2.2 Metric Types

| Type | Subject | Publisher |
|------|---------|-----------|
| RTT | `ops.metric.rtt.{unitID}` | Guardian |
| Time | `ops.metric.time.{unitID}` | Guardian |
| Voice | `ops.metric.voice.{unitID}` | Voice clients |
| Network | `ops.metric.net.{unitID}` | Guardian |
| Mesh | `ops.metric.mesh.{unitID}` | Mesh nodes |

---

## 3. Local QoS (Guardian)

### 3.1 Link Quality Monitoring

Guardian continuously monitors:

| Metric | Source | Update Frequency |
|--------|--------|------------------|
| RTT (native) | `nc.RTT()` | Every 30s |
| RTT (app) | Echo pattern | Every 30s |
| RSSI | WiFi driver | Every 5s |
| Packet loss | NATS stats | Continuous |
| Battery | System | Every 60s |
| Temperature | System | Every 60s |

### 3.2 Link Quality Score

Calculated as weighted composite:

```go
type LinkQuality struct {
    RSSI          int     `json:"rssi_dbm"`          // -30 to -90
    PacketLoss    float64 `json:"packet_loss_percent"` // 0-100
    RTTMs         float64 `json:"rtt_ms"`
    JitterMs      float64 `json:"jitter_ms"`
}

func (lq LinkQuality) Score() float64 {
    // Normalize each metric to 0-1 (1 = best)
    rssiScore := normalizeRSSI(lq.RSSI)           // -50dBm = 1.0, -80dBm = 0.0
    lossScore := 1.0 - (lq.PacketLoss / 100.0)    // 0% loss = 1.0
    rttScore := 1.0 - math.Min(lq.RTTMs/200.0, 1.0) // <50ms = 1.0, >200ms = 0.0
    
    // Weighted average
    return (rssiScore*0.4 + lossScore*0.4 + rttScore*0.2)
}
```

### 3.3 Local Advisory Publication

**Subject:** `qos.local.advisory`

**Headers:**
```
X-Unit-ID:          guardian-alpha-01
X-TX-Timestamp:     1707772800000000123
X-Link-Quality:     0.75
```

**Payload:**
```json
{
  "node_id": "guardian-alpha-01",
  "timestamp": 1707772800000,
  "link_quality": {
    "score": 0.75,
    "rssi_dbm": -72,
    "packet_loss_percent": 0.5,
    "rtt_ms": 45,
    "jitter_ms": 5
  },
  "clock_status": {
    "source": "ptp",
    "quality": "locked",
    "offset_ms": 0.001
  },
  "recommendations": {
    "voice": {
      "frame_size_ms": 20,
      "bitrate_kbps": 8,
      "buffer_ms": 100,
      "redundancy": false,
      "fec": false
    },
    "network": {
      "batch_size": 1,
      "retry_policy": "aggressive"
    }
  },
  "alternatives": [
    {
      "condition": "if_rssi_improves_to_-65",
      "frame_size_ms": 60,
      "reason": "superframe_optimization"
    }
  ],
  "valid_until": 1707773100000
}
```

---

## 4. Global QoS Aggregation

### 4.1 Global Status Publication

**Subject:** `qos.global.status`

Published by designated leader or consensus:

```json
{
  "timestamp": 1707772800000,
  "publisher": "guardian-core-01",
  "network_health": {
    "total_nodes": 12,
    "online_nodes": 11,
    "gps_synced": 8,
    "ntp_only": 2,
    "unsynced": 1,
    "offline": 1
  },
  "clock_analysis": {
    "max_clock_skew_ms": 5.2,
    "mean_offset_ms": 0.8,
    "reference_source": "gps-core-01"
  },
  "link_quality_distribution": {
    "excellent": 5,
    "good": 4,
    "fair": 2,
    "poor": 1
  },
  "partitions": [],
  "topology": "connected"
}
```

### 4.2 Global Mode Recommendation

**Subject:** `qos.global.advisory`

```json
{
  "timestamp": 1707772800000,
  "recommended_mode": "corrected",
  "mode_reason": "mixed_clock_sources",
  "constraints": {
    "max_clock_skew_ms": 5.2,
    "percent_gps_synced": 67,
    "percent_unsynced": 8
  },
  "playback_buffer_ms": 50,
  "late_entry_threshold_ms": 150,
  "valid_until": 1707773400000
}
```

### 4.3 Mode Selection Logic

| Mode | Trigger Conditions | Buffer |
|------|-------------------|--------|
| **Realtime** | >90% GPS-locked, skew <1ms | 1ms |
| **Corrected** | Mixed sources, skew <50ms | 20-50ms |
| **Mission Critical** | >20% unsynced OR skew >50ms | 200-500ms |

```go
func determineMode(globalStatus GlobalStatus) PlaybackMode {
    gpsPercent := float64(globalStatus.GPSSynced) / float64(globalStatus.TotalNodes)
    unsyncedPercent := float64(globalStatus.Unsynced) / float64(globalStatus.TotalNodes)
    
    switch {
    case gpsPercent > 0.9 && globalStatus.MaxClockSkewMs < 1.0:
        return Realtime
    case unsyncedPercent > 0.2 || globalStatus.MaxClockSkewMs > 50.0:
        return MissionCritical
    default:
        return Corrected
    }
}
```

---

## 5. Mission Critical Mode

### 5.1 Purpose

Emergency and indoor operations where:
- Some participants lack GPS or reliable NTP
- Clock skew exceeds acceptable limits
- Network partitions possible
- Late packets must still be heard

### 5.2 Playback Modes

| Mode | Buffer | Use Case |
|------|--------|----------|
| Realtime | 1ms | All GPS locked |
| Corrected | 20ms | Mixed, low skew |
| Mission Critical | 200-500ms | Unsynced/partitioned |

### 5.3 Windowed Playback Algorithm

```
Timeline:  [0ms]    [50ms]   [100ms]  [150ms]  [200ms]
           │        │        │        │        │
Buffer:    [=======BUFFER WINDOW=======]        
           │        │        │        │        │
Packets:   [A:0ms]──[B:25ms]─[C:50ms]─[D:75ms]─[E:100ms]
              ↓        ↓        ↓        ↓        ↓
Play:      [0.2s]   [0.225s] [0.25s]  [0.275s] [0.3s]
```

### 5.4 Late Packet Handling

**Scenario:** Packet F arrives at 250ms (was sent at 80ms, delayed 170ms)

```
Buffer state at 200ms playback time:
[0ms][25ms][50ms][75ms][100ms] [GAP at 80ms]
  A    B    C    D    E

Packet F arrives (original position: 80ms):
→ Insert at correct position between D(75ms) and E(100ms)
→ Mark with late arrival indicator
→ Adjust playback timing

Result: [0ms][25ms][50ms][75ms][80ms*][100ms]
         A    B    C    D    [F]     E
                              *
                              └─ "[INSERTED - arrived 170ms late]"
```

### 5.5 Late Entry Voice Protocol

**Subject:** `com.{tenant}.{tech}.{sourceID}.{group}.voice`

**Headers for late packet:**
```
X-Sequence:         42
X-TX-Timestamp:     1707772800080000000  # Original: 80ms
X-Arrival-Timestamp: 1707772800250000000  # Actual: 250ms
X-Late-Entry:       true
X-Latency-Ms:       170
```

**UI Indicator:**
```
[14:32:15.200] Alpha: "Contact at sector 4!"
[14:32:15.280] Bravo: "Copy that!" [INSERTED - arrived 170ms late]
[14:32:15.300] Alpha: "Moving in now"
```

### 5.6 Implementation Algorithm

```go
type PlaybackBuffer struct {
    windowMs        int           // 200-500ms
    packets         []VoicePacket // Sorted by TX timestamp
    playbackHead    time.Time     // Current playback position
    mode            PlaybackMode
}

func (pb *PlaybackBuffer) AddPacket(packet VoicePacket) {
    // Calculate position in buffer
    position := packet.TXTimestamp
    
    // Check if within window
    if position.Before(pb.playbackHead) {
        // Too late - discard or emergency insert
        if pb.mode == MissionCritical && packet.Priority == Emergency {
            pb.emergencyInsert(packet)
        }
        return
    }
    
    // Insert in sorted order
    insertIdx := pb.findInsertPosition(position)
    pb.packets = append(pb.packets[:insertIdx], 
                        append([]VoicePacket{packet}, pb.packets[insertIdx:]...)...)
    
    // Mark if arrived after playback started
    if packet.ArrivalTimestamp.After(pb.playbackHead) {
        packet.LateEntry = true
        packet.LatencyMs = packet.ArrivalTimestamp.Sub(packet.TXTimestamp).Milliseconds()
    }
}

func (pb *PlaybackBuffer) Play() {
    for _, packet := range pb.packets {
        if packet.TXTimestamp.Before(pb.playbackHead) {
            // Play packet
            if packet.LateEntry {
                displayLateIndicator(packet.LatencyMs)
            }
            playAudio(packet.Payload)
        }
    }
    pb.packets = pb.packets[:0] // Clear played packets
    pb.playbackHead = pb.playbackHead.Add(time.Duration(pb.windowMs) * time.Millisecond)
}
```

---

## 6. Adaptive Algorithms

### 6.1 Frame Size Adaptation

Guardian recommends, client decides:

```json
// qos.local.advisory
{
  "recommendations": {
    "voice": {
      "frame_size_ms": 20,
      "reason": "high_packet_loss_detected"
    }
  }
}
```

Client can override with local knowledge:

```javascript
// Client-side adaptation
function chooseFrameSize(advisory) {
    const baseSize = advisory.recommended.frame_size_ms;
    
    // Local overrides
    if (batteryLevel < 20) {
        // Larger frames = less CPU/radio wake time
        return Math.min(60, baseSize * 2);
    }
    
    if (userPreference === 'low_latency') {
        // Force minimum for responsiveness
        return 20;
    }
    
    return baseSize;
}
```

### 6.2 Buffer Adaptation

Dynamic buffer sizing based on jitter:

```go
func calculateBuffer(jitterHistory []float64) int {
    // Use 95th percentile jitter + safety margin
    sort.Float64s(jitterHistory)
    p95 := jitterHistory[int(float64(len(jitterHistory))*0.95)]
    
    baseBuffer := int(p95) + 20  // 20ms safety
    
    // Clamp to reasonable range
    if baseBuffer < 20 {
        return 20
    }
    if baseBuffer > 500 {
        return 500
    }
    return baseBuffer
}
```

---

## 7. Mesh Roaming & Handover

### 7.1 Neighbor Discovery

**Subject:** `ops.mesh.neighbor.{unitID}`

```json
{
  "node_id": "nunode-alpha-01",
  "neighbors": [
    {
      "id": "nunode-beta-01",
      "rssi_dbm": -65,
      "last_seen": 1707772800000,
      "hops": 1
    },
    {
      "id": "nunode-gamma-01", 
      "rssi_dbm": -78,
      "last_seen": 1707772795000,
      "hops": 2
    }
  ]
}
```

### 7.2 Handover Advisory

**Subject:** `qos.mesh.handover.advisory`

```json
{
  "node_id": "nunode-alpha-01",
  "current_parent": "nunode-core-01",
  "recommended_parent": "nunode-beta-01",
  "reason": "better_signal_trend",
  "metrics": {
    "current_rssi": -82,
    "candidate_rssi": -68,
    "trend": "improving",
    "prediction_30s": -65
  },
  "urgency": "planned",  // planned, recommended, immediate
  "valid_until": 1707773100000
}
```

### 7.3 Handover Decision Flow

```
Client (nuNode)              Guardian
     │                            │
     │◄── qos.mesh.handover.advisory
     │    "recommend: switch to beta"
     │                            │
     ├── qos.client.status ──────►│
     │    "evaluating handover"
     │                            │
     │[Pre-connect to beta]        │
     │                            │
     ├── qos.client.status ──────►│
     │    "switching to beta"
     │                            │
     │[Switch active parent]       │
     │                            │
     └── qos.client.status ──────►│
          "handover complete"
```

---

## 8. Client Status Reporting

### 8.1 Client Decision Publication

**Subject:** `qos.client.status`

```json
{
  "unit_id": "web-client-42",
  "timestamp": 1707772800000,
  "decisions": {
    "frame_size_ms": 20,
    "frame_size_reason": "guardian_advisory",
    "playback_mode": "corrected",
    "playback_buffer_ms": 50,
    "current_parent": "guardian-alpha-01"
  },
  "metrics": {
    "actual_latency_ms": 85,
    "jitter_ms": 5.2,
    "packet_loss_percent": 0.1
  },
  "overrides": [
    {
      "parameter": "frame_size_ms",
      "guardian_recommended": 60,
      "client_chosen": 20,
      "reason": "user_preference_low_latency"
    }
  ]
}
```

---

## Appendix A: QoS Subject Reference

| Purpose | Subject | Direction |
|---------|---------|-----------|
| Raw RTT metrics | `ops.metric.rtt.{unitID}` | Guardian → All |
| Raw time metrics | `ops.metric.time.{unitID}` | Guardian → All |
| Voice quality | `ops.metric.voice.{unitID}` | Client → All |
| Local advisory | `qos.local.advisory` | Guardian → Local |
| Global status | `qos.global.status` | Leader → All |
| Global advisory | `qos.global.advisory` | Leader → All |
| Mesh handover | `qos.mesh.handover.advisory` | Guardian → Client |
| Client decisions | `qos.client.status` | Client → Guardian |

## Appendix B: QoS Header Reference

| Header | Values | Description |
|--------|--------|-------------|
| `X-Link-Quality` | 0.0-1.0 | Composite link score |
| `X-Late-Entry` | true, false | Packet arrived after playback started |
| `X-Latency-Ms` | milliseconds | Arrival delay |
| `X-Arrival-Timestamp` | nanoseconds | Actual receive time |
| `X-Packet-Loss` | 0-100 | Loss percentage |

---

**See Also:**
- `protocol-spec-draft.md` - Base protocol
- `voice-protocol-spec-draft.md` - Voice/PTT specifics
