// Run with the bundled Node runtime and NODE_PATH pointing at its modules.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const baseURL = process.env.CLINMIND_TEST_URL || 'http://127.0.0.1:8000';
(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1600,height:900}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(baseURL);
    await page.waitForFunction(()=>localStorage.getItem('clinmind-game-session'));
    const id=await page.evaluate(()=>localStorage.getItem('clinmind-game-session'));
    await page.getByRole('button',{name:'打开工作站',exact:true}).click();
    await page.waitForURL('**/workstation.html');
    await page.waitForSelector('.inquiry-button[role=button]');
    assert.equal(await page.evaluate(()=>localStorage.getItem('clinmind-game-session')),id);
    await page.getByRole('button',{name:'体查',exact:true}).click();
    await page.locator('.inquiry-button').first().click();
    await page.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('33 mmHg'));
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.reload();
    await page.waitForSelector('.inquiry-button[role=button]');
    await page.locator('.game-tools').getByRole('button',{name:'报告',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('33 mmHg'));
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'结案生成报告',exact:true}).click();
    await page.getByPlaceholder('请输入最终诊断').fill('Stanford A型主动脉夹层');
    await page.getByRole('button',{name:'提交并生成报告'}).click();
    await page.waitForSelector('.game-metrics');
    assert.ok((await page.locator('.game-metrics').innerText()).includes('/ 100'));
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.screenshot({path:'browser-check.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: reception -> workstation -> examination -> report -> refresh restore -> evaluation; no browser errors');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
