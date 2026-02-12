#!/usr/bin/env python3
"""
nunect NATS Manager UI - HTTPS Development Server
Serves static files with SSL and proxies NATS API requests
Uses system-managed TLS certificates (no self-signed generation)
"""

import http.server
import socketserver
import ssl
import os
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

# Load configuration from environment
PORT = int(os.environ.get('NATS_MANAGER_PORT', 4280))
BIND = os.environ.get('NATS_MANAGER_BIND', '0.0.0.0')
DOMAIN = os.environ.get('NATS_MANAGER_DOMAIN', 'localhost')
CORS_ORIGINS = os.environ.get('NATS_MANAGER_CORS_ORIGINS', '*')

# NATS configuration
NATS_PORT = os.environ.get('NATS_PORT', '4222')
NATS_HTTPS_PORT = os.environ.get('NATS_HTTPS_PORT', '8444')

# TLS certificates (system-managed)
NATS_TLS_CERT = os.environ.get('NATS_TLS_CERT', '')
NATS_TLS_KEY = os.environ.get('NATS_TLS_KEY', '')

# Parse allowed origins
if CORS_ORIGINS == '*':
    ALLOWED_ORIGINS = ['*']
else:
    ALLOWED_ORIGINS = [o.strip() for o in CORS_ORIGINS.split(',')]

DIRECTORY = Path(__file__).parent
NATS_API_URL = f"https://localhost:{NATS_HTTPS_PORT}"


def get_nats_urls(host, is_cloudflare=False):
    """Generate NATS URLs for the client"""
    nats_ws_domain = os.environ.get('NATS_WS_DOMAIN', host)
    
    if host == 'localhost' or host == '127.0.0.1':
        http_url = f"http://localhost:{PORT}/api"
        ws_url = f"wss://localhost:8443"
    else:
        # When behind Cloudflare, use relative URL for API (no port)
        # Cloudflare proxies port 443 to localhost:4280
        if is_cloudflare:
            http_url = "/api"  # Relative URL - browser will use same host:port
        else:
            http_url = f"https://{host}:{PORT}/api"
        # WebSocket uses separate subdomain via Cloudflare (port 443)
        ws_url = f"wss://{nats_ws_domain}"
    
    return {'http_url': http_url, 'ws_url': ws_url}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)
    
    def do_GET(self):
        path = self.path.split('?')[0]
        
        if path.startswith('/api/'):
            self.proxy_nats_api(path[4:])
            return
        
        host = self.headers.get('Host', '').split(':')[0]
        
        if path == '/' or path == '/index.html':
            self.serve_index(host)
            return
        
        if DOMAIN != 'localhost' and host not in [DOMAIN, 'localhost', '127.0.0.1', BIND, '']:
            self.send_error(404, "Not Found")
            return
        
        return super().do_GET()
    
    def proxy_nats_api(self, nats_path):
        """Proxy request to NATS HTTPS API"""
        try:
            nats_url = f"{NATS_API_URL}/{nats_path}"
            if self.query_string:
                nats_url += f"?{self.query_string}"
            
            req = urllib.request.Request(
                nats_url,
                headers={'Accept': self.headers.get('Accept', 'application/json')}
            )
            
            # Create SSL context that verifies against system certs
            import ssl
            ssl_context = ssl.create_default_context()
            if NATS_TLS_CERT and Path(NATS_TLS_CERT).exists():
                ssl_context.load_verify_locations(NATS_TLS_CERT)
            
            with urllib.request.urlopen(req, timeout=10, context=ssl_context) as response:
                self.send_response(response.status)
                self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                self.add_cors_headers()
                self.end_headers()
                self.wfile.write(response.read())
                
        except urllib.error.HTTPError as e:
            self.send_error(e.code, e.reason)
        except Exception as e:
            self.send_error(502, f"Proxy error: {str(e)}")
    
    @property
    def query_string(self):
        if '?' in self.path:
            return self.path.split('?', 1)[1]
        return ''
    
    def serve_index(self, host):
        """Serve index.html with configuration injected"""
        index_path = DIRECTORY / 'index.html'
        
        if not index_path.exists():
            self.send_error(404, "index.html not found")
            return
        
        content = index_path.read_text()
        
        # Detect if behind Cloudflare (CF-RAY header present)
        is_cloudflare = self.headers.get('CF-RAY') is not None
        if is_cloudflare:
            print(f"Cloudflare detected for host: {host}")
        
        urls = get_nats_urls(host, is_cloudflare)
        
        content = content.replace('"{{NATS_HTTP_URL}}"', f'"{urls["http_url"]}"')
        content = content.replace('"{{NATS_WS_URL}}"', f'"{urls["ws_url"]}"')
        content = content.replace('"{{NATS_MANAGER_DOMAIN}}"', f'"{DOMAIN}"')
        content = content.replace('value="{{NATS_HTTP_URL}}"', f'value="{urls["http_url"]}"')
        content = content.replace('value="{{NATS_WS_URL}}"', f'value="{urls["ws_url"]}"')
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.add_cors_headers()
        self.end_headers()
        self.wfile.write(content.encode())
    
    def add_cors_headers(self):
        origin = self.headers.get('Origin', '')
        # Debug: print what we received
        # print(f"CORS: Origin={origin}, Allowed={ALLOWED_ORIGINS}")
        
        if '*' in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', '*')
        elif origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        elif any(o.endswith('.nunet.one') for o in ALLOWED_ORIGINS):
            # Allow any subdomain of nunet.one
            if origin.endswith('.nunet.one'):
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
        
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    
    def end_headers(self):
        self.add_cors_headers()
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()


def create_ssl_context():
    """Create SSL context from system-managed certificates"""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    
    if NATS_TLS_CERT and NATS_TLS_KEY and Path(NATS_TLS_CERT).exists() and Path(NATS_TLS_KEY).exists():
        context.load_cert_chain(NATS_TLS_CERT, NATS_TLS_KEY)
        return context
    else:
        print("ERROR: TLS certificates not found.")
        print(f"  Cert: {NATS_TLS_CERT or 'not set'}")
        print(f"  Key:  {NATS_TLS_KEY or 'not set'}")
        print("")
        print("Set paths in .env to your system-managed certificates:")
        print("  NATS_TLS_CERT=/etc/ssl/certs/your-cert.pem")
        print("  NATS_TLS_KEY=/etc/ssl/private/your-key.key")
        sys.exit(1)


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    
    ssl_context = create_ssl_context()
    
    print(f"Starting nunect NATS Manager UI...")
    print(f"  Bind:      {BIND}:{PORT}")
    print(f"  Domain:    {DOMAIN}")
    print(f"  Protocol:  HTTPS")
    print(f"  Cert:      {NATS_TLS_CERT}")
    print(f"  Directory: {DIRECTORY}")
    print(f"  NATS API:  {NATS_API_URL}")
    print(f"")
    print(f"  Local:     https://localhost:{PORT}")
    if DOMAIN != 'localhost':
        print(f"  Domain:    https://{DOMAIN}:{PORT}")
    print("")
    
    with socketserver.TCPServer((BIND, PORT), Handler) as httpd:
        httpd.socket = ssl_context.wrap_socket(httpd.socket, server_side=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
