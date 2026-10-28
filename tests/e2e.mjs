import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeFixtures } from './fixtures.mjs';

const root = process.cwd();
const run = process.env.QIDU_TEST_RUN || Date.now().toString();
const output = path.join(root, 'test-results', run);
await fs.mkdir(output, { recursive: true });
const fixtures = await makeFixtures(path.join(output, 'fixtures'));
const profile = path.join(root, 'tests', '.profiles', run);
const launch = () => electron.launch({
  args: ['.', '--force-renderer-accessibility', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'], cwd: root,
  env: { ...process.env, QIDU_TEST_USER_DATA: profile, QIDU_TEST_HIDE: '1', QIDU_DEV_URL: '' },
  timeout: 30000,
});
const errors = []; const checks = [];
const formatsOnly = process.env.QIDU_TEST_FORMATS_ONLY === '1';
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
let app, page;
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
  response.end(`<html><head><title>在本地测试网页导入</title></head><body><article><h1>在本地测试网页导入</h1>${`<p>${fixtures.paragraph}</p>`.repeat(15)}<script>window.articleScriptRan = true</script></article></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  app = await launch(); page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.book-card')).toHaveCount(6);
  await page.screenshot({ path: path.join(output, '01-library.png'), animations: 'disabled' });
  check('fresh desktop startup and six clearly labeled sample guides');

  if (!formatsOnly) {
  await page.getByLabel('搜索书名或作者', { exact: true }).fill('梭罗');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.getByLabel('清除搜索', { exact: true }).click();
  await page.getByLabel('列表视图').click(); await expect(page.locator('.book-row')).toHaveCount(6);
  await page.getByLabel('网格视图').click();
  await page.getByRole('tab', { name: '想读' }).click(); await expect(page.locator('.book-card')).toHaveCount(4);
  await page.getByRole('tab', { name: '全部书籍' }).click();
  check('search, status filters and grid/list layouts');

  await page.getByRole('button', { name: '阅读 瓦尔登湖', exact: true }).click();
  await expect(page.locator('.reading-article h2')).toHaveText('从一页开始');
  await expect(page.locator('.reader-pagination')).toContainText('/ 4');
  await page.screenshot({ path: path.join(output, '02-reader.png') });
  await page.getByLabel('目录', { exact: true }).click();
  await page.locator('.toc-list button').nth(1).click();
  await expect(page.locator('.reading-article h2')).toHaveText('在日常中发现远方');
  await page.getByLabel('添加书签（Ctrl D）').click();
  await page.getByLabel('收起侧栏').click();
  await page.getByLabel('阅读样式', { exact: true }).click();
  await page.getByRole('button', { name: '夜读', exact: true }).click();
  await page.getByLabel('放大字号').click();
  await expect(page.locator('.reader')).toHaveClass(/reader-dark/);
  await expect(page.locator('.reading-article')).toHaveCSS('font-size', '21px');
  await page.getByRole('button', { name: '纸间', exact: true }).click();
  await page.getByLabel('关闭阅读设置').click();
  await page.locator('.reading-article p').nth(1).evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await expect(page.getByRole('dialog', { name: '保存文字摘录' })).toBeVisible();
  await page.getByLabel('摘录想法').fill('测试：把喜欢的句子留下。');
  await page.getByRole('button', { name: '保存摘录', exact: true }).click();
  await page.getByLabel('专注模式', { exact: true }).click(); await expect(page.locator('.reader')).toHaveClass(/reader-focus/);
  await page.getByRole('button', { name: '退出专注', exact: true }).click();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('text reading, chapter navigation, themes, font size, bookmarks, highlights and focus mode');

  await page.getByRole('button', { name: '摘录与书签' }).click();
  await expect(page.locator('.note-card')).toHaveCount(2);
  await page.getByRole('button', { name: '我的书架' }).click();
  await page.getByLabel('瓦尔登湖 详情与管理').click();
  await page.getByRole('button', { name: '写书评', exact: true }).click();
  await page.getByLabel('评为 5 星').click();
  await page.getByLabel('给这份感受起个名字').fill('把时间还给自己');
  await page.getByLabel('你的阅读手记').fill('这是端到端测试创建的私人书评，验证星级与文字都能持久保存。');
  await page.getByRole('button', { name: '保存书评', exact: true }).click();
  await page.getByRole('button', { name: '书评手记', exact: true }).click();
  await expect(page.locator('.review-card')).toHaveCount(1);
  await expect(page.locator('.review-card')).toContainText('把时间还给自己');
  check('private review creation and saved highlight/bookmark lists');

  await page.getByRole('button', { name: '新建书单', exact: true }).first().click();
  await page.getByLabel('书单名称').fill('测试书单');
  await page.getByRole('button', { name: '创建书单', exact: true }).click();
  await page.getByRole('button', { name: '我的书架' }).click();
  await page.getByLabel('瓦尔登湖 详情与管理').click();
  await page.getByLabel('测试书单', { exact: true }).check();
  await page.getByLabel('关闭弹窗').click();
  await page.getByRole('button', { name: '测试书单', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  check('custom book collection and membership');
  }

  await page.getByRole('button', { name: '导入书籍', exact: true }).click();
  await page.getByLabel('选择书籍文件').setInputFiles(['txt','epub','pdf','html','md'].map(ext => path.join(fixtures.directory, `阅读测试.${ext}`)));
  await expect(page.locator('.import-result')).toContainText('已导入 5 本', { timeout: 20000 });
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(11);
  check('batch import of TXT, EPUB, PDF, HTML and Markdown');

  await page.getByRole('button', { name: '导入书籍', exact: true }).click();
  await page.getByLabel('选择书籍文件').setInputFiles(path.join(fixtures.directory, '阅读测试.txt'));
  await expect(page.locator('.import-result')).toContainText('跳过 1 本重复书籍');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('SHA-256 duplicate import detection');

  const txtCard = page.locator('.book-card').filter({ has: page.locator('.format-txt') }).filter({ hasText: '阅读测试' });
  await txtCard.getByRole('button', { name: '阅读 阅读测试', exact: true }).click();
  await expect(page.locator('.reading-article h2')).toHaveText('第一章 晨光');
  await page.getByLabel('目录', { exact: true }).click(); await page.locator('.toc-list button').nth(1).click();
  await expect(page.locator('.reading-article h2')).toHaveText('第二章 远方');
  await page.getByLabel('书内查找（Ctrl F）').click(); await page.getByLabel('书内搜索', { exact: true }).fill('远方的风');
  await expect(page.locator('.search-results button').first()).toBeVisible();
  await page.locator('.search-results button').first().click();
  await expect(page.locator('.reading-article mark').first()).toHaveText('远方的风');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('imported Chinese text chapters and full-text search');

  await page.getByRole('button', { name: '阅读 网页阅读测试', exact: true }).click();
  await expect(page.locator('.reading-article')).toContainText('清晨');
  expect(await page.evaluate(() => window.untrustedScriptRan)).toBeUndefined();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: '阅读 Markdown 书页', exact: true }).click();
  await expect(page.locator('.reading-article ul')).toContainText('找一本好书');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('sanitized HTML and formatted Markdown reading');

  const pdfCard = page.locator('.book-card').filter({ has: page.locator('.format-pdf') });
  await pdfCard.getByRole('button', { name: '阅读 阅读测试', exact: true }).click();
  await expect(page.locator('.textLayer')).toContainText('A quiet page - 1', { timeout: 20000 });
  await page.screenshot({ path: path.join(output, '03-pdf.png') });
  await page.getByLabel('下一页', { exact: true }).click();
  await expect(page.locator('.textLayer')).toContainText('A quiet page - 2');
  await page.getByLabel('跳转页码').fill('3'); await page.getByLabel('跳转页码').press('Enter');
  await expect(page.locator('.textLayer')).toContainText('A quiet page - 3');
  await page.getByLabel('书内查找（Ctrl F）').click(); await page.getByLabel('书内搜索', { exact: true }).fill('quiet journey');
  await expect(page.locator('.search-results button')).toHaveCount(3);
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('PDF canvas/text layer rendering, pagination, page jump and search');

  await page.getByRole('button', { name: '阅读 EPUB 阅读测试', exact: true }).click();
  await expect(page.locator('.epub-container iframe')).toBeVisible({ timeout: 20000 });
  await expect(page.frameLocator('.epub-container iframe').locator('body')).toContainText('第一章 窗边');
  expect(await page.evaluate(() => window.untrustedScriptRan)).toBeUndefined();
  await page.screenshot({ path: path.join(output, '04-epub.png') });
  await page.getByLabel('下一页', { exact: true }).click();
  await page.getByLabel('目录', { exact: true }).click();
  await page.locator('.toc-list button').nth(1).click();
  await expect(page.frameLocator('.epub-container iframe').locator('body')).toContainText('第二章 远山');
  await page.getByLabel('书内查找（Ctrl F）').click(); await page.getByLabel('书内搜索', { exact: true }).fill('书页像一扇窗');
  await expect(page.locator('.search-results button').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('sandboxed EPUB layout, page turn, table of contents and full-text search');

  await page.getByRole('button', { name: '导入书籍', exact: true }).click();
  await page.getByRole('button', { name: '网页链接', exact: true }).click();
  await page.getByLabel('文章链接').fill(`http://127.0.0.1:${server.address().port}/article`);
  await page.getByRole('button', { name: '保存到书架', exact: true }).click();
  await expect(page.locator('.import-result')).toContainText('已导入 1 本');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: '阅读 在本地测试网页导入', exact: true }).click();
  await expect(page.locator('.reading-article')).toContainText('属于自己的时间');
  expect(await page.evaluate(() => window.articleScriptRan)).toBeUndefined();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('desktop URL fetching and offline sanitized article reading');

  await app.close(); app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.book-card')).toHaveCount(12);
  if (!formatsOnly) {
  await page.getByRole('button', { name: '书评手记', exact: true }).click(); await expect(page.locator('.review-card')).toHaveCount(1);
  await page.getByRole('button', { name: '摘录与书签' }).click(); await expect(page.locator('.note-card')).toHaveCount(2);
  await page.getByRole('button', { name: '我的书架' }).click();
  await page.getByRole('button', { name: '阅读 瓦尔登湖', exact: true }).click();
  await expect(page.locator('.reading-article h2')).toHaveText('在日常中发现远方');
  await expect(page.locator('.reading-article')).toHaveCSS('font-size', '21px');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('restart persistence of files, progress, reviews, notes and reader preferences');
  }

  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByRole('button', { name: '夜间', exact: true }).click(); await expect(page.locator('.app')).toHaveClass(/theme-dark/);
  await page.getByLabel('每日阅读目标').selectOption('45');
  await page.getByRole('button', { name: '日间', exact: true }).click();
  await page.getByRole('button', { name: '阅读足迹', exact: true }).click(); await expect(page.locator('.goal-ring')).toContainText('目标 45 分钟');
  await page.screenshot({ path: path.join(output, '05-stats.png') });
  check('appearance preferences and reading goals');

  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  const backupPath = path.join(output, 'roundtrip.qidu');
  await app.evaluate(({ BrowserWindow }, destination) => {
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => item.setSavePath(destination));
  }, backupPath);
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  await expect.poll(async () => (await fs.stat(backupPath).catch(() => ({ size: 0 }))).size, { timeout: 20000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: '我的书架' }).click();
  await page.getByLabel('在本地测试网页导入 详情与管理').click();
  await page.getByRole('button', { name: '移出书架', exact: true }).click();
  await page.getByRole('button', { name: '确认移出', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(11);
  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByLabel('恢复备份文件').setInputFiles(backupPath);
  await page.getByRole('button', { name: '确认恢复并替换', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(12);
  await page.getByRole('button', { name: '阅读 在本地测试网页导入', exact: true }).click();
  await expect(page.locator('.reading-article')).toContainText('属于自己的时间');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  check('full backup download, book removal and confirmed atomic restore');
  expect(errors).toEqual([]); check('no renderer runtime errors across all workflows');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  console.log(`Completed ${checks.length} desktop workflows. Evidence: ${output}`);
} catch (error) {
  console.error(error);
  console.error('Renderer errors:', errors);
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {}); server.close();
}
