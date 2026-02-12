/**
 * nunect-client - TypeScript client for nunect NATS Data Backend
 * 
 * @example
 * ```typescript
 * import { NunectClient, NunectLogger } from '@nunect/nunect-client';
 * 
 * const client = new NunectClient({
 *     url: 'wss://wss.nunet.one',
 *     user: 'client',
 *     pass: 'secret',
 *     unitId: 'my-device-01'
 * });
 * 
 * await client.connect();
 * 
 * const logger = new NunectLogger(client, 'my-device-01', 'main', 'INFO');
 * logger.info('Application started');
 * 
 * const sub = client.subscribe('com.bridge.>', (msg) => {
 *     console.log('Received:', msg.subject, msg.data);
 * });
 * ```
 */

export { NunectClient } from './client.js';
export { NunectLogger } from './logger.js';
export type {
    NunectConfig,
    NunectHeaders,
    NunectMessage,
    MessageHandler,
    Subscription,
    ConnectionState,
    LogLevel,
    LogEntry
} from './types.js';
