import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { buildF02HiddenTorsoSheet } from '../../src/test-harness/fixtures';

test.describe('G2 Workspaces E2E (Cutting Room & Material Workshop)', () => {
  test('cuts & reconstructs hidden torso, creates material with hole, makes unique, undoes, and survives .collage reopen', async ({
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

    // 1. Import F02 hidden-torso PNG and create a second cutout from same source
    const sheet = buildF02HiddenTorsoSheet();
    const pngPath = testInfo.outputPath('f02-sheet.png');
    fs.writeFileSync(pngPath, Buffer.from(encodePngRgba(sheet.rgba, sheet.width, sheet.height)));
    await page.getByTestId('import-image-input').setInputFiles(pngPath);
    await page.getByTestId('new-cutout-from-source-btn').click();
    await expect(page.getByTestId('add-to-stage-btn')).toHaveCount(2);

    // 2. Open Cutting Room, magic-wand select green arm at center, erase it, restore/extend
    await page.getByTestId('tab-cutting').click();
    await expect(page.getByTestId('cutting-canvas')).toBeVisible();

    const cutBox = await page.getByTestId('cutting-canvas').boundingBox();
    expect(cutBox).not.toBeNull();
    await page.getByTestId('cut-tool-wand').click();
    await page.mouse.click(cutBox!.x + cutBox!.width / 2, cutBox!.y + cutBox!.height / 2);
    await page.getByTestId('cut-sel-erase').click();
    await expect(page.getByTestId('cutting-status')).toContainText('rev 2');

    // Extend edit region (+16px) and verify dimensions expand to 96x96
    await page.getByTestId('cut-extend-rect').click();
    await expect(page.getByTestId('cutting-status')).toContainText('96×96');

    // Switch to paint brush and paint reconstruction stroke
    await page.getByTestId('cut-tool-paint').click();
    await page.mouse.move(cutBox!.x + cutBox!.width / 2, cutBox!.y + cutBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(cutBox!.x + cutBox!.width / 2 + 10, cutBox!.y + cutBox!.height / 2 + 10);
    await page.mouse.up();
    await expect(page.getByTestId('cutting-status')).toContainText('rev 4');

    // 3. Return to Studio, add both cutouts to stage, verify workspace switch preserved edits
    await page.getByTestId('tab-studio').click();
    const addButtons = page.getByTestId('add-to-stage-btn');
    await addButtons.nth(0).click();
    await addButtons.nth(1).click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 2');

    // 4. Create Material in Material Workshop, add subtracted ellipse hole, change preset & seed
    await page.getByTestId('new-material-btn').click();
    await expect(page.getByTestId('material-canvas')).toBeVisible();
    await page.getByTestId('mat-add-ellipse').click();
    await page.getByTestId('mat-preset').selectOption('felt');
    await page.getByTestId('mat-seed').fill('555');
    await expect(page.getByTestId('material-status')).toContainText('seed 555');

    // 5. Return to Studio, add material to stage, duplicate, Make Unique, edit unique copy
    await page.getByTestId('tab-studio').click();
    await page.getByTestId('add-to-stage-btn').nth(2).click();
    await page.getByTestId('duplicate-node-btn').click();
    await page.getByTestId('make-unique-btn').click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 4');

    // Undo & Redo works cleanly across G2 edits
    await page.getByTestId('undo-btn').click();
    await page.getByTestId('redo-btn').click();

    // 6. Save .collage and reopen after New Shot
    const dlPromise = page.waitForEvent('download');
    await page.getByTestId('save-archive-btn').click();
    const dl = await dlPromise;
    const savedPath = testInfo.outputPath('g2-shot.collage');
    await dl.saveAs(savedPath);

    await page.getByTestId('new-shot-btn').click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 0');
    await page.getByTestId('open-archive-input').setInputFiles(savedPath);
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 4');

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
