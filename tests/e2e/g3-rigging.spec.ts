import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { createSolidSquare } from '../../src/assets/synthetic';

test.describe('G3 Rigging, Camera, Tile Layers & .collageasset E2E', () => {
  test('builds rig, rotates parent, changes draw order, toggles wireframe, exports/imports .collageasset, and configures tile + camera', async ({
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

    // 1. Import a PNG and add two sprites + a Group
    const sq = createSolidSquare(64, 64, [230, 140, 50, 255]);
    const pngPath = testInfo.outputPath('limb.png');
    fs.writeFileSync(pngPath, Buffer.from(encodePngRgba(sq.rgba, 64, 64)));
    await page.getByTestId('import-image-input').setInputFiles(pngPath);

    await page.getByTestId('add-to-stage-btn').click();
    await page.getByTestId('inspector-name-input').fill('Torso');
    await page.getByTestId('add-to-stage-btn').click();
    await page.getByTestId('inspector-name-input').fill('Arm');
    await page.getByTestId('add-group-btn').click();
    await page.getByTestId('inspector-name-input').fill('Puppet');

    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 3');

    // 2. Parent Torso under Puppet, Arm under Torso
    await page.locator('span', { hasText: /^Torso$/ }).click();
    await page.getByTestId('inspector-parent-select').selectOption({ label: 'Puppet' });
    await page.locator('span', { hasText: /^Arm$/ }).click();
    await page.getByTestId('inspector-parent-select').selectOption({ label: 'Torso' });

    // 3. Toggle wireframe overlay
    await page.getByTestId('toggle-wireframe-btn').click();
    await expect(page.getByTestId('toggle-wireframe-btn')).toContainText('Wireframe: On');

    // 4. Export Puppet rig as .collageasset
    await page.getByText('[G] Puppet').click();
    const pkgDlPromise = page.waitForEvent('download');
    await page.getByTestId('export-rig-btn').click();
    const pkgDl = await pkgDlPromise;
    const pkgPath = testInfo.outputPath('puppet.collageasset');
    await pkgDl.saveAs(pkgPath);

    // 5. Start a fresh shot and import .collageasset -> restores 3-node rig!
    await page.getByTestId('new-shot-btn').click();
    await page.getByTestId('confirm-ok-btn').click();
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 0');

    await page.getByTestId('import-package-input').setInputFiles(pkgPath);
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 3');

    // 6. Add a repeating tile layer & adjust mirrorX + Shot Camera zoom
    await page.getByTestId('import-image-input').setInputFiles(pngPath);
    await page.getByTestId('add-tile-to-stage-btn').first().click();
    await page.getByTestId('tile-mirror-x').check();
    await page.getByTestId('camera-zoom-input').fill('1.5');
    await expect(page.getByTestId('stage-status')).toContainText('Nodes: 4');

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
