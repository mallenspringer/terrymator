import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { createSolidSquare } from '../../src/assets/synthetic';

test.describe('G4 Timeline, Looping & Shot Authoring E2E', () => {
  test('authors pose keys, uses manual draft & auto-key, adds group loop, sets work range, and survives .collage reopen', async ({
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

    // 1. Import PNG, create Rig group + Sprite child
    const sq = createSolidSquare(64, 64, [240, 180, 40, 255]);
    const pngPath = testInfo.outputPath('walker.png');
    fs.writeFileSync(pngPath, Buffer.from(encodePngRgba(sq.rgba, 64, 64)));
    await page.getByTestId('import-image-input').setInputFiles(pngPath);
    await page.getByTestId('add-to-stage-btn').click();
    await page.getByTestId('add-group-btn').click();

    // 2. Capture Pose Key at frame 0 (Auto-Key OFF)
    await page.getByTestId('capture-pose-btn').click();
    await expect(page.getByTestId('timeline-frame-readout')).toContainText('F 0 /');

    // 3. Step to frame 4, edit X with Auto-Key OFF -> Pending Draft bar appears -> Key Drafts
    await page.getByTestId('timeline-step-fwd').click();
    await page.getByTestId('timeline-step-fwd').click();
    await expect(page.getByTestId('timeline-frame-readout')).toContainText('F 2 /');

    await page.getByTestId('inspector-x-input').fill('150');
    await expect(page.getByTestId('pending-draft-bar')).toBeVisible();
    await page.getByTestId('commit-drafts-btn').click();
    await expect(page.getByTestId('pending-draft-bar')).toBeHidden();

    // 4. Enable Auto-Key, step to frame 4, edit X -> commits key immediately
    await page.getByTestId('autokey-toggle').check();
    await page.getByTestId('timeline-step-fwd').click();
    await page.getByTestId('inspector-x-input').fill('250');
    await expect(page.getByTestId('pending-draft-bar')).toBeHidden();

    // 5. Add a Group Repeat loop and set Work Range [2, 12]
    await page.getByTestId('loop-selector-kind').selectOption('group');
    await page.getByTestId('loop-mode-select').selectOption('repeat');
    await page.getByTestId('add-loop-btn').click();
    await page.getByTestId('timeline-range-in').fill('2');
    await page.getByTestId('timeline-range-out').fill('12');

    // 6. Save .collage, start New Shot, reopen .collage -> verify loop & range survived
    const dlPromise = page.waitForEvent('download');
    await page.getByTestId('save-archive-btn').click();
    const dl = await dlPromise;
    const savedPath = testInfo.outputPath('g4-shot.collage');
    await dl.saveAs(savedPath);

    await page.getByTestId('new-shot-btn').click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 0');
    await page.getByTestId('open-archive-input').setInputFiles(savedPath);
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 2');
    await expect(page.getByTestId('timeline-range-in')).toHaveValue('2');
    await expect(page.getByTestId('timeline-range-out')).toHaveValue('12');

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
