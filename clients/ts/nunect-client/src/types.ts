/**
 * nunect-client type definitions
 */

export interface NunectConfig {
    /** WebSocket URL (wss://host:port) */
    url: string;
    /** Username for authentication */
    user?: string;
    /** Password for authentication */
    pass?: string;
    /** JWT for authentication (alternative to user/pass) */
    jwt?: string;
    /** Unit/Client ID for logging */
    unitId: string;
    /** Reconnection wait time in ms */
    reconnectWait?: number;
    /** Maximum reconnection attempts */
    maxReconnects?: number;
    /** Connection timeout in ms */
    timeout?: number;
}

export interface NunectHeaders {
    [key: string]: string;
}

export interface NunectMessage {
    /** Message subject */
    subject: string;
    /** Message headers */
    headers: NunectHeaders;
    /** Message payload */
    data: Uint8Array;
    /** Reply subject (for request-reply) */
    reply?: string;
}

export type MessageHandler = (msg: NunectMessage) => void | Promise<void>;

export interface Subscription {
    /** Subscription subject */
    subject: string;
    /** Unsubscribe from subject */
    unsubscribe(): void;
    /** Check if subscription is active */
    isActive(): boolean;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogEntry {
    ts: string;
    lvl: LogLevel;
    unit: string;
    comp: string;
    msg: string;
    fields?: Record<string, unknown>;
    trace?: string;
}
