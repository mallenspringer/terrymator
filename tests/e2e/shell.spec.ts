import fs from 'node:fs';
import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';

test.describe('G0 Feasibility Shell E2E', () => {
  test('operates without external network requests and exports PNG sequence download', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (
        !url.startsWith('http://127.0.0.1:') &&
        !url.startsWith('http://localhost:') &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
      ) {
        externalRequests.push(url);
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await expect(page.getByTestId('stage-canvas')).toBeVisible();
    await expect(page.getByTestId('status-text')).toContainText('Rendered G0_DEMO frame 0');

    await page.getByTestId('fixture-select').selectOption('F09_EXPORT_CLOCK');
    await expect(page.getByTestId('status-text')).toContainText('Rendered F09_EXPORT_CLOCK frame 0');

    await page.getByTestId('step-frame-btn').click();
    await expect(page.getByTestId('status-text')).toContainText('Rendered F09_EXPORT_CLOCK frame 1');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-png-btn').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const zipBytes = fs.readFileSync(downloadPath!);
    const entries = unzipSync(new Uint8Array(zipBytes));
    expect(entries['manifest.json']).toBeDefined();
    expect(entries['frame_0000.png']).toBeDefined();
    expect(entries['frame_0011.png']).toBeDefined();

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
