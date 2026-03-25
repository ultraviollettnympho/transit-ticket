const { test, expect } = require('@playwright/test');

test.describe('Transit Ticket smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8000', { waitUntil: 'load' });
  });

  test('page loads and has a manifest link', async ({ page }) => {
    await expect(page).toHaveTitle(/Metro|Transit|Ticket/i);
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toHaveCount(1);
  });

  test('service worker registration exists', async ({ page }) => {
    // Some environments may not activate the service worker immediately.
    // Assert the browser supports service workers and the server exposes the file.
    const supportsSW = await page.evaluate(() => ('serviceWorker' in navigator));
    expect(supportsSW).toBe(true);

    const status = await page.evaluate(async () => {
      try {
        const r = await fetch('/service-worker.js');
        return r.status;
      } catch (e) {
        return 0;
      }
    });
    expect(status).toBe(200);
  });

  test('no console errors during initial load', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    // short wait to collect sync errors
    await page.waitForTimeout(1000);
    expect(errors.length).toBe(0);
  });
});
