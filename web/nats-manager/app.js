/**
 * nunect NATS Manager UI
 * 
 * Uses nats.ws library for proper WebSocket connectivity
 * Implements RTT measurement pattern matching guardian and other clients
 */

import { connect, StringCodec } from './node_modules/nats.ws/esm/nats.js';

// Configuration (injected by server from .env)
let apiUrl = window.NUNECT_CONFIG?.natsHttpUrl || 'https://localhost:4280/api';
let wsUrl = window.NUNECT_CONFIG?.natsWsUrl || 'wss://localhost:8443';
let nc = null;  // NATS connection
let sc = StringCodec();
let eventCount = 0;

// RTT Metrics tracking
let rttMetrics = new Map(); // unit_id -> { native_rtt, app_rtt, sequence, last_seen }
let rttCheckInterval = null;
let heartbeatInterval = null;
let uiSequence = 0; // Sequence counter for our own metrics

// Generate unique unit ID from browser fingerprint
function generateUnitId() {
    // Check for explicit override in URL
    const urlParams = new URLSearchParams(window.location.search);
    const explicitClient = urlParams.get('client');
    if (explicitClient) {
        return `nats-ui-${explicitClient}`;
    }
    
    // Auto-detect from user agent
    const ua = navigator.userAgent;
    
    // Detect type: mobile vs laptop
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    const type = isMobile ? 'mobile' : 'laptop';
    
    // Detect OS
    let os = 'unknown';
    if (/Windows/i.test(ua)) os = 'win';
    else if (/Mac|iPhone|iPad|iPod/i.test(ua)) os = 'mac';
    else if (/Linux/i.test(ua)) os = 'linux';
    else if (/Android/i.test(ua)) os = 'android';
    
    // Generate random suffix for uniqueness
    const random = Math.random().toString(36).substring(2, 6);
    
    return `nats-ui-${type}-${os}-${random}`;
}

// Our unit ID for this client session
let unitId = generateUnitId();
console.log('Generated unitId:', unitId);

// Time Sync Metrics tracking
let timeMetrics = new Map(); // unit_id -> { source, quality, ptp_offset, ntp_offset, last_seen }

// Initialize connection from injected config
function initConfig() {
    // Set input values from config
    document.getElementById('apiUrl').value = apiUrl;
    document.getElementById('wsUrl').value = wsUrl;
    
    // Display current domain
    const domain = window.NUNECT_CONFIG?.domain || window.location.hostname;
    const port = window.location.port;
    const display = port && port !== '80' && port !== '443' 
        ? `${domain}:${port}` 
        : domain;
    document.getElementById('domainDisplay').textContent = `(${display})`;
    
    // Display and log our identity
    try {
        const clientIdEl = document.getElementById('clientId');
        if (clientIdEl) {
            clientIdEl.textContent = unitId;
            console.log('Client ID displayed:', unitId);
        } else {
            console.error('clientId element not found in DOM');
        }
    } catch (e) {
        console.error('Error displaying client ID:', e);
    }
    console.log(`UI Client Identity: ${unitId}`);
    addEvent(`Client identity: ${unitId}`, 'info');
}

// Update status indicator
function setStatus(connected) {
    const status = document.getElementById('connectionStatus');
    if (connected) {
        status.textContent = 'Connected';
        status.className = 'status ok';
    } else {
        status.textContent = 'Disconnected';
        status.className = 'status error';
    }
}

// Update RTT display
function updateRTTDisplay(rttMs) {
    const rttStatus = document.getElementById('rttStatus');
    if (rttMs === null) {
        rttStatus.textContent = 'RTT: --';
        rttStatus.className = 'status';
    } else {
        rttStatus.textContent = `RTT: ${rttMs.toFixed(1)}ms`;
        // Color code based on latency
        if (rttMs < 100) {
            rttStatus.className = 'status ok';
        } else if (rttMs < 300) {
            rttStatus.className = 'status warn';
        } else {
            rttStatus.className = 'status error';
        }
    }
}

// Manual reconnect (when user changes inputs)
function reconnect() {
    apiUrl = document.getElementById('apiUrl').value;
    wsUrl = document.getElementById('wsUrl').value;
    
    // Test HTTP connection
    fetchVarz();
    fetchConnz();
    
    // Connect WebSocket via NATS library
    connectNATS();
}

