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

// Manual connect (when user changes inputs)
function connect() {
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
    connectNATS();
});

// Export for global access
window.connect = connect;
window.fetchVarz = fetchVarz;
window.fetchConnz = fetchConnz;
window.fetchSubsz = fetchSubsz;
window.clearEvents = clearEvents;
