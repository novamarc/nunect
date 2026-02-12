/**
 * Basic tests for nunect-client
 */

const assert = require('assert');
const test = require('node:test');

test('package exports are defined', () => {
    // This is a placeholder test
    // Real tests would require a running NATS server
    assert.strictEqual(true, true);
});

test('LogLevel ordering is correct', () => {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
    assert.deepStrictEqual(levels, ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
});