// Fetch server stats
async function fetchVarz() {
    try {
        const resp = await fetch(`${apiUrl}/varz`);
        const data = await resp.json();
        document.getElementById('varz').textContent = JSON.stringify(data, null, 2);
        setStatus(true);
    } catch (err) {
        document.getElementById('varz').textContent = `Error: ${err.message}`;
        setStatus(false);
    }
}

// Fetch connections
async function fetchConnz() {
    try {
        const resp = await fetch(`${apiUrl}/connz`);
        const data = await resp.json();
        
        let html = `<p>Total connections: ${data.num_connections}</p>`;
        html += '<table><tr><th>CID</th><th>IP</th><th>Port</th><th>RTT</th><th>Name</th><th>Subs</th></tr>';
        
        for (const conn of data.connections || []) {
            html += `<tr>
                <td>${conn.cid}</td>
                <td>${conn.ip}</td>
                <td>${conn.port}</td>
                <td>${conn.rtt || 'N/A'}</td>
                <td>${conn.name || '-'}</td>
                <td>${conn.subscriptions}</td>
            </tr>`;
        }
        html += '</table>';
        
        document.getElementById('connz').innerHTML = html;
    } catch (err) {
        document.getElementById('connz').innerHTML = `Error: ${err.message}`;
    }
}

// Fetch subscriptions
async function fetchSubsz() {
    try {
        const resp = await fetch(`${apiUrl}/subsz`);
        const data = await resp.json();
        document.getElementById('subsz').textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        document.getElementById('subsz').textContent = `Error: ${err.message}`;
    }
}

// Format microseconds to human readable
function formatMicroseconds(us) {
    if (us === 0 || us === undefined) return '--';
    if (us < 1000) return `${us}µs`;
    if (us < 1000000) return `${(us / 1000).toFixed(2)}ms`;
    return `${(us / 1000000).toFixed(2)}s`;
}

// Get color class based on latency
function getLatencyClass(us, thresholdGood = 1000, thresholdWarn = 10000) {
    if (us === 0 || us === undefined) return '';
    if (us < thresholdGood) return 'metric-good';
    if (us < thresholdWarn) return 'metric-warn';
    return 'metric-bad';
}

// Update RTT metrics table display
function updateRTTTable() {
    const container = document.getElementById('rttMetrics');
    const countEl = document.getElementById('rttCount');
    
    if (rttMetrics.size === 0) {
        container.innerHTML = `
            <table>
                <tr>
                    <th>Unit ID</th>
                    <th>Seq</th>
                    <th class="rtt-native">Native RTT</th>
                    <th class="rtt-app">App RTT</th>
                    <th>Last Seen</th>
                </tr>
            </table>
            <p class="note">Waiting for metrics from ops.metric.rtt.></p>
        `;
        countEl.textContent = '0 clients';
        return;
    }
    
    let html = `
        <table>
            <tr>
                <th>Unit ID</th>
                <th>Seq</th>
                <th class="rtt-native">Native RTT</th>
                <th class="rtt-app">App RTT</th>
                <th>Last Seen</th>
            </tr>
    `;
    
    // Sort by last seen (most recent first)
    const sorted = Array.from(rttMetrics.entries()).sort((a, b) => b[1].last_seen - a[1].last_seen);
    
    for (const [unitId, data] of sorted) {
        const age = Date.now() - data.last_seen;
        const ageStr = age < 60000 ? `${Math.floor(age / 1000)}s ago` : `${Math.floor(age / 60000)}m ago`;
        const nativeClass = getLatencyClass(data.native_rtt, 500, 5000); // <500us good, <5ms warn
        const appClass = getLatencyClass(data.app_rtt, 1000, 10000);    // <1ms good, <10ms warn
        
        html += `
            <tr>
                <td>${unitId}</td>
                <td>${data.sequence}</td>
                <td class="${nativeClass} rtt-native">${formatMicroseconds(data.native_rtt)}</td>
                <td class="${appClass} rtt-app">${formatMicroseconds(data.app_rtt)}</td>
                <td>${ageStr}</td>
            </tr>
        `;
    }
    
    html += '</table>';
    container.innerHTML = html;
    countEl.textContent = `${rttMetrics.size} client${rttMetrics.size !== 1 ? 's' : ''}`;
}

// Clear RTT metrics
function clearRTTMetrics() {
    rttMetrics.clear();
    updateRTTTable();
}

