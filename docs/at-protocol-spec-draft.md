# nunect AT Protocol Specification (Draft)

**Version:** 0.1  
**Status:** Draft  
**Scope:** AT-style command protocol for all nunect communication

---

## 1. Protocol Design Principles

1. **AT-inspired:** Use 3GPP TS 27.007 vocabulary where applicable
2. **Compact:** Lowercase, abbreviated, minimal separators
3. **Familiar:** Engineers recognize `csq`, `cme`, `creg` from cellular
4. **Multi-mode:** Verbose (debug), Standard (AT), Packed (NMEA-style), Binary (PDP)

---

## 2. Command Format

### 2.1 Standard Mode (AT-style)
```
key: value
```

**Rules:**
- All lowercase keys
- Colon + space separator (`: `)
- One key-value pair per line
- Lines separated by `\r\n` (CRLF) or `\n` (LF)

### 2.2 Request Prefix
```
!hlt     → Request health status
!csq     → Request signal quality
!clk     → Request clock status
!qos     → Request QoS advisory
!ver     → Request version info
```

### 2.3 Response Format
```
hlt: ok           → Positive response
hlt: err cme: 10  → Error with code
```

---

## 3. Command Reference Table

| nunect | AT Equivalent | 3GPP Reference | Description | Example |
|--------|---------------|----------------|-------------|---------|
| **IDENTITY** |||||
| `uid` | - | Custom | Unit identifier | `uid: sdr-bridge-01` |
| `did` | `+CGDCONT` | TS 27.007 | Device/Context ID | `did: 1` |
| `tid` | - | Custom | Tenant ID | `tid: bridge` |
| **HEALTH** |||||
| `hlt` | `AT` | TS 27.007 | Health status | `hlt: ok` |
| `hlt` | - | Custom | Health request | `!hlt` |
| `sta` | - | Custom | Status code | `sta: 200` |
| **TIMING & CLOCK** |||||
| `tst` | - | Custom | TX timestamp (ns) | `tst: 1707772800000000123` |
| `clk` | `+CCLK` | TS 27.007 | Clock source | `clk: ptp` |
| `cqu` | - | Custom | Clock quality | `cqu: lck` |
| `ctp` | - | Custom | Clock PTP master ID | `ctp: 001122334455` |
| `cof` | - | Custom | Clock offset | `cof: -150` (ns) |
| `cof` | - | Custom | Clock offset ms | `cof: 5.2` (ms, NTP) |
| **NETWORK QUALITY** |||||
| `csq` | `+CSQ` | TS 27.007 | Signal quality | `csq: -72,0` |
| `csq` | `!csq` | TS 27.007 | Signal query | `!csq` |
| `creg` | `+CREG` | TS 27.007 | Registration status | `creg: 1` (1=home) |
| `cops` | `+COPS` | TS 27.007 | Operator/NATS server | `cops: 0,0,"nats.nunet.one"` |
| `rtn` | - | Custom | RTT native (µs) | `rtn: 187` |
| `rta` | - | Custom | RTT app (µs) | `rta: 291` |
| `lnk` | - | Custom | Link quality score | `lnk: 75` |
| **SEQUENCING** |||||
| `sqn` | - | Custom | Sequence number | `sqn: 15823` |
| `sfr` | - | Custom | Superframe count | `sfr: 3` |
| `pkt` | - | Custom | Packet type | `pkt: v` (voice/data/cmd) |
| **VOICE/TRANSPORT** |||||
| `cdc` | - | Custom | Codec | `cdc: opus8` |
| `frs` | - | Custom | Frame size (ms) | `frs: 20` |
| `bit` | - | Custom | Bitrate (kbps) | `bit: 8` |
| `chn` | - | Custom | Channel/Talkgroup | `chn: ch16` |
| `enc` | - | Custom | Encryption | `enc: aes` |
| **PTT CONTROL** |||||
| `ptt` | - | Custom | PTT action | `ptt: req` |
| `pri` | - | Custom | Priority | `pri: emg` |
| `grt` | - | Custom | Grant to | `grt: radio-01` |
| `que` | - | Custom | Queue position | `que: 0` |
| `dur` | - | Custom | Duration (sec) | `dur: 30` |
| **QOS & MODE** |||||
| `qos` | - | Custom | QoS mode | `qos: rt` |
| `buf` | - | Custom | Buffer size (ms) | `buf: 200` |
| `jtr` | - | Custom | Jitter (ms) | `jtr: 5.2` |
| `ploss` | - | Custom | Packet loss % | `ploss: 0.5` |
| **POWER** |||||
| `cbc` | `+CBC` | TS 27.007 | Battery charge | `cbc: 85` |
| `pwr` | - | Custom | Power mode | `pwr: bat` |
| `tmp` | - | Custom | Temperature | `tmp: 45` (°C) |
| **ERROR HANDLING** |||||
| `err` | `+CME ERROR` | TS 27.007 | Error indicator | `err: cme: 10` |
| `err` | `+CMS ERROR` | TS 27.007 | Message error | `err: net: 404` |

