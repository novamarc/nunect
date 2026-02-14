# The Universal Backbone Vision

## Core Principle: Transport-Agnostic, QoS-Aware, Scale-Invariant

nunect is designed as a **universal message backbone** that runs on any IP transport - from AliExpress dual-radio femto nodes to global cloud infrastructure.

## Scale Spectrum

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           UNIVERSAL SPECTRUM                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   FEMTO NODE        MESH NETWORK          ENTERPRISE         GLOBAL         │
│   (nuNode)          (MANET)               (NATS Leaf)        (Cloud)        │
│                                                                             │
│   ┌──────────┐      ┌──────────┐         ┌──────────┐      ┌──────────┐     │
│   │Raspberry │      │ 2.4GHz   │         │  Leaf    │      │  Core    │     │
│   │Pi Zero   │◄────►│  Mesh    │◄───────►│  Server  │◄────►│ Cluster  │     │
│   │+ Dual    │      │(MANET)   │         │          │      │          │     │
│   │  Radio   │      │also Raspi│         │          │      │          │     │
│   └──────────┘      └──────────┘         └──────────┘      └──────────┘     │
│        │                 │                    │                  │          │
│   ┌──────────┐      ┌──────────┐         ┌──────────┐      ┌──────────┐     │
│   │Guardian  │      │Guardian  │         │Guardian  │      │Guardian  │     │
│   │(Local    │      │(Mesh     │         │(Regional │      │(Global   │     │
│   │  QoS)    │      │  Coord)  │         │  Coord)  │      │  Monitor)│     │
│   └──────────┘      └──────────┘         └──────────┘      └──────────┘     │
│                                                                             │
│   Range: 100m       Range: 2km            Range: Global     Range: Global   │
│   Power: 500mW      Power: 1W             Power: Wired      Power: Cloud    │
│   Nodes: 2-10       Nodes: 50-200         Nodes: 1000s       Nodes: Millions │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Femto Node (nuNode) - Proof of Concept

### Hardware
- **SBC**: Raspberry Pi Zero 2 W / Orange Pi
- **Radio**: AliExpress 500mW dual-band (2.4GHz + 5GHz)
  - 2.4GHz: Long-range mesh backhaul (to fire truck/gateway)
  - 5GHz: High-bandwidth local comms (voice + video)
- **Power**: 5V USB, ~2W total consumption
- **Cost**: <$50 per node

### Software Stack
```
OpenWRT / Alpine Linux
  ├─ NATS Leaf Node (nats-server --leaf)
  ├─ Guardian (ARM64 binary)
  │   ├─ Local QoS monitoring
  │   ├─ Mesh neighbor discovery
  │   └─ Battery/thermal monitoring
  ├─ PTP client (if GPS module attached)
  ├─ BATMAN-adv / 802.11s mesh
  └─ VPN tunnel (WireGuard to core)
```

### Use Case: Fire Department Close Quarters

```
Firefighter Team Alpha (inside building) each with nunode:
├─ FF1: Helmet cam + vitals + voice
│   ├─ 5GHz: Local mesh to nuNode on backpack
│   └─ nuNode: 2.4GHz backhaul to truck
├─ FF2: Same setup
├─ FF3: Same setup
└─ nuNode (team lead): Mesh coordinator
    ├─ 5GHz: Team local mesh (low latency)
    ├─ 2.4GHz: Link to fire truck outside
    └─ Guardian: Advises team on QoS

Fire Truck (outside building):
├─ Gateway nuNode: Receives 2.4GHz mesh
├─ 4G/5G: Uplink to dispatch center
└─ Guardian: Coordinates multiple teams
```

## Mesh Roaming via Guardian QoS Advisory

### The Problem
Firefighter moves from Team Alpha (indoor) to Team Bravo (different floor):
- Signal from Alpha nuNode weakens
- Signal from Bravo nuNode strengthens
- Connection must handover seamlessly

