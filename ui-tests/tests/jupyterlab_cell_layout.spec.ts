import { expect, test } from '@jupyterlab/galata';

test.describe('jupyterlab-cell-layout — Milestone 1 acceptance', () => {
  test('emits activation console message', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', m => logs.push(m.text()));
    await page.goto();
    expect(
      logs.filter(
        s => s === 'JupyterLab extension jupyterlab-cell-layout is activated!'
      )
    ).toHaveLength(1);
  });

  test('adds mode and orientation toolbar buttons to every notebook', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew('m1-toolbar.ipynb');

    const modeBtn = page.locator(
      '.jp-NotebookPanel .jp-Toolbar [data-command]'
    );
    await expect(
      page
        .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
        .filter({ hasText: 'Edit mode' })
    ).toBeVisible();
    await expect(
      page
        .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
        .filter({ hasText: /^(Portrait|Landscape)$/ })
    ).toBeVisible();

    // Confirm the mode button exists (regardless of exact label mapping)
    await expect(modeBtn.first()).toBeVisible();
  });

  test('mode button flips label and reveals the page canvas', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew('m1-toggle.ipynb');

    const canvas = page.locator('.jp-NotebookPanel .jp-CellLayout-root');
    await expect(canvas).toBeHidden();

    await page
      .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
      .filter({ hasText: 'Edit mode' })
      .click();

    await expect(canvas).toBeVisible();
    await expect(
      page.locator('.jp-NotebookPanel .jp-CellLayout-page')
    ).toBeVisible();
    await expect(
      page
        .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
        .filter({ hasText: 'Summary mode' })
    ).toBeVisible();
  });

  test('Ctrl+Shift+T keyboard shortcut toggles mode', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew('m1-shortcut.ipynb');

    const canvas = page.locator('.jp-NotebookPanel .jp-CellLayout-root');
    await expect(canvas).toBeHidden();

    await page.locator('.jp-Notebook').first().click();
    await page.keyboard.press('Control+Shift+T');
    await expect(canvas).toBeVisible();

    await page.keyboard.press('Control+Shift+T');
    await expect(canvas).toBeHidden();
  });

  test('orientation button swaps page width and height', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew('m1-orientation.ipynb');

    // Enter summary mode so the canvas is visible and measurable
    await page
      .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
      .filter({ hasText: 'Edit mode' })
      .click();

    const page_ = page.locator('.jp-NotebookPanel .jp-CellLayout-page');
    const portraitBox = await page_.boundingBox();
    expect(portraitBox).not.toBeNull();
    expect(portraitBox!.height).toBeGreaterThan(portraitBox!.width);

    await page
      .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
      .filter({ hasText: 'Portrait' })
      .click();

    const landscapeBox = await page_.boundingBox();
    expect(landscapeBox).not.toBeNull();
    expect(landscapeBox!.width).toBeGreaterThan(landscapeBox!.height);
    expect(landscapeBox!.width).toBeCloseTo(portraitBox!.height, 0);
    expect(landscapeBox!.height).toBeCloseTo(portraitBox!.width, 0);
  });

  test('summary mode persists in notebook metadata on save + reopen', async ({
    page
  }) => {
    await page.goto();
    const nb = 'm1-persist.ipynb';
    await page.notebook.createNew(nb);

    await page
      .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
      .filter({ hasText: 'Edit mode' })
      .click();
    await expect(
      page.locator('.jp-NotebookPanel .jp-CellLayout-root')
    ).toBeVisible();

    await page.notebook.save();
    await page.notebook.close(true);
    await page.notebook.open(nb);

    await expect(
      page.locator('.jp-NotebookPanel .jp-CellLayout-root')
    ).toBeVisible();
    await expect(
      page
        .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
        .filter({ hasText: 'Summary mode' })
    ).toBeVisible();
  });

  test('summary canvas renders one input widget per cell', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew('m1-cells.ipynb');
    await page.notebook.setCell(0, 'code', 'print("first")');
    await page.notebook.addCell('markdown', '# Second cell');
    await page.notebook.addCell('code', 'x = 1 + 1');

    await page
      .locator('.jp-NotebookPanel .jp-Toolbar .jp-ToolbarButtonComponent')
      .filter({ hasText: 'Edit mode' })
      .click();

    const inputs = page.locator(
      '.jp-NotebookPanel .jp-CellLayout-page .jp-CellLayout-input'
    );
    await expect(inputs).toHaveCount(3);
  });
});
