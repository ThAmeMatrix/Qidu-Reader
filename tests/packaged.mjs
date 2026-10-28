import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeFixtures } from './fixtures.mjs';

const root = process.cwd();
const output = path.join(root, 'test-results', `packaged-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
await makeFixtures(path.join(output, 'fixtures'));
const application = await electron.launch({
  executablePath: path.join(root, 'release/win-unpacked/栖读.exe'),
  args: ['--force-renderer-accessibility', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  env: { ...process.env, QIDU_DEV_URL: '', QIDU_TEST_HIDE: '1', QIDU_TEST_USER_DATA: path.join(output, 'profile') },
  timeout: 30000,
});
try {
  const page = await application.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true);
  await expect(page.locator('.book-card')).toHaveCount(6);
  expect(page.url()).toContain('app.asar/dist/index.html');
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  console.log('PASS packaged ASAR startup and renderer isolation');
  await page.screenshot({ path: path.join(output, 'library.png'), animations: 'disabled' });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '偏好设置', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: path.join(output, 'compact.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '发现好书', exact: true }).click();
  await expect(page.locator('.source-directory>button')).toHaveCount(9);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(output, 'discovery-compact.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /管理搜索站点/ }).click();
  await expect(page.getByLabel('启用 国家图书馆', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, 'sources-compact.png'), animations: 'disabled' });
  await page.getByLabel('关闭弹窗', { exact: true }).click();
  await page.getByRole('button', { name: /^我的书架/ }).click();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.getByRole('button', { name: '导入书籍', exact: true }).click();
  await page.getByLabel('选择书籍文件').setInputFiles(['pdf', 'epub'].map(ext => path.join(output, 'fixtures', `阅读测试.${ext}`)));
  await expect(page.locator('.import-result')).toContainText('已导入 2 本');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.locator('.book-card').filter({ has: page.locator('.format-pdf') }).getByRole('button', { name: '阅读 阅读测试', exact: true }).click();
  await expect(page.locator('.textLayer')).toContainText('A quiet page - 1', { timeout: 20000 });
  await page.screenshot({ path: path.join(output, 'pdf.png') });
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: '阅读 EPUB 阅读测试', exact: true }).click();
  await expect(page.frameLocator('.epub-container iframe').locator('body')).toContainText('第一章 窗边', { timeout: 20000 });
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks: ['Packaged ASAR startup', 'Isolated renderer', 'Minimum window size', 'Discovery and source management at minimum size', 'Local PDF worker and font assets', 'EPUB archive and sandbox rendering'], errors }, null, 2));
  console.log(`PASS packaged Windows application, responsive layout, local PDF and EPUB. Evidence: ${output}`);
} finally { await application.close(); }
