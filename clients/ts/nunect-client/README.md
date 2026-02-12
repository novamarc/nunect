# @nunect/nunect-client

TypeScript client library for nunect - the novamarc NATS Data Backend.

## Features

- 🔌 WebSocket connection to NATS (via nats.ws)
- 🔐 Username/password authentication
- 📨 Publish with headers
- 📡 Subscribe with wildcards
- 🔄 Request-reply pattern
- 🔁 Automatic reconnection
- 📝 Structured logging to `ops.log.{level}.{unitID}`

## Installation

```bash
npm install @nunect/nunect-client
```

## Quick Start

```typescript
import { NunectClient, NunectLogger } from '@nunect/nunect-client';

// Create client
const client = new NunectClient({
    url: 'wss://wss.nunet.one',
    user: 'client',
    pass: 'secret',
    unitId: 'my-device-01',
    reconnectWait: 2000,
    maxReconnects: 10
});

// Connect
await client.connect();

// Create logger
const logger = new NunectLogger(client, 'my-device-01', 'main', 'INFO');
logger.info('Connected to nunect');

// Subscribe to subjects
const sub = client.subscribe('com.bridge.>', (msg) => {
    console.log(`Received on ${msg.subject}:`, msg.data);
});

// Publish with headers
await client.publish('com.bridge.mydevice.data', 'Hello!', {
    'X-Protocol-Origin': 'WEB',
    'X-Tenant': 'bridge'
});

// Request-reply
const response = await client.request('ops.status.request', '{"ping": true}', 5000);
console.log('Response:', response.data);

// Cleanup
sub.unsubscribe();
await client.disconnect();
```

## API Reference

### NunectClient

#### Constructor
```typescript
new NunectClient(config: NunectConfig)
```

#### Methods

- `connect(): Promise<void>` - Connect to NATS server
- `disconnect(): Promise<void>` - Disconnect from server
- `isConnected(): boolean` - Check connection status
- `publish(subject, data, headers?): Promise<void>` - Publish message
- `subscribe(subject, handler): Subscription` - Subscribe to subject
- `request(subject, data, timeout?): Promise<NunectMessage>` - Request-reply
- `onStateChange(handler)` - Register state change callback

### NunectLogger

#### Constructor
```typescript
new NunectLogger(client, unitId, component, minLevel)
```

#### Methods

- `debug(message, fields?)` - Log DEBUG message
- `info(message, fields?)` - Log INFO message
- `warn(message, fields?)` - Log WARN message
- `error(message, fields?)` - Log ERROR message
- `fatal(message, fields?)` - Log FATAL message
- `withField(key, value)` - Add persistent field
- `withFields(fields)` - Add multiple persistent fields

## Subject Patterns

```typescript
// All voice in a tenant
client.subscribe('com.bridge.*.*.*.voice', handler);

// All heartbeats
client.subscribe('ops.heartbeat.*', handler);

// All logs
client.subscribe('ops.log.>', handler);

// Specific channel across all sources
client.subscribe('com.bridge.vhf.*.ch16.voice', handler);
```

## License

MIT