// Handle incoming RTT metric
function handleRTTMetric(data) {
    const unitId = data.unit_id;
    if (!unitId) return;
    
    rttMetrics.set(unitId, {
        native_rtt: data.native_rtt_us,
        app_rtt: data.app_rtt_us,
        sequence: data.seq,
        timestamp: data.ts,
        last_seen: Date.now()
    });
    
    updateRTTTable();
}

// Handle incoming Time Sync metric
function handleTimeMetric(data) {
    const unitId = data.unit_id;
    if (!unitId) return;
    
    timeMetrics.set(unitId, {
        active_source: data.active_source,
        clock_quality: data.clock_quality,
        ptp_offset: data.ptp_offset_ns,
        ntp_offset: data.ntp_offset_ms,
        ptp_master: data.ptp_master,
        ntp_servers: data.ntp_servers,
        sequence: data.seq,
        timestamp: data.ts,
        last_seen: Date.now()
    });
    
    updateTimeTable();
    
    // If this is our own unit, update local status display
    if (unitId === unitId) {
        updateLocalTimeStatus(data);
    }
}

// Update Time Sync metrics table display
function updateTimeTable() {
    const container = document.getElementById('timeMetrics');
    const countEl = document.getElementById('timeCount');
    
    if (timeMetrics.size === 0) {
        container.innerHTML = `
            <table>
                <tr>
                    <th>Unit ID</th>
                    <th>Source</th>
                    <th>Quality</th>
                    <th>PTP Offset</th>
                    <th>NTP Offset</th>
                    <th>Last Seen</th>
                </tr>
            </table>
            <p class="note">Waiting for metrics from ops.metric.time.></p>
        `;
        countEl.textContent = '0 nodes';
        return;
    }
    
    let html = `
        <table>
            <tr>
                <th>Unit ID</th>
                <th>Source</th>
                <th>Quality</th>
                <th>PTP Offset</th>
                <th>NTP Offset</th>
                <th>Last Seen</th>
            </tr>
    `;
    
    // Sort by last seen (most recent first)
    const sorted = Array.from(timeMetrics.entries()).sort((a, b) => b[1].last_seen - a[1].last_seen);
    
    for (const [unitId, data] of sorted) {
        const age = Date.now() - data.last_seen;
        const ageStr = age < 60000 ? `${Math.floor(age / 1000)}s ago` : `${Math.floor(age / 60000)}m ago`;
        
        const sourceClass = data.active_source === 'ptp' ? 'metric-good' : 
                          data.active_source === 'ntp' ? 'metric-warn' : 'metric-bad';
        const qualityClass = data.clock_quality === 'locked' ? 'metric-good' : 
                            data.clock_quality === 'tracking' ? 'metric-warn' : 'metric-bad';
        
        const ptpOffset = data.ptp_offset !== undefined ? formatMicroseconds(data.ptp_offset) : '--';
        const ntpOffset = data.ntp_offset !== undefined ? `${data.ntp_offset.toFixed(2)}ms` : '--';
        
        html += `
            <tr>
                <td>${unitId}</td>
                <td class="${sourceClass}">${data.active_source || 'unknown'}</td>
                <td class="${qualityClass}">${data.clock_quality || 'unknown'}</td>
                <td>${ptpOffset}</td>
                <td>${ntpOffset}</td>
                <td>${ageStr}</td>
            </tr>
        `;
    }
    
    html += '</table>';
    container.innerHTML = html;
    countEl.textContent = `${timeMetrics.size} node${timeMetrics.size !== 1 ? 's' : ''}`;
}

// Update local time status display
function updateLocalTimeStatus(data) {
    document.getElementById('local-clock-source').textContent = data.active_source || '--';
    document.getElementById('local-clock-quality').textContent = data.clock_quality || '--';
    document.getElementById('local-ptp-master').textContent = data.ptp_master || '--';
    document.getElementById('local-ptp-offset').textContent = data.ptp_offset_ns !== undefined ? 
        formatMicroseconds(data.ptp_offset_ns) : '--';
    document.getElementById('local-ntp-servers').textContent = data.ntp_servers ? 
        data.ntp_servers.join(', ') : '--';
    document.getElementById('local-ntp-offset').textContent = data.ntp_offset_ms !== undefined ? 
        `${data.ntp_offset_ms.toFixed(2)}ms` : '--';
}

// Clear Time Sync metrics
function clearTimeMetrics() {
    timeMetrics.clear();
    updateTimeTable();
}