---

## 4. Value Enumerations

### 4.1 Clock Source (`clk`)
| Value | Meaning |
|-------|---------|
| `ptp` | PTP (Precision Time Protocol) |
| `ntp` | NTP (Network Time Protocol) |
| `gps` | GPS direct |
| `uns` | Unsynchronized |
| `sys` | System clock only |

### 4.2 Clock Quality (`cqu`)
| Value | Meaning | PTP Offset | NTP Offset |
|-------|---------|------------|------------|
| `lck` | Locked | <1µs | <1ms |
| `trk` | Tracking | <100µs | <10ms |
| `acq` | Acquiring | >100µs | >10ms |
| `fre` | Free running | N/A | N/A |

### 4.3 Health Status (`hlt`)
| Value | Meaning | Action |
|-------|---------|--------|
| `ok` | Operational | None |
| `wrn` | Warning | Monitor |
| `err` | Error | Alert |
| `unk` | Unknown | Investigate |
| `at` | Are you there? | Request |

### 4.4 PTT Actions (`ptt`)
| Value | Meaning |
|-------|---------|
| `req` | Request |
| `grt` | Granted |
| `den` | Denied |
| `rel` | Released |
| `ovr` | Override |
| `que` | Queued |

### 4.5 QoS Modes (`qos`)
| Value | Mode | Buffer | Use Case |
|-------|------|--------|----------|
| `rt` | Realtime | 1ms | GPS everywhere |
| `cor` | Corrected | 20-50ms | Mixed clocks |
| `mc` | Mission Critical | 200-500ms | Unsynced/partitioned |

### 4.6 Codecs (`cdc`)
| Value | Codec | Bitrate |
|-------|-------|---------|
| `opus8` | OPUS | 8 kbps |
| `opus16` | OPUS | 16 kbps |
| `acelp4` | ACELP | 4.8 kbps (TETRA) |
| `ambe4` | AMBE+2 | 4.0 kbps (DMR) |
| `ambe2` | AMBE | 2.4 kbps |
| `pcm64` | PCM | 64 kbps |
| `pcm16` | PCM | 16 kbps |

### 4.7 Error Codes (CME-style)

**Clock/Time Errors (`cme:`)**
| Code | Meaning |
|------|---------|
| `10` | No time source (like SIM not inserted) |
| `11` | Time source not available |
| `12` | Clock not synchronized |
| `13` | PTP master lost |
| `14` | NTP unreachable |

**Network Errors (`net:`)**
| Code | Meaning |
|------|---------|
| `3` | Operation not allowed |
| `32` | Network not allowed (NATS rejected) |
| `404` | Subject not found |
| `503` | Service unavailable |
| `504` | Gateway timeout |

**Auth Errors (`auth:`)**
| Code | Meaning |
|------|---------|
| `401` | Unauthorized |
| `403` | Forbidden |
| `407` | Proxy auth required |

---

## 5. Message Examples

### 5.1 Guardian Heartbeat (5 second interval)
```
uid: guardian-alpha-01
tid: ops
hlt: ok
sqn: 15432
tst: 1707772800000000123
clk: ptp
cqu: lck
cof: -150
csq: -65,0
rtn: 187
rta: 291
lnk: 85
cbc: 95
tmp: 42
```

### 5.2 Voice Frame (20ms OPUS)
```
uid: web-client-42
tst: 1707772800000000123
sqn: 15823
clk: ptp
cqu: lck
cdc: opus8
frs: 20
chn: ch16
enc: aes
```

### 5.3 PTT Request
```
uid: radio-01
ptt: req
pri: emg
tst: 1707772800000000123
dur: 30
chn: tac1
```

### 5.4 PTT Grant (from controller)
```
uid: ptt-controller
ptt: grt
grt: radio-01
que: 0
dur: 60
tst: 1707772800000000123
```

### 5.5 QoS Advisory (Guardian)
```
uid: guardian-alpha-01
qos: cor
buf: 50
fe: 20
bit: 8
lnk: 75
jtr: 5.2
ploss: 0.5
```

### 5.6 Error Response
```
uid: web-client-42
hlt: err
err: cme: 10
msg: ptp_master_lost
```

---

## 6. Packed Mode (NMEA-style)

For low-bandwidth links (LoRaWAN, satellite, congested mesh).

### 6.1 Format
```
$key,value1,value2,...,*CC
```

- `$` prefix (like NMEA sentences)
- Comma-separated values
- `*` + 2-char hex checksum (optional but recommended)
- One line per message type

