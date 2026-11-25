import fs from 'node:fs';
import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { createSolidSquare } from '../../src/assets/synthetic';

test.describe('G5 Full Authoring-to-Export E2E (2 passes)', () => {
  test('Pass 1: creates shot with FX + keys + PNG sequence export + .collage save; Pass 2: New Shot + Reopen + GIF export', async ({
    page,
  }, testInfo) => {
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
    const discardBtn = page.getByTestId('discard-recovery-btn');
    if (await discardBtn.isVisible().catch(() => false)) {
      await discardBtn.click();
    }

    // --- PASS 1 ---
    const sq = createSolidSquare(64, 64, [240, 200, 80, 255]);
    const pngPath = testInfo.outputPath('hero.png');
    fs.writeFileSync(pngPath, Buffer.from(encodePngRgba(sq.rgba, 64, 64)));
    await page.getByTestId('import-image-input').setInputFiles(pngPath);
    await page.getByTestId('add-to-stage-btn').click();

    // Enable Drop Shadow + Color Adjust on the node
    await page.getByTestId('fx-shadow-enabled').check();
    await page.getByTestId('fx-color-enabled').check();
    await page.getByTestId('fx-color-tint-amount').fill('0.5');
    await page.getByTestId('global-shadow-angle-input').fill('120');

    // Keyframe at frame 0, step to frame 2 with Auto-Key ON, move X
    await page.getByTestId('capture-pose-btn').click();
    await page.getByTestId('autokey-toggle').check();
    await page.getByTestId('timeline-step-fwd').click();
    await page.getByTestId('timeline-step-fwd').click();
    await page.getByTestId('inspector-x-input').fill('520');

    // Set work range [0, 5] (5 frames @ 24fps)
    await page.getByTestId('timeline-range-in').fill('0');
    await page.getByTestId('timeline-range-out').fill('5');

    // Open Export Modal -> PNG Sequence ZIP
    await page.getByTestId('open-export-btn').click();
    await expect(page.getByTestId('export-modal')).toBeVisible();
    await page.getByTestId('export-format-select').selectOption('png-sequence');
    await page.getByTestId('export-range-select').selectOption('work-range');

    const [pngZipDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-start-btn').click(),
    ]);
    const pngZipPath = testInfo.outputPath('shot-frames.zip');
    await pngZipDownload.saveAs(pngZipPath);
    const zipEntries = unzipSync(new Uint8Array(fs.readFileSync(pngZipPath)));
    const pngFiles = Object.keys(zipEntries).filter((k) => k.endsWith('.png'));
    expect(pngFiles.length).toBe(5);
    await expect(page.getByTestId('export-status')).toContainText('Exported');
    await page.getByTestId('export-close-btn').click();

    // Save .collage archive
    const [saveDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('save-archive-btn').click(),
    ]);
    const savedArchivePath = testInfo.outputPath('g5-roundtrip.collage');
    await saveDownload.saveAs(savedArchivePath);
    expect(fs.statSync(savedArchivePath).size).toBeGreaterThan(200);

    // --- PASS 2: New Shot -> Reopen .collage -> verify FX & keys -> Export GIF ---
    await page.getByTestId('new-shot-btn').click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 0');

    await page.getByTestId('open-archive-input').setInputFiles(savedArchivePath);
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 1');

    // Select the first layer by clicking its name label and verify effects & global shadow angle restored
    await page.locator('[data-testid^="layer-row-"] span').first().click();
    await expect(page.getByTestId('fx-shadow-enabled')).toBeChecked();
    await expect(page.getByTestId('fx-color-enabled')).toBeChecked();
    await expect(page.getByTestId('global-shadow-angle-input')).toHaveValue('120');

    // Export Work Range as Animated GIF
    await page.getByTestId('open-export-btn').click();
    await page.getByTestId('export-format-select').selectOption('gif');
    await page.getByTestId('export-res-select').selectOption('540p');

    const [gifDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-start-btn').click(),
    ]);
    const gifPath = testInfo.outputPath('shot.gif');
    await gifDownload.saveAs(gifPath);
    const gifBytes = fs.readFileSync(gifPath);
    expect(gifBytes.slice(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