### Guardian Solution
```
FF1's device monitors:
├─ RSSI to Alpha nuNode: -85dBm (weak)
├─ RSSI to Bravo nuNode: -65dBm (good)
├─ Link quality trending: DOWN
└─ Reports to: Alpha Guardian

Alpha Guardian publishes:
Subject: qos.mesh.handover.advisory
{
  "client": "ff1-helmet-cam",
  "current_node": "alpha-nunode-01",
  "signal_quality": "fair",
  "better_node": "bravo-nunode-02",
  "handover_recommended": true,
  "timing": "immediate"
}

FF1 device:
1. Subscribes to qos.mesh.handover.advisory
2. Receives recommendation
3. Pre-connects to Bravo nuNode (maintains Alpha connection)
4. Seamless handover when Alpha drops below threshold
5. Publishes to ops.roam.handover.complete
```

### Protocol Agnostic Transport

nunect runs on **any IP transport**:

| Transport | Use Case | Guardian Adaptation |
|-----------|----------|---------------------|
| **WiFi Mesh (802.11s)** | Fire dept, festivals | Link quality monitoring, mesh roaming |
| **LoRaWAN** | Long-range sensors, low bandwidth | Very small frames, store-and-forward |
| **5G/4G** | Mobile clients, wide area | Standard QoS, handover awareness |
| **Fiber/Ethernet** | Fixed sites, high bandwidth | Large frames, minimal overhead |
| **Satellite** | Remote/maritime | High latency tolerant, large buffers |
| **Dual-radio** | Mesh + backhaul | Automatic path selection |

### Unified Security & Audit

Same security model from femto to global:

```
Femto Node (nuNode):
├─ mTLS to Leaf Server
├─ JWT per firefighter (short-lived)
├─ Subject whitelist per role
└─ Audit log: ops.log.{level}.{unitID}

Global Enterprise:
├─ mTLS to Core Cluster
├─ JWT per service account
├─ Subject whitelist per tenant
└─ Audit log: ops.log.{level}.{unitID}

Same headers, same encryption, same audit trail.
```

## The Dial-In Protocol

Guardian advises, clients vote:

```javascript
// Guardian at nuNode publishes local conditions
nc.publish('qos.local.advisory', {
  "node_id": "nunode-alpha-01",
  "link_quality": {
    "rssi_dbm": -72,
    "packet_loss_percent": 0.5,
    "bandwidth_kbps": 2048
  },
  "recommended": {
    "frame_size_ms": 20,        // Small for mesh reliability
    "bitrate_kbps": 8,          // Conservative for 2.4GHz backhaul
    "redundancy": false,        // Not needed yet
    "buffer_ms": 100            // Accommodate mesh jitter
  }
});

// Firefighter helmet cam adapts
if (qos.recommended.frame_size_ms === 20) {
  opus.setFrameSize(20);
  opus.setBitrate(8000);
  enableFastRecovery();
}
```

## From E-Commerce to Mission Critical

| Feature | E-Commerce | Mission Critical |
|---------|-----------|------------------|
| **Same protocol** | ✅ NATS pub/sub | ✅ NATS pub/sub |
| **Same headers** | ✅ X-TX-Timestamp | ✅ X-TX-Timestamp |
| **Same Guardian** | ✅ QoS monitoring | ✅ QoS + mesh roaming |
| **Same security** | ✅ mTLS + JWT | ✅ mTLS + JWT |
| **Frame size** | 60ms (efficient) | 20ms (reliable) |
| **Buffer** | 5ms (fast) | 200ms (resilient) |
| **Redundancy** | ❌ None | ✅ Optional dual-path |

**One codebase, one protocol, infinite scalability.**

## Future: LoRaWAN Integration

For ultra-long-range, ultra-low-bandwidth scenarios:

```
Sensor (forest fire detection):
├─ LoRaWAN: 50 bytes every 5 minutes
├─ LoRa Gateway → IP network
├─ NATS Leaf (tiny, embedded)
└─ Guardian (minimal): Just reports "alive"

Voice over LoRa? Not practical.
But: Voice over 4G + telemetry over LoRa = perfect combo.
```

## Summary

> **nunect is the universal message backbone.**
> 
> From a $50 Raspberry Pi with an AliExpress radio in a firefighter's backpack,
> to a global cloud cluster processing millions of e-commerce transactions,
> the protocol, the security, and the QoS awareness remain the same.
> 
> Only the frame size changes.
