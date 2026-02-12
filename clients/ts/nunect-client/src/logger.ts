/**
 * nunect-client - Logger module
 * Publishes logs to ops.log.{level}.{unitID}
 */

import type { NunectClient } from './client.js';
import type { LogLevel, LogEntry } from './types.js';

export class NunectLogger {
    private client: NunectClient;
    private unitId: string;
    private component: string;
    private minLevel: LogLevel;
    private fields: Record<string, unknown> = {};

    private levelOrder: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

    constructor(
        client: NunectClient,
        unitId: string,
        component: string,
        minLevel: LogLevel = 'INFO'
    ) {
        this.client = client;
        this.unitId = unitId;
        this.component = component;
        this.minLevel = minLevel;
    }

    /** Add persistent field to all logs */
    withField(key: string, value: unknown): NunectLogger {
        const newLogger = new NunectLogger(
            this.client,
            this.unitId,
            this.component,
            this.minLevel
        );
        newLogger.fields = { ...this.fields, [key]: value };
        return newLogger;
    }

    /** Add multiple persistent fields */
    withFields(fields: Record<string, unknown>): NunectLogger {
        const newLogger = new NunectLogger(
            this.client,
            this.unitId,
            this.component,
            this.minLevel
        );
        newLogger.fields = { ...this.fields, ...fields };
        return newLogger;
    }

    private shouldLog(level: LogLevel): boolean {
        return this.levelOrder.indexOf(level) >= this.levelOrder.indexOf(this.minLevel);
    }

    private async log(level: LogLevel, message: string, extraFields?: Record<string, unknown>): Promise<void> {
        if (!this.shouldLog(level)) {
            return;
        }

        if (!this.client.isConnected()) {
            // Fall back to console if not connected
            console.log(`[${level}] ${this.unitId}/${this.component}: ${message}`);
            return;
        }

        const entry: LogEntry = {
            ts: new Date().toISOString(),
            lvl: level,
            unit: this.unitId,
            comp: this.component,
            msg: message,
            fields: { ...this.fields, ...extraFields }
        };

        const subject = `ops.log.${level}.${this.unitId}`;
        
        try {
            await this.client.publish(subject, JSON.stringify(entry), {
                'X-Unit-ID': this.unitId,
                'X-Log-Level': level,
                'X-Component': this.component
            });
        } catch (err) {
            console.error('Failed to publish log:', err);
        }
    }

    /** Log DEBUG message */
    debug(message: string, fields?: Record<string, unknown>): void {
        this.log('DEBUG', message, fields);
    }

    /** Log INFO message */
    info(message: string, fields?: Record<string, unknown>): void {
        this.log('INFO', message, fields);
    }

    /** Log WARN message */
    warn(message: string, fields?: Record<string, unknown>): void {
        this.log('WARN', message, fields);
    }

    /** Log ERROR message */
    error(message: string, fields?: Record<string, unknown>): void {
        this.log('ERROR', message, fields);
    }

    /** Log FATAL message */
    fatal(message: string, fields?: Record<string, unknown>): void {
        this.log('FATAL', message, fields);
    }
}
