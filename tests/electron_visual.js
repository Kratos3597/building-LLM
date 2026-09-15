const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'visual-artifacts');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const electronApp = await electron.launch({
    args: [root],
    env: { ...process.env, CLOUDNEX_SKIP_BACKEND: '1' },
  });
  try {
    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
    await page.waitForSelector('.window-title');
    await page.screenshot({ path: path.join(output, 'overview.png'), fullPage: true });
    if ((await page.locator('.window-title').textContent()).trim() !== 'CloudNex Local LLM Studio') throw new Error('CloudNex title bar is missing');
    await page.getByRole('button', { name: 'Data' }).click();
    await page.screenshot({ path: path.join(output, 'data.png'), fullPage: true });
    await page.getByRole('button', { name: 'Training' }).click();
    await page.screenshot({ path: path.join(output, 'training.png'), fullPage: true });
    await page.getByRole('button', { name: 'Maximize' }).click();
    const maximized = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    if (!maximized) throw new Error('Maximize control did not maximize the native window');
    await page.screenshot({ path: path.join(output, 'maximized.png'), fullPage: true });
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});