### 6.2 Protocol Identifiers

| Protocol | Sentence ID | Example |
|----------|-------------|---------|
| Heartbeat | `$NHL` | `$NHL,sdr-01,ok,15432,ptp,lck,-150,85*3A` |
| Voice | `$NVF` | `$NVF,web-42,15823,ptp,lck,opus8,20*5F` |
| PTT | `$NPT` | `$NPT,radio-01,req,emg,1707772800000123*2B` |
| QoS | `$NQS` | `$NQS,guard-01,cor,50,20,75*8C` |
| Signal | `$NSQ` | `$NSQ,-72,0,187,291*4E` |

### 6.3 Sentence Definitions

**$NHL - nunect Heartbeat**
```
$NHL,uid,health,sequence,clk_src,clk_qual,offset,link_score*CC

Example:
$NHL,sdr-01,ok,15432,p,l,-150,85*3A
  uid = sdr-01
  health = ok
  sequence = 15432
  clk_src = p (ptp)
  clk_qual = l (locked)
  offset = -150 ns
  link_score = 85
  checksum = 3A
```

**$NVF - nunect Voice Frame**
```
$NVF,uid,sequence,clk_src,clk_qual,codec,frame_size*CC

Example:
$NVF,web-42,15823,p,l,o8,20*5F
  uid = web-42
  sequence = 15823
  clk_src = p (ptp)
  clk_qual = l (locked)
  codec = o8 (opus8)
  frame_size = 20ms
```

**$NPT - nunect PTT**
```
$NPT,uid,action,priority,timestamp*CC

Example:
$NPT,radio-01,req,emg,1707772800000123*2B
  uid = radio-01
  action = req (request)
  priority = emg (emergency)
  timestamp = 1707772800000123 ns
```

**$NSQ - nunect Signal Quality**
```
$NSQ,rssi_dbm,ber,native_rtt_us,app_rtt_us*CC

Example:
$NSQ,-72,0,187,291*4E
  rssi = -72 dBm
  ber = 0%
  native_rtt = 187 µs
  app_rtt = 291 µs
```

### 6.4 Compact Value Mappings

| Full | Compact | Context |
|------|---------|---------|
| `ptp` | `p` | Clock source |
| `ntp` | `n` | Clock source |
| `gps` | `g` | Clock source |
| `uns` | `u` | Clock source |
| `lck` | `l` | Clock quality |
| `trk` | `t` | Clock quality |
| `acq` | `a` | Clock quality |
| `fre` | `f` | Clock quality |
| `ok` | `o` | Health |
| `wrn` | `w` | Health |
| `err` | `e` | Health |
| `req` | `q` | PTT action |
| `grt` | `g` | PTT action |
| `den` | `d` | PTT action |
| `rel` | `r` | PTT action |
| `opus8` | `o8` | Codec |
| `opus16` | `o16` | Codec |
| `acelp4` | `a4` | Codec |
| `ambe4` | `m4` | Codec |
| `emg` | `e` | Priority |
| `nor` | `n` | Priority |

### 6.5 Size Comparison

| Message | Verbose AT | Packed NMEA | Savings |
|---------|-----------|-------------|---------|
| Heartbeat | ~180 bytes | ~50 bytes | 72% |
| Voice frame | ~120 bytes | ~35 bytes | 71% |
| PTT control | ~100 bytes | ~30 bytes | 70% |

---

## 7. PDP-style Binary Packaging (Future Work)

For ultra-low bandwidth or high-frequency streaming.

### 7.1 Concept

Inspired by GPRS PDP contexts - separate control plane (verbose) from data plane (binary).

```
# Control plane: Set up context (rare, verbose acceptable)
+CGDCONT: 1,"NUNECT","voice.ch16","",0,0
+CGQREQ: 1,3,4,3,0,0

# Data plane: Binary packets (frequent, minimal overhead)
+CGDATA: 1,<binary-header><payload>
```

### 7.2 Binary Header Structure (8-16 bytes)

```c
struct nunect_binary_header {
    uint8_t  protocol_id;     // 0x01 = voice, 0x02 = data, 0x03 = control
    uint8_t  flags;           // Encryption, compressed, etc.
    uint16_t sequence;        // Sequence number
    uint32_t timestamp_lo;    // Timestamp (microseconds)
    uint32_t timestamp_hi;    // Timestamp (high bits if needed)
    uint8_t  qos_byte;        // Clock quality, frame size, priority
    uint8_t  checksum;        // Simple XOR checksum
} __attribute__((packed));    // 12 bytes
```

### 7.3 Protocol Context Table

| Context ID | Protocol | Predefined Headers |
|------------|----------|-------------------|
| `1` | DMR Voice | Timeslot, CC, codec=ambe4 |
| `2` | TETRA Voice | MNI, SSId, codec=acelp4 |
| `3` | Web OPUS | Channel, codec=opus8/16 |
| `4` | Telemetry | GPS, sensors, JSON payload |
| `5` | PTT Control | Priority, arbitration |

