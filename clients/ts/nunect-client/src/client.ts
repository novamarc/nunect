/**
 * nunect-client - Core NATS client
 */

import { connect, StringCodec, type NatsConnection, type Subscription as NatsSubscription } from 'nats.ws';
import type { 
    NunectConfig, 
    NunectMessage, 
    NunectHeaders, 
    MessageHandler, 
    Subscription,
    ConnectionState 
} from './types.js';

const sc = StringCodec();

export class NunectClient {
    private config: NunectConfig;
    private nc: NatsConnection | null = null;
    private state: ConnectionState = 'disconnected';
    private stateChangeHandlers: ((state: ConnectionState) => void)[] = [];
    private subscriptions: Map<string, NatsSubscription> = new Map();

    constructor(config: NunectConfig) {
        this.config = {
            reconnectWait: 2000,
            maxReconnects: 10,
            timeout: 10000,
            ...config
        };
    }

    /** Get current connection state */
    getState(): ConnectionState {
        return this.state;
    }

    /** Register a state change handler */
    onStateChange(handler: (state: ConnectionState) => void): void {
        this.stateChangeHandlers.push(handler);
    }

    private setState(state: ConnectionState): void {
        this.state = state;
        for (const handler of this.stateChangeHandlers) {
            handler(state);
        }
    }

    /** Connect to NATS server */
    async connect(): Promise<void> {
        if (this.nc) {
            throw new Error('Already connected');
        }

        this.setState('connecting');

        try {
            const connectOpts: Record<string, unknown> = {
                servers: [this.config.url],
                timeout: this.config.timeout,
                reconnectTimeWait: this.config.reconnectWait,
                maxReconnectAttempts: this.config.maxReconnects,
            };

            if (this.config.user && this.config.pass) {
                connectOpts.user = this.config.user;
                connectOpts.pass = this.config.pass;
            }

            this.nc = await connect(connectOpts);
            this.setState('connected');

            // Handle disconnect
            this.nc.closed().then(() => {
                this.nc = null;
                this.subscriptions.clear();
                this.setState('disconnected');
            });
        } catch (err) {
            this.setState('disconnected');
            throw err;
        }
    }

    /** Disconnect from NATS server */
    async disconnect(): Promise<void> {
        if (this.nc) {
            await this.nc.close();
            this.nc = null;
        }
    }

    /** Check if connected */
    isConnected(): boolean {
        return this.state === 'connected' && this.nc !== null;
    }

    /** Publish a message to a subject */
    async publish(subject: string, data: string | Uint8Array, headers?: NunectHeaders): Promise<void> {
        if (!this.nc) {
            throw new Error('Not connected');
        }

        const payload = typeof data === 'string' ? sc.encode(data) : data;
        
        if (headers && Object.keys(headers).length > 0) {
            const h = this.nc.headers();
            for (const [key, value] of Object.entries(headers)) {
                h.append(key, value);
            }
            await this.nc.publish(subject, payload, { headers: h });
        } else {
            await this.nc.publish(subject, payload);
        }
    }

    /** Subscribe to a subject (supports wildcards) */
    subscribe(subject: string, handler: MessageHandler): Subscription {
        if (!this.nc) {
            throw new Error('Not connected');
        }

        const sub = this.nc.subscribe(subject);
        const subId = `${subject}_${Date.now()}`;
        this.subscriptions.set(subId, sub);

        // Process messages
        (async () => {
            for await (const msg of sub) {
                const nunectMsg: NunectMessage = {
                    subject: msg.subject,
                    headers: {},
                    data: msg.data,
                    reply: msg.reply
                };

                // Extract headers if present
                if (msg.headers) {
                    for (const [key, values] of msg.headers) {
                        nunectMsg.headers[key] = values[0] || '';
                    }
                }

                try {
                    await handler(nunectMsg);
                } catch (err) {
                    console.error('Message handler error:', err);
                }
            }
        })();

        return {
            subject,
            unsubscribe: () => {
                sub.unsubscribe();
                this.subscriptions.delete(subId);
            },
            isActive: () => !sub.isClosed()
        };
    }

    /** Request-reply pattern */
    async request(subject: string, data: string | Uint8Array, timeout = 5000): Promise<NunectMessage> {
        if (!this.nc) {
            throw new Error('Not connected');
        }

        const payload = typeof data === 'string' ? sc.encode(data) : data;
        const resp = await this.nc.request(subject, payload, { timeout });

        const nunectMsg: NunectMessage = {
            subject: resp.subject,
            headers: {},
            data: resp.data
        };

        if (resp.headers) {
            for (const [key, values] of resp.headers) {
                nunectMsg.headers[key] = values[0] || '';
            }
        }

        return nunectMsg;
    }
}
