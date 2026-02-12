/**
 * nunect NATS Manager UI
 * 
 * Fetches from NATS HTTP Monitoring API (read-only)
 * Connects via WebSocket for live $SYS events
 */

// Configuration (injected by server from .env)
let apiUrl = window.NUNECT_CONFIG?.natsHttpUrl || 'http://localhost:8223';
let wsUrl = window.NUNECT_CONFIG?.natsWsUrl || 'ws://localhost:4223';
let ws = null;
let eventCount = 0;

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

// Manual connect (when user changes inputs)
function connect() {
    apiUrl = document.getElementById('apiUrl').value;
    wsUrl = document.getElementById('wsUrl').value;
    
    // Test HTTP connection
    fetchVarz();
    
    // Connect WebSocket
    connectWebSocket();
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

// WebSocket connection for $SYS events
function connectWebSocket() {
    if (ws) {
        ws.close();
    }
    
    // Note: This is a raw WebSocket to NATS
    // In production, you'd use the NATS JavaScript client library
    // For now, we show the concept - real impl needs NATS WS gateway or nats.ws library
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
            addEvent('WebSocket connected', 'info');
            
            // Send CONNECT protocol message
            // This is simplified - real NATS protocol is more complex
            const connectMsg = {
                verbose: false,
                pedantic: false,
                user: 'admin',
                pass: 'changeit'
            };
            ws.send(`CONNECT ${JSON.stringify(connectMsg)}`);
            
            // Subscribe to $SYS events
            setTimeout(() => {
                ws.send('SUB $SYS.> 1');
            }, 100);
        };
        
        ws.onmessage = (event) => {
            console.log('WS message:', event.data);
            addEvent(event.data, 'message');
        };
        
        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            addEvent('WebSocket error - check console', 'error');
            setStatus(false);
        };
        
        ws.onclose = () => {
            console.log('WebSocket closed');
            addEvent('WebSocket disconnected', 'info');
            setStatus(false);
        };
    } catch (err) {
        addEvent(`WebSocket failed: ${err.message}`, 'error');
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
    connect();
});

// Export for global access
window.connect = connect;
window.fetchVarz = fetchVarz;
window.fetchConnz = fetchConnz;
window.fetchSubsz = fetchSubsz;
window.clearEvents = clearEvents;
