import fs from 'node:fs';
import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { createSolidSquare } from '../../src/assets/synthetic';

test.describe('G1 Editor Shell E2E', () => {
  test('imports PNG, edits metadata, duplicates, drags, undoes/redoes, saves/reopens .collage, refuses corrupt file, and recovers via IndexedDB', async ({
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
    await expect(page.getByTestId('stage-canvas')).toBeVisible();

    // Discard any leftover recovery from prior tests
    const discardBtn = page.getByTestId('discard-recovery-btn');
    if (await discardBtn.isVisible().catch(() => false)) {
      await discardBtn.click();
    }

    // 1. Import a local transparent-edge PNG
    const sq = createSolidSquare(120, 120, [240, 100, 60, 255]);
    const pngBytes = Buffer.from(encodePngRgba(sq.rgba, 120, 120));
    const pngPath = testInfo.outputPath('cutout-piece.png');
    fs.writeFileSync(pngPath, pngBytes);

    await page.getByTestId('import-image-input').setInputFiles(pngPath);
    await expect(page.getByTestId('add-to-stage-btn')).toBeVisible();

    // 2. Edit source attribution & URL (IO-05)
    await page.getByTestId('source-attribution-input').fill('Archive Scan #42');
    await page.getByTestId('source-url-input').fill('https://local.note/scan42');

    // 3. Add to stage, duplicate, make unique
    await page.getByTestId('add-to-stage-btn').click();
    await expect(page.getByTestId('inspector-panel')).toBeVisible();
    await page.getByTestId('duplicate-node-btn').click();
    await page.getByTestId('make-unique-btn').click();

    // 4. Drag on stage canvas -> verify X changes and Undo reverts in one step
    const stageBox = await page.getByTestId('stage-canvas').boundingBox();
    expect(stageBox).not.toBeNull();
    const xBeforeDrag = await page.getByTestId('inspector-x-input').inputValue();
    const cx = stageBox!.x + stageBox!.width / 2 + 12;
    const cy = stageBox!.y + stageBox!.height / 2 + 12;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 20, { steps: 5 });
    await page.mouse.up();
    const xAfterDrag = await page.getByTestId('inspector-x-input').inputValue();
    expect(xAfterDrag).not.toBe(xBeforeDrag);

    await page.getByTestId('undo-btn').click();
    await expect(page.getByTestId('inspector-x-input')).toHaveValue(xBeforeDrag);
    await page.getByTestId('redo-btn').click();
    await expect(page.getByTestId('inspector-x-input')).toHaveValue(xAfterDrag);

    // 5. Save .collage archive
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('save-archive-btn').click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath('saved-shot.collage');
    await download.saveAs(savedPath);

    const zipEntries = unzipSync(new Uint8Array(fs.readFileSync(savedPath)));
    expect(zipEntries['manifest.json']).toBeDefined();
    expect(zipEntries['project.json']).toBeDefined();
    await expect(page.getByTestId('dirty-indicator')).toHaveText('Saved');

    // 6. Malformed archive upload does not destroy current work (IO-04)
    const badPath = testInfo.outputPath('corrupt.collage');
    fs.writeFileSync(badPath, Buffer.from('not-a-zip-archive'));
    await page.getByTestId('open-archive-input').setInputFiles(badPath);
    await expect(page.getByTestId('error-banner')).toBeVisible();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 2');

    // 7. New Shot -> Reopen saved .collage -> verify nodes & attribution restored
    await page.getByTestId('new-shot-btn').click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 0');
    await page.getByTestId('open-archive-input').setInputFiles(savedPath);
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 2');
    await expect(page.getByTestId('source-attribution-input')).toHaveValue('Archive Scan #42');

    // 8. Make unsaved edit, wait for autosave, reload, and verify Recover / Discard (IO-02)
    await page.getByTestId('add-group-btn').click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 3');
    await page.waitForTimeout(450);

    await page.reload();
    await expect(page.getByTestId('recovery-banner')).toBeVisible();
    await page.getByTestId('recover-btn').click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 3');

    // Reload again -> discard recovery
    await page.getByTestId('add-group-btn').click();
    await page.waitForTimeout(450);
    await page.reload();
    await expect(page.getByTestId('recovery-banner')).toBeVisible();
    await page.getByTestId('discard-recovery-btn').click();
    await expect(page.getByTestId('recovery-banner')).toBeHidden();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 0');

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