### 7.4 Example Flow

```
# 1. Establish context (control plane, reliable transport)
Client → Server: +CGDCONT: 3,"NUNECT","com.bridge.opus.web42.ch16","",0,0
Server → Client: +CGDCONT: 3,OK

# 2. Activate context
Client → Server: +CGACT: 3,1
Server → Client: +CGACT: 3,1,OK

# 3. Stream data (data plane, binary, minimal overhead)
Client → Server: +CGDATA: 3,<12-byte-header><opus-frame>
Client → Server: +CGDATA: 3,<12-byte-header><opus-frame>
...

# 4. Deactivate
Client → Server: +CGACT: 3,0
```

### 7.5 NMEA-style Context Header

One-line predefined header for each protocol:

**DMR Protocol:**
```
$NCT,DMR,1,ambe4,12.5,1,1*CC
# Context: DMR
# ID: 1
# Codec: ambe4
# Bandwidth: 12.5 kHz
# Timeslot: 1
# Color Code: 1
```

**TETRA Protocol:**
```
$NCT,TETRA,2,acelp4,25,1,100*CC
# Context: TETRA
# ID: 2
# Codec: acepl4
# Bandwidth: 25 kHz
# MNI: 1
# SSId: 100
```

**Web OPUS:**
```
$NCT,OPUS,3,opus8,20,0,0*CC
# Context: OPUS
# ID: 3
# Codec: opus8
# Frame: 20ms
# Encryption: 0 (none)
# FEC: 0 (off)
```

Then data packets use the Context ID:
```
$NDT,3,15823,1707772800000123,p,l,<payload>*CC
# Data for context 3
# Sequence: 15823
# Timestamp: ...
# Clock: ptp, locked
```

---

## 8. Protocol Selection

### 8.1 Decision Matrix

| Scenario | Protocol | Why |
|----------|----------|-----|
| Development/debug | Standard AT | Human readable, tcpdump friendly |
| WiFi/5G production | Standard AT | Bandwidth sufficient, debuggable |
| LoRaWAN/satellite | Packed NMEA | 70% bandwidth savings |
| High-freq streaming | PDP Binary | Minimal per-packet overhead |
| Mixed infrastructure | Auto-negotiate | Context announces format |

### 8.2 Auto-Negotiation

Capability exchange during provisioning:

```
Client → Server:
+cap: at,nmea,pdp
+cap: max_bw=250
+cap: preferred=nmea

Server → Client:
+cfg: protocol=nmea
+cfg: context=3
+cfg: sentence=$NVF
```

---

## Appendix A: 3GPP Command Mapping

| 3GPP Command | Description | nunect Equivalent |
|--------------|-------------|-------------------|
| `AT` | Attention (ready check) | `hlt: at` |
| `+CSQ` | Signal quality | `csq: -72,0` |
| `+CME ERROR` | ME error | `err: cme: 10` |
| `+CMS ERROR` | Message error | `err: net: 404` |
| `+CREG` | Registration | `creg: 1` |
| `+COPS` | Operator selection | `cops: 0,0,"nats.nunet.one"` |
| `+CCLK` | Clock | `clk: ptp` (inspired) |
| `+CBC` | Battery charge | `cbc: 85` |
| `+CGDCONT` | PDP context define | Context setup (future) |
| `+CGACT` | PDP context activate | Context activate (future) |
| `+CGDATA` | Enter data state | Binary data (future) |
| `+CGQREQ` | QoS profile | `qos: cor, buf=50` (inspired) |

---

## Appendix B: Quick Reference Card

```
IDENTITY:    uid did tid
HEALTH:      hlt sta
TIMING:      tst clk cqu cof
NETWORK:     csq creg cops rtn rta lnk
SEQUENCING:  sqn sfr pkt
VOICE:       cdc frs bit chn enc
PTT:         ptt pri grt que dur
QOS:         qos buf jtr ploss
POWER:       cbc pwr tmp
ERROR:       err (cme/net/auth):code

VALUES:
clk: ptp/ntp/gps/uns
clk: lck/trk/acq/fre
hlt: ok/wrn/err/unk/at
ptt: req/grt/den/rel/ovr
qos: rt/cor/mc

PACKED PREFIX: $Nxx (NMEA-style)
$NHL = Heartbeat, $NVF = Voice, $NPT = PTT, $NQS = QoS
```

---

**See Also:**
- `protocol-spec-draft.md` - Detailed message specifications
- `voice-protocol-spec-draft.md` - Voice/PTT specifics
- `qos-protocol-spec-draft.md` - QoS algorithms and modes
