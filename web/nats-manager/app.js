/**
 * nunect NATS Manager UI
 * 
 * Uses nats.ws library for proper WebSocket connectivity
 */

import { connect, StringCodec } from './node_modules/nats.ws/esm/nats.js';

// Configuration (injected by server from .env)
let apiUrl = window.NUNECT_CONFIG?.natsHttpUrl || 'https://localhost:4280/api';
let wsUrl = window.NUNECT_CONFIG?.natsWsUrl || 'wss://localhost:8443';
let nc = null;  // NATS connection
let sc = StringCodec();
let eventCount = 0;

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

// Connect to NATS via WebSocket using nats.ws library
async function connectNATS() {
    try {
        addEvent(`Connecting to NATS at ${wsUrl}...`, 'info');
        
        // Parse the WebSocket URL to get server address
        // wss://wss.nunet.one:8443 -> wss://wss.nunet.one:8443
        const serverUrl = wsUrl;
        
        nc = await connect({
            servers: [serverUrl],
            timeout: 10000,
            reconnectTimeWait: 2000,
            maxReconnectAttempts: 10,
            user: 'admin',
            pass: 'changeit',
        });
        
        console.log('NATS connected:', nc.getServer());
        addEvent('NATS WebSocket connected', 'connect');
        setStatus(true);
        
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
        
        // Handle disconnect
        nc.closed().then(() => {
            console.log('NATS connection closed');
            addEvent('NATS disconnected', 'disconnect');
            setStatus(false);
        });
        
    } catch (err) {
        console.error('NATS connection error:', err);
        addEvent(`NATS error: ${err.message}`, 'error');
        addEvent('Check that:', 'error');
        addEvent('  1. NATS server is running with WebSocket enabled', 'error');
        addEvent('  2. Cloudflare route wss.nunet.one -> localhost:8443 is active', 'error');
        addEvent('  3. Certificates are valid', 'error');
        setStatus(false);
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
