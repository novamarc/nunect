# Time Sync & RTT Implementation Details

## 1. Per-Message RTT Modes

### Admin Mode (Current)
- Constant 5-second heartbeats with RTT measurement
- Full metrics published to `ops.metric.rtt.{unitID}`
- Used for: Dashboard monitoring, baseline QoS

### Active Transmission Mode (PTT)
- **On PTT press**: Immediate RTT probe to determine current path quality
- **During transmission**: Periodic samples (every 1-2 seconds)
- **On PTT release**: Final quality report

**Implementation:**
```go
// PTT Session State
type PTTSession struct {
    Channel       string
    StartTime     time.Time
    RTTSamples    []RTTMeasurement
    CurrentQoS    QoSLevel  // calculated from samples
}

// Before transmitting
func (s *PTTSession) CheckQoS() QoSLevel {
    // Fast RTT probe
    rtt := measureAppRTT(nc, echoSubject)
    if rtt > 300*time.Millisecond {
        return QoS_Degraded  // Warn user
    }
    return QoS_Good
}

// During transmission (async)
func (s *PTTSession) SampleQoS() {
    ticker := time.NewTicker(1 * time.Second)
    for range ticker.C {
        rtt := measureAppRTT(nc, echoSubject)
        s.RTTSamples = append(s.RTTSamples, rtt)
        // Publish lightweight QoS update
        nc.Publish(fmt.Sprintf("qos.%s.%s", s.Channel, unitID), 
            []byte(fmt.Sprintf("%d", rtt.Milliseconds())))
    }
}
```

**Header during PTT:**
```
X-PTT-Session:     abc123
X-RTT-At-Start:    150ms
X-QoS-Level:       good|fair|poor
X-TX-Timestamp:    1707772800000000123
```

---

## 2. NTP Server Discovery & Configuration

### Can UI Determine Client's NTP Server?

**Browser (JavaScript): NO**
- Browsers cannot access system NTP settings (security sandbox)
- Cannot read `/etc/chrony.conf` or Windows registry

**What we CAN do:**

#### Option A: UI Script Probes NTP
```javascript
// In browser, we can't read system config
// But we can try to detect sync quality via Web API (limited)

// Option: Ask user to install PWA or native app wrapper
// That can access system settings
```

#### Option B: Server Tells Client
```javascript
// Guardian publishes its NTP servers
// Mobile client subscribes to ops.time.config

nc.subscribe('ops.time.config', (msg) => {
    const config = JSON.parse(msg.data);
    // Show user: "Recommended NTP: pool.ntp.org"
    // Or auto-configure if we have native app
});
```

### How to Change NTP on Android

**Rooted:** Edit `/system/etc/gps.conf` or use `settings put global ntp_server ...`

**Non-rooted (App approach):** Cannot change system NTP directly
- Option 1: VPN app that intercepts NTP traffic
- Option 2: Custom NTP client in app (app uses its own clock, not system)
<<<<USERCOMMENT: Option 2 is great fo when mobile client has App Frame installed that fetched UI but gives access to system hardware net select>>>>

**Non-rooted (User instructions):**
```
Settings → System → Date & Time → Network-provided time (toggle off/on)
Or: Developer Options → NTP server (if available)
```

---

## 3. "Good Faith Mode" - Protocol-Level Clock Sync

### Problem: Mobile can't change system NTP
### Solution: App-level clock synchronization

<<<< I think your proposal calculates one trip from clinet to guardian, no? we want it to make shure that Guardian knows and calculate the difference to its own the clinets  now() >>>>
<<<< Abount that, xurrent way does not take into account true sever rounttrip, but via guardian, so we either substract 2x guardian to server time or fix by letting server repuplish a clinet selfcare package on a/the QoS Chanel similar to what you described in the header.>>>>
```
┌──────────────┐                    ┌──────────────┐
│ Mobile Client│                    │ Guardian     │
│ (App Clock)  │                    │ (Reference)  │
└──────┬───────┘                    └──────┬───────┘
       │                                    │
       ├─ Request Time Sync ───────────────►│
       │  X-My-App-Time: 1000.0             │
       │                                    │
       │◄─ Response ────────────────────────┤
       │  X-Your-App-Time: 1000.0           │
       │  X-My-Ref-Time: 1000.5             │
       │  X-My-Clock-Source: ntp            │
       │  X-My-Clock-Quality: locked        │
       │                                    │
       └─ Calculate offset: +0.5ms ─────────┘
```