// Measure our own RTT and publish metrics (like guardian does)
async function measureOwnRTTAndPublish() {
    if (!nc) return;
    
    uiSequence++;
    const now = Date.now();
    
    // Measure app-level RTT using echo pattern
    const echoSubject = `ops.echo.${unitId}`;
    const start = performance.now();
    let appRTT = 0;
    
    try {
        await nc.request(echoSubject, sc.encode('ping'), { timeout: 2000 });
        appRTT = performance.now() - start;
        updateRTTDisplay(appRTT);
    } catch (e) {
        // No echo responder for us or timeout
        updateRTTDisplay(null);
    }
    
    // Note: nats.ws doesn't expose native RTT measurement like nats.go
    // We approximate native RTT as 0 (or could use a separate ping)
    const nativeRTT = 0;
    
    // Build metrics payload (same format as guardian)
    const metrics = {
        ts: now,
        unit_id: unitId,
        seq: uiSequence,
        native_rtt_us: Math.round(nativeRTT * 1000), // Convert ms to µs
        app_rtt_us: Math.round(appRTT * 1000)
    };
    
    // Publish metrics
    try {
        await nc.publish(`ops.metric.rtt.${unitId}`, sc.encode(JSON.stringify(metrics)));
    } catch (e) {
        console.error('Failed to publish metrics:', e);
    }
    
    // Publish heartbeat (same as guardian)
    const heartbeatData = {
        status: 'healthy',
        sequence: uiSequence,
        ts: now
    };
    
    try {
        const headers = {
            'X-Unit-ID': unitId,
            'X-Sequence': String(uiSequence),
            'X-Native-RTT': `${nativeRTT}ms`,
            'X-App-RTT': `${appRTT.toFixed(3)}ms`,
            'X-Timestamp': String(now)
        };
        
        const h = nc.headers();
        for (const [k, v] of Object.entries(headers)) {
            h.append(k, v);
        }
        
        await nc.publish(`ops.heartbeat.${unitId}`, sc.encode(JSON.stringify(heartbeatData)), { headers: h });
    } catch (e) {
        console.error('Failed to publish heartbeat:', e);
    }
    
    // Also update our own display
    handleRTTMetric(metrics);
}

// Connect to NATS via WebSocket using nats.ws library
async function connectNATS() {
    try {
        addEvent(`Connecting to NATS at ${wsUrl}...`, 'info');
        
        const serverUrl = wsUrl;
        
        nc = await connect({
            servers: [serverUrl],
            timeout: 10000,
            reconnectTimeWait: 2000,
            maxReconnectAttempts: 10,
            user: 'admin',
            pass: 'changeit',
            name: unitId, // Unique identity for this client
        });
        
        console.log('NATS connected:', nc.getServer());
        addEvent('NATS WebSocket connected', 'connect');
        setStatus(true);
        
        // Subscribe to RTT metrics from all clients
        const rttSub = nc.subscribe('ops.metric.rtt.>');
        (async () => {
            for await (const msg of rttSub) {
                try {
                    const data = JSON.parse(sc.decode(msg.data));
                    handleRTTMetric(data);
                } catch (e) {
                    // Invalid JSON, ignore
                }
            }
        })();
        
        // Subscribe to Time Sync metrics from all clients
        const timeSub = nc.subscribe('ops.metric.time.>');
        (async () => {
            for await (const msg of timeSub) {
                try {
                    const data = JSON.parse(sc.decode(msg.data));
                    handleTimeMetric(data);
                } catch (e) {
                    // Invalid JSON, ignore
                }
            }
        })();
        
        // Subscribe to Time Config updates
        const timeConfigSub = nc.subscribe('ops.time.config');
        (async () => {
            for await (const msg of timeConfigSub) {
                try {
                    const data = JSON.parse(sc.decode(msg.data));
                    console.log('Time config received:', data);
                } catch (e) {
                    // Invalid JSON, ignore
                }
            }
        })();
        
        // Subscribe to heartbeats to show activity
        const hbSub = nc.subscribe('ops.heartbeat.>');
        (async () => {
            for await (const msg of hbSub) {
                // Heartbeat received, could update last-seen if we track heartbeats separately
            }
        })();
        
        // Subscribe to $SYS events
        const sub = nc.subscribe('$SYS.>');
        (async () => {
            for await (const msg of sub) {
                const data = sc.decode(msg.data);
                console.log('NATS message:', msg.subject, data);
                addEvent(`[${msg.subject}] ${data.substring(0, 100)}`, 'message');
                
                // Parse for connection activity
                handleSysEvent(msg.subject, data);
            }
        })();
        
        // Setup echo responder for ourselves (so other clients can measure RTT to us)
        const echoSub = nc.subscribe(`ops.echo.${unitId}`);
        (async () => {
            for await (const msg of echoSub) {
                // Echo back immediately
                if (msg.respond) {
                    msg.respond(msg.data);
                }
            }
        })();
        
        // Start periodic RTT measurement and heartbeat (like guardian)
        if (rttCheckInterval) clearInterval(rttCheckInterval);
        rttCheckInterval = setInterval(measureOwnRTTAndPublish, 5000);
        measureOwnRTTAndPublish(); // Measure immediately
        
        // Handle disconnect
        nc.closed().then(() => {
            console.log('NATS connection closed');
            addEvent('NATS disconnected', 'disconnect');
            setStatus(false);
            updateRTTDisplay(null);
            if (rttCheckInterval) {
                clearInterval(rttCheckInterval);
                rttCheckInterval = null;
            }
        });
        
    } catch (err) {
        console.error('NATS connection error:', err);
        addEvent(`NATS error: ${err.message}`, 'error');
        addEvent('Check that:', 'error');
        addEvent('  1. NATS server is running with WebSocket enabled', 'error');
        addEvent('  2. Cloudflare route wss.nunet.one -> localhost:8443 is active', 'error');
        addEvent('  3. Certificates are valid', 'error');
        setStatus(false);
        updateRTTDisplay(null);
    }
}

