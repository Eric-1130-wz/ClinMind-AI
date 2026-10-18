// Optional browser regression checks. Requires Playwright and local Chrome.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.CLINMIND_TEST_URL || 'http://127.0.0.1:8000';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => localStorage.getItem('clinmind-game-session'));
    for (const [key, title] of [['1','问诊'],['2','体查'],['3','检验'],['4','处方'],['5','转归']]) {
      await page.keyboard.press(key);
      await page.getByRole('heading', {name: `${title} · 快捷操作`}).waitFor();
      await page.getByRole('button', {name: '关闭', exact: true}).click();
    }
    const input = page.getByRole('textbox', {name: '问诊或诊疗指令'});
    await input.fill('12345e');
    assert.equal(await input.inputValue(), '12345e');
    assert.match(page.url(), /reception\.html/);
    await input.fill('');
    await input.blur();
    await page.getByRole('button', {name: '关闭声音', exact: true}).click();
    await page.keyboard.press('e');
    await page.waitForURL('**/workstation.html');
    await page.waitForSelector('.inquiry-button[role=button]');
    assert.equal(await page.evaluate(() => window.monitorAudio.isMuted), true);
    await page.waitForFunction(() => document.querySelector('.wave-svg polyline:last-child')?.getAttribute('points'));
    const before = await page.locator('.wave-svg polyline').first().getAttribute('points');
    await page.waitForTimeout(300);
    assert.notEqual(await page.locator('.wave-svg polyline').first().getAttribute('points'), before);
    assert.equal(await page.locator('.wave-svg polyline').count(), 3);
    assert.ok(Number(await page.locator('.vital strong').first().textContent()) > 0);

    const trust = await page.locator('.relation').first().locator('b').textContent();
    await page.locator('.inquiry-button').nth(3).click();
    await page.waitForFunction(old => document.querySelector('.relation b').textContent !== old, trust);
    await page.getByRole('button', {name: '检验', exact: true}).click();
    await page.locator('.inquiry-button').first().click();
    await page.getByRole('heading', {name: '客观检查报告', exact: true}).waitFor();
    assert.ok((await page.locator('.game-report').textContent()).includes('HEART_RATE'));
    const reportText = await page.locator('.game-report').textContent();
    await page.getByRole('button', {name: '关闭', exact: true}).click();
    await page.keyboard.press('Escape');
    await page.waitForURL('**/reception.html');
    await page.waitForFunction(() => document.querySelector('.timer').textContent !== '00:02');
    await page.locator('.report').first().click();
    await page.locator('h2', {hasText: '心电图'}).waitFor();
    assert.equal(await page.locator('.game-report').textContent(), reportText);
    await page.getByRole('button', {name: '关闭', exact: true}).click();

    await page.getByRole('button', {name: '打开设置', exact: true}).click();
    await page.locator('input[type=range]').fill('0.25');
    await page.locator('input[type=range]').dispatchEvent('input');
    await page.getByRole('button', {name: '关闭', exact: true}).click();
    await page.reload();
    await page.waitForFunction(() => localStorage.getItem('clinmind-game-session'));
    assert.equal(await page.evaluate(() => window.monitorAudio.volume), .25);

    // Only the UI response is stubbed. Backend validation is covered separately
    // by test_v2_regressions.py with httpx and a temporary .env file.
    await page.route('**/api/config/llm', async route => {
      const post = route.request().method() === 'POST';
      await route.fulfill({json: post ? {
        success: true, provider: 'custom', connection_ok: true, connection_tested: true,
        message: '测试接口已回复', connection_tested_at: new Date().toISOString()
      } : {provider: 'offline', connection_ok: null, model: 'offline-rule-engine'}});
    });
    await page.getByRole('button', {name: '打开设置', exact: true}).click();
    await page.getByRole('combobox', {name: '模型服务商'}).selectOption('custom');
    await page.getByRole('textbox', {name: '模型名称', exact: true}).fill('local-model');
    await page.getByRole('button', {name: '测试连接并保存'}).click();
    await page.waitForFunction(() => document.querySelector('.connection-state strong')?.textContent === '已连接');
    await page.getByRole('textbox', {name: '模型名称', exact: true}).fill('changed-model');
    assert.equal(await page.locator('.connection-state strong').textContent(), '尚未测试');
    await page.getByRole('button', {name: '关闭', exact: true}).click();
    await page.unroute('**/api/config/llm');

    await page.screenshot({path: path.join(process.env.CLINMIND_SCREENSHOT_DIR || '.', 'v2-reception.png')});
    await page.keyboard.press('e');
    await page.waitForURL('**/workstation.html');
    await page.waitForSelector('.inquiry-button[role=button]');
    await page.getByRole('button', {name: '结案生成报告', exact: true}).click();
    await page.getByPlaceholder('请输入最终诊断').fill('Stanford A型主动脉夹层');
    await page.getByRole('button', {name: '提交并生成报告'}).click();
    await page.waitForSelector('.game-metrics');
    await page.getByRole('button', {name: '关闭', exact: true}).click();
    const frozen = await page.locator('.wave-svg polyline').first().getAttribute('points');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.wave-svg polyline').first().getAttribute('points'), frozen);
    await page.screenshot({path: path.join(process.env.CLINMIND_SCREENSHOT_DIR || '.', 'v2-workstation.png')});
    assert.deepEqual(errors, []);
    console.log('PASS: 1-5/E/Esc, live ECG/Pleth/RESP, trust, shared reports, audio persistence, API badge and frozen evaluation; no browser errors');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