**Implementation:**

```go
// AppClockSync maintains app-level time offset
type AppClockSync struct {
    OffsetMs      float64   // App time - Reference time
    LastSync      time.Time
    SourceQuality string    // locked, tracking, etc.
}

func (a *AppClockSync) SyncWithReference(nc *nats.Conn, refUnit string) error {
    start := time.Now()
    
    // Request sync from reference (Guardian with good clock)
    resp, err := nc.Request(fmt.Sprintf("ops.time.sync.%s", refUnit), 
        []byte(fmt.Sprintf("%d", start.UnixMilli())), 
        2*time.Second)
    if err != nil {
        return err
    }
    
    roundTrip := time.Since(start)
    
    // Parse response
    refTime, _ := strconv.ParseInt(string(resp.Data), 10, 64)
    myTime := time.Now().UnixMilli()
    
    // Calculate one-way latency approximation
    oneWay := roundTrip / 2
    
    // Calculate offset: my time should be refTime + oneWay
    a.OffsetMs = float64(myTime - refTime - oneWay.Milliseconds())
    a.LastSync = time.Now()
    
    return nil
}

func (a *AppClockSync) Now() time.Time {
    // Return app-adjusted time
    return time.Now().Add(time.Duration(a.OffsetMs) * time.Millisecond)
}
```

**Usage in PTT:**
```go
// Before sending voice packet
timestamp := appClock.Now().UnixNano() // Synced to reference
headers.Add("X-TX-Timestamp", strconv.FormatInt(timestamp, 10))
headers.Add("X-Clock-Mode", "good-faith") // vs "system-ntp" vs "ptp"
```

---

## 3.1 Mobile Client Configuration Options
<<<< we will definetly implement that UI Info >>>>
### Via UI Script (Limited)
```javascript
// Browser can't change system settings
// Can only show instructions to user

function showNTPInstructions() {
    const os = detectOS();
    if (os === 'android') {
        alert(`
To sync time with server:
1. Settings → System → Date & Time
2. Enable "Network-provided time"
3. Or use: Settings → Developer Options → NTP Server
4. Set to: ${recommendedNTPServer}
        `);
    }
}
```

### Via Native App / PWA
```javascript
// Capacitor/Electron app with native access
// Can modify system settings (with permissions)

if (Capacitor.isNativePlatform()) {
    await NTPPlugin.setServer({
        server: 'pool.ntp.org'
    });
}
```

### Via Background Worker (Recommended for PTT App)
```kotlin
// Android WorkManager - runs even when app closed
class NTPWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        // Sync with server periodically
        val offset = syncWithRemoteNTP()
        saveOffsetToPreferences(offset)
        return Result.success()
    }
}
```

---

## 4. GPS Mode for Time Sync

### Why GPS
- Stratum 0 (atomic clock on satellites)
- <100ns accuracy achievable
- Works offline (no network needed)
- No dependency on NTP infrastructure

### Implementation

```go
// GPSStatus from gpsd or Android LocationManager
type GPSStatus struct {
    GPSTime      int64   `json:"gps_time_ns"`       // GPS time (TAI - 19s)
    UTCOffset    int     `json:"utc_offset_s"`      // Leap seconds (currently 37)
    Satellites   int     `json:"satellites_used"`
    FixQuality   string  `json:"fix_quality"`       // 3D, 2D, DGPS, etc.
    HDOP         float64 `json:"hdop"`              // Horizontal dilution of precision
}

func (g *GPSStatus) GetUnixTime() int64 {
    // GPS time started at 1980-01-06
    // Add UTC offset to get Unix time
    return g.GPSTime + int64(g.UTCOffset)*1e9
}
```

**Android (Java/Kotlin):**
```kotlin
val locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
locationManager.registerGnssStatusCallback(object : GnssStatus.Callback() {
    override fun onSatelliteStatusChanged(status: GnssStatus) {
        val satCount = status.satelliteCount
        // Publish GPS status to NATS
    }
})

// Get GPS time from Location
val location: Location = ...
val gpsTimeNs = location.elapsedRealtimeNanos
val unixTimeMs = location.time
```

