# Adaptive Voice Frame QoS Strategy

## Principle: Per-Client Channel Dialing

Each client adapts its voice frame size based on:
1. **Link quality** (RTT, packet loss)
2. **Timing quality** (GPS/PTP vs NTP vs unsynced)
3. **Current mode** (Realtime vs Corrected vs Mission Critical)

## Frame Size Strategy

### Base Frame Sizes

| Frame Size | Use Case | Packets/sec | Recovery Time |
|------------|----------|-------------|---------------|
| **20ms** | Weak link, poor timing | 50 | 20ms (fast) |
| **40ms** | Medium conditions | 25 | 40ms |
| **60ms** | Strong link, GPS timing | 16.7 | 60ms (slower) |

### Adaptive Selection

```
Client conditions → Frame size
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Good link (<50ms RTT) + GPS timing     → 60ms frames
Good link + NTP timing                 → 40ms frames  
Weak link (>100ms RTT) or indoor/NTP   → 20ms frames
Mission Critical + poor conditions     → 20ms + optional redundancy
```

## Superframe Structure (Strong Clients)

**Strong clients can bundle multiple 20ms frames into superframes:**

```
Weak Client (indoor, NTP only):
  → Sends: [20ms frame] → [20ms frame] → [20ms frame] ...
  
Strong Client (GPS, good link):
  → Bundles: [20ms|20ms|20ms] = 60ms superframe
  → Header overhead amortized over 3 sub-frames
  → Can still recover individual 20ms chunks if needed
```

**Superframe Header:**
```
X-Superframe:       true
X-Subframe-Count:   3
X-Subframe-Size:    20ms
X-Frame-Sequence:   100, 101, 102  // Individual sequence numbers
```

## Latency Thresholds for PTT

```
< 70ms total latency:     IMMEDIATE playback (excellent)
70-150ms:                 ACCEPTABLE (normal PTT feel)
> 150ms:                  LATE ENTRY (snuck into chain, marked as late)
```

**Total latency =** Client encoding + network + server processing + client decoding

## Mission Critical Specifics

**Mission Critical clients (GPS + good link):**
- Run 20ms frames for fast recovery
- <70ms target to server
- Fallback to "voice message mode 9" if link degrades:
  - Larger frames (60ms)
  - Store-and-forward behavior
  - "Happy if message arrives at all"

**Mission Critical clients (poor conditions):**
- 20ms frames mandatory
- Optional dual-path redundancy (only if link very weak)
- Accept late entry (>150ms) with insertion marker

## Dynamic Adaptation

```go
type VoiceFrameAdapter struct {
    currentFrameSize  time.Duration  // 20, 40, or 60ms
    rttHistory        []time.Duration
    packetLossRate    float64
    timingQuality     string         // gps, ptp, ntp, unsynced
}

func (v *VoiceFrameAdapter) Adapt() {
    avgRTT := average(v.rttHistory)
    
    // Good conditions → larger frames
    if avgRTT < 50*time.Millisecond && v.timingQuality == "gps" {
        v.currentFrameSize = 60 * time.Millisecond
        return
    }
    
    // Medium conditions
    if avgRTT < 100*time.Millisecond && v.packetLossRate < 0.01 {
        v.currentFrameSize = 40 * time.Millisecond
        return
    }
    
    // Poor conditions → small frames for fast recovery
    v.currentFrameSize = 20 * time.Millisecond
}
```

## Bandwidth Considerations

**NATS over IP:** No bandwidth constraints (typical links 5+ Mbit)

**Even mesh networks (5 Mbit):**
- 20ms frames at 50 pps = ~40 kbps per client
- 10 simultaneous PTT sessions = 400 kbps
- Well within 5 Mbit mesh capacity

**So we can afford smaller frames when needed for reliability.**

## Implementation Flow

```
1. Guardian monitors client RTT and timing quality
   → Publishes qos.client.{unitID}.recommendation

2. Client receives recommendation:
   {
     "recommended_frame_ms": 20,
     "recommended_redundancy": false,
     "rtt_status": "weak",
     "timing_status": "ntp"
   }

3. Client adapts Opus encoder:
   - Frame size: 20ms
   - Bitrate: 8-16 kbps adaptive
   - FEC: enabled for packet loss recovery

4. Client sends with headers:
   X-Frame-Size: 20
   X-Timing-Quality: ntp
   X-Link-Quality: fair
```

## Late Entry Mechanism

```
Timeline for Mission Critical with weak client:

T+0ms:   Client A (GPS) sends "Contact!" → arrives T+30ms (immediate)
T+10ms:  Client B (indoor/NTP) sends "Copy!" 
T+80ms:  Client B packet arrives at server (70ms delay)
         → Within <150ms threshold, normal playback

T+0ms:   Client C (indoor/NTP) sends "Wait!"
T+160ms: Client C packet arrives (160ms delay)
         → LATE ENTRY threshold exceeded
         → Packet inserted at T+0ms position in history
         → UI shows: "[Wait!] [ARRIVED LATE - 160ms]"
         → Audio plays after current buffer drains
```

## Summary

| Scenario | Frame Size | Redundancy | Target Latency |
|----------|------------|------------|----------------|
| GPS + strong link | 60ms (or superframe) | None | <50ms |
| GPS + weak link | 20ms | None | <70ms |
| NTP + strong link | 40ms | None | <70ms |
| NTP + weak link | 20ms | Optional | <150ms |
| Mission Critical | 20ms | If needed | <150ms (late entry OK) |

**Key insight:** Smaller frames = faster recovery, but we can bundle them into superframes for efficient strong clients while keeping granular recovery capability.