// Add event to display
function addEvent(data, type) {
    eventCount++;
    document.getElementById('eventCount').textContent = `${eventCount} events`;
    
    const eventsDiv = document.getElementById('events');
    const eventDiv = document.createElement('div');
    eventDiv.className = `event ${type}`;
    eventDiv.textContent = `[${new Date().toLocaleTimeString()}] ${data}`;
    
    eventsDiv.insertBefore(eventDiv, eventsDiv.firstChild);
    
    // Keep only last 100 events
    while (eventsDiv.children.length > 100) {
        eventsDiv.removeChild(eventsDiv.lastChild);
    }
}

function clearEvents() {
    eventCount = 0;
    document.getElementById('eventCount').textContent = '0 events';
    document.getElementById('events').innerHTML = '<div class="event">Events cleared</div>';
}

// Fetch routes/gateways
async function fetchRoutez() {
    try {
        const resp = await fetch(`${apiUrl}/routez`);
        const data = await resp.json();
        
        let html = `<p>Routes: ${data.num_routes || 0}</p>`;
        if (data.routes && data.routes.length > 0) {
            html += '<table><tr><th>Remote ID</th><th>IP</th><th>Port</th><th>Status</th></tr>';
            for (const route of data.routes) {
                html += `<tr>
                    <td>${route.remote_id || 'N/A'}</td>
                    <td>${route.ip || 'N/A'}</td>
                    <td>${route.port || 'N/A'}</td>
                    <td class="status ok">Connected</td>
                </tr>`;
            }
            html += '</table>';
        } else {
            html += '<p class="note">No routes configured. Clustering is disabled for single-node dev.</p>';
        }
        
        document.getElementById('routez').innerHTML = html;
    } catch (err) {
        document.getElementById('routez').innerHTML = `Error: ${err.message}`;
    }
}