**Go (gpsd):**
```go
// Connect to gpsd
gps, err := gpsd.Dial(gpsd.DefaultAddress)
if err != nil {
    log.Fatal(err)
}

gps.AddFilter("TPV", func(r interface{}) {
    tpv := r.(*gpsd.TPV)
    // tpv.Time is GPS time
    status := GPSStatus{
        GPSTime:    tpv.Time.UnixNano(),
        Satellites: tpv.Sats,
        FixQuality: tpv.Mode.String(),
    }
    // Publish to NATS
})
```

**Headers when GPS is source:**
```
X-Clock-Source:     gps
X-Clock-Quality:    locked
X-GPS-Sats:         12
X-GPS-HDOP:         0.8
X-UTC-Offset:       37
```

### GPS + NTP Hybrid Mode
```go
// Prefer GPS when available, fallback to NTP
type HybridClock struct {
    GPSTime   *GPSStatus
    NTPTime   *NTPStatus
}

func (h *HybridClock) GetBestTime() (time.Time, string) {
    if h.GPSTime != nil && h.GPSTime.Satellites >= 4 {
        // GPS has fix
        return time.Unix(0, h.GPSTime.GetUnixTime()), "gps"
    }
    if h.NTPTime != nil && h.NTPTime.Quality == "locked" {
        return time.Now().Add(time.Duration(h.NTPTime.OffsetMs) * time.Millisecond), "ntp"
    }
    return time.Now(), "unsynced"
}
```

---

## 5. PTT Floor Control via Clock Sync
<<<< PTT Flor calc happens on server to order republish/manibulae meassage seqence and finalised TS fro log with offsets >>>>
### Calculate Skew for Fair PTT Arbitration

```
Scenario: Two users press PTT "simultaneously"

User A (Mobile, NTP):
  Local press time:  T_A = 1000.0ms
  NTP offset:        +5.0ms (A is 5ms fast)
  True time:         1000.0 - 5.0 = 995.0ms

User B (Guardian, PTP):
  Local press time:  T_B = 1002.0ms
  PTP offset:        -0.1ms (B is 0.1ms slow)
  True time:         1002.0 + 0.1 = 1002.1ms

Arbitration:
  User A pressed first (995.0ms vs 1002.1ms)
  Winner: User A gets floor
```
<<<< This is PTT server code >>>>
**Implementation:**
```go
func DetermineFloorWinner(presses []PTTPress) string {
    var winner string
    var earliestTime int64 = math.MaxInt64
    
    for _, press := range presses {
        // Adjust for clock skew
        adjustedTime := press.LocalTime - press.ClockOffset
        
        if adjustedTime < earliestTime {
            earliestTime = adjustedTime
            winner = press.UnitID
        }
    }
    
    return winner
}
```

### Dynamic Buffer Calculation
<<<< this is Clinet and server code ? >>>>
```go
func CalculateBuffer(rttHistory []time.Duration, clockQuality string) time.Duration {
    // Base buffer on RTT jitter
    avg := average(rttHistory)
    stddev := stddev(rttHistory)
    
    // Quality multiplier
    multiplier := 2.0 // default
    switch clockQuality {
    case "gps":
        multiplier = 1.5  // GPS is very stable
    case "ptp":
        multiplier = 2.0  // PTP is good
    case "ntp":
        multiplier = 3.0  // NTP has more jitter
    case "unsynced":
        multiplier = 5.0  // Conservative for unsynced
    }
    
    buffer := avg + time.Duration(multiplier*float64(stddev))
    
    // Clamp to reasonable bounds
    if buffer < 50*time.Millisecond {
        buffer = 50 * time.Millisecond
    }
    if buffer > 500*time.Millisecond {
        buffer = 500 * time.Millisecond
    }
    
    return buffer
}
```

---

## Summary: Implementation Phases

### Phase 1 (Now): Good Faith Mode
- App-level clock sync via protocol
- Works without system NTP changes
- Sufficient for PTT floor control

### Phase 2: GPS Mode
- Add GPS status to TimeSync
- Hybrid GPS+NTP mode
- Best accuracy for critical PTT

### Phase 3: PTT QoS Mode
- On-demand RTT during transmission
- QoS headers in voice packets
- Dynamic buffer calculation

### Phase 4: Native Mobile Apps
- Background NTP sync workers
- System-level NTP configuration
- Native GPS access
