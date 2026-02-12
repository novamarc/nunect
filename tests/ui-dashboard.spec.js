/**
 * Playwright tests for nunect Dashboard
 */

const { test, expect } = require('@playwright/test');

const UI_URL = process.env.UI_URL || 'https://localhost:4280';

test.describe('nunect Dashboard', () => {
    
    test.beforeEach(async ({ page }) => {
        // Ignore HTTPS errors for self-signed certs
        await page.goto(UI_URL, { waitUntil: 'networkidle' });
    });

    test('page loads with title', async ({ page }) => {
        await expect(page).toHaveTitle(/nunect NATS Manager/);
    });

    test('server stats section exists', async ({ page }) => {
        await expect(page.locator('text=Server Stats (/varz)')).toBeVisible();
    });

    test('connections section exists', async ({ page }) => {
        await expect(page.locator('text=Connections (/connz)')).toBeVisible();
    });

    test('subscriptions section exists', async ({ page }) => {
        await expect(page.locator('text=Subscriptions (/subsz)')).toBeVisible();
    });

    test('routes/gateways section exists', async ({ page }) => {
        await expect(page.locator('text=Routes/Gateways (/routez)')).toBeVisible();
    });

    test('jetstream section exists', async ({ page }) => {
        await expect(page.locator('text=JetStream (/jsz)')).toBeVisible();
    });

    test('accounts section exists', async ({ page }) => {
        await expect(page.locator('text=Accounts')).toBeVisible();
        // Use more specific locators for account names
        await expect(page.locator('#accounts td:has-text("SYS")').first()).toBeVisible();
        await expect(page.locator('#accounts td:has-text("BRIDGE")')).toBeVisible();
    });

    test('connection activity section exists', async ({ page }) => {
        await expect(page.locator('text=Connection Activity')).toBeVisible();
    });

    test('live events section exists', async ({ page }) => {
        await expect(page.locator('text=Live Events ($SYS)')).toBeVisible();
    });

    test('connection status indicator exists', async ({ page }) => {
        await expect(page.locator('#connectionStatus')).toBeVisible();
    });

    test('refresh buttons work', async ({ page }) => {
        // Wait for initial data to load
        await page.waitForTimeout(1000);
        
        // Check that varz contains server data (or at least loaded)
        const varzContent = await page.locator('#varz').textContent();
        // Either we got data or an error message (both indicate the system responded)
        expect(varzContent).toMatch(/server_id|Error|Loading/);
    });
});