// Fetch JetStream info
async function fetchJsz() {
    try {
        const resp = await fetch(`${apiUrl}/jsz`);
        const data = await resp.json();
        
        let html = '<table>';
        html += `<tr><td>Enabled</td><td>${data.disabled ? 'No' : 'Yes'}</td></tr>`;
        html += `<tr><td>Streams</td><td>${data.streams || 0}</td></tr>`;
        html += `<tr><td>Consumers</td><td>${data.consumers || 0}</td></tr>`;
        html += `<tr><td>Messages</td><td>${data.messages || 0}</td></tr>`;
        html += `<tr><td>Bytes</td><td>${formatBytes(data.bytes || 0)}</td></tr>`;
        html += `<tr><td>Memory Used</td><td>${formatBytes(data.memory || 0)}</td></tr>`;
        html += `<tr><td>Storage Used</td><td>${formatBytes(data.storage || 0)}</td></tr>`;
        html += '</table>';
        
        // Show account details if available
        if (data.account_details && data.account_details.length > 0) {
            html += '<h4>Account Details</h4>';
            html += '<table><tr><th>Account</th><th>Streams</th><th>Consumers</th><th>Memory</th></tr>';
            for (const acc of data.account_details) {
                html += `<tr>
                    <td>${acc.name}</td>
                    <td>${acc.streams || 0}</td>
                    <td>${acc.consumers || 0}</td>
                    <td>${formatBytes(acc.memory || 0)}</td>
                </tr>`;
            }
            html += '</table>';
        }
        
        document.getElementById('jsz').innerHTML = html;
    } catch (err) {
        document.getElementById('jsz').innerHTML = `Error: ${err.message}`;
    }
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Update account connection counts
function updateAccountStats(connections) {
    const counts = { 'SYS': 0, 'BRIDGE': 0, 'ENGINE': 0, 'PROVISION': 0 };
    
    for (const conn of connections || []) {
        const acc = conn.account || 'UNKNOWN';
        if (counts.hasOwnProperty(acc)) {
            counts[acc]++;
        }
    }
    
    document.getElementById('sys-conns').textContent = counts['SYS'];
    document.getElementById('bridge-conns').textContent = counts['BRIDGE'];
    document.getElementById('engine-conns').textContent = counts['ENGINE'];
    document.getElementById('provision-conns').textContent = counts['PROVISION'];
}

// Connection activity tracking
let activityCount = 0;

function addActivity(type, data) {
    activityCount++;
    document.getElementById('activityCount').textContent = `${activityCount} events`;
    
    const logDiv = document.getElementById('activityLog');
    const eventDiv = document.createElement('div');
    eventDiv.className = `event ${type}`;
    
    const time = new Date().toLocaleTimeString();
    let text = '';
    
    if (type === 'connect') {
        text = `[${time}] CONNECT: ${data.account || 'unknown'}/${data.cid || '?'} from ${data.ip || 'unknown'}`;
    } else if (type === 'disconnect') {
        text = `[${time}] DISCONNECT: ${data.account || 'unknown'}/${data.cid || '?'} - ${data.reason || 'unknown'}`;
    } else {
        text = `[${time}] ${type}: ${JSON.stringify(data).substring(0, 80)}`;
    }
    
    eventDiv.textContent = text;
    logDiv.insertBefore(eventDiv, logDiv.firstChild);
    
    // Keep only last 50 events
    while (logDiv.children.length > 50) {
        logDiv.removeChild(logDiv.lastChild);
    }
}

function clearActivity() {
    activityCount = 0;
    document.getElementById('activityCount').textContent = '0 events';
    document.getElementById('activityLog').innerHTML = '<div class="event">Activity cleared</div>';
}

// Parse $SYS events for connection activity
function handleSysEvent(subject, data) {
    try {
        const json = JSON.parse(data);
        
        // Handle CONNECT events
        if (subject.includes('.CONNECT')) {
            addActivity('connect', {
                account: json.acc || json.account,
                cid: json.cid,
                ip: json.ip || json.address,
                user: json.user
            });
        }
        // Handle DISCONNECT events
        else if (subject.includes('.DISCONNECT')) {
            addActivity('disconnect', {
                account: json.acc || json.account,
                cid: json.cid,
                reason: json.reason
            });
        }
        // Handle server stats
        else if (subject.includes('.STATSZ')) {
            // Update account stats if connection data available
            if (json.stats && json.stats.accounts) {
                for (const [acc, stats] of Object.entries(json.stats.accounts)) {
                    const el = document.getElementById(`${acc.toLowerCase()}-conns`);
                    if (el && stats.conns !== undefined) {
                        el.textContent = stats.conns;
                    }
                }
            }
        }
    } catch (e) {
        // Not JSON or other error, ignore
    }
}

// Auto-refresh every 5 seconds
setInterval(() => {
    fetchVarz();
    fetchConnz();
}, 5000);

// Initial load
window.addEventListener('DOMContentLoaded', () => {
    initConfig();
    fetchVarz();
    fetchConnz();
    fetchRoutez();
    fetchJsz();
    connectNATS();
});

// Export for global access
window.reconnect = reconnect;
window.fetchVarz = fetchVarz;
window.fetchConnz = fetchConnz;
window.fetchSubsz = fetchSubsz;
window.fetchRoutez = fetchRoutez;
window.fetchJsz = fetchJsz;
window.clearEvents = clearEvents;
window.clearActivity = clearActivity;
window.clearRTTMetrics = clearRTTMetrics;
window.clearTimeMetrics = clearTimeMetrics;
