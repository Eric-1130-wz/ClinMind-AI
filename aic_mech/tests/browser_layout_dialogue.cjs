const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.CLINMIND_TEST_URL || 'http://127.0.0.1:8767';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
  try{
    const page=await browser.newPage({viewport:{width:1534,height:840}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>sessionStorage.setItem('clinmind-disclaimer-ack','1'));
    await page.goto(base+'/static/workstation.html');
    await page.waitForFunction(()=>localStorage.getItem('clinmind-game-session'));
    await page.waitForSelector('.inquiry-button[role=button]');
    for(const [width,height] of [[1534,840],[1366,768],[1280,720],[1920,1080]]){
      await page.setViewportSize({width,height});
      await page.waitForTimeout(120);
      const bounds=await page.evaluate(()=>{
        const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
        const svg=document.querySelector('.radar-panel .radar-svg');
        return {
          radar:rect(document.querySelector('.radar-panel')),
          svg:rect(svg),
          labels:[...svg.querySelectorAll('text')].map(el=>({text:el.textContent,...rect(el)})),
          monitor:rect(document.querySelector('.telemetry')),
          footer:rect(document.querySelector('.work-footer'))
        };
      });
      assert.ok(bounds.svg.height>150,JSON.stringify(bounds));
      assert.ok(bounds.radar.top>=bounds.monitor.bottom);
      assert.ok(bounds.radar.bottom<bounds.footer.top);
      for(const label of bounds.labels){
        assert.ok(label.top>=bounds.radar.top&&label.bottom<=bounds.radar.bottom,width+': '+JSON.stringify(label));
        assert.ok(label.left>=bounds.radar.left&&label.right<=bounds.radar.right,width+': '+JSON.stringify(label));
      }
      assert.equal(bounds.labels.length,6);
    }
    assert.equal(await page.locator('#record-area').count(),0);
    assert.equal(await page.getByRole('button',{name:'病历记录',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'接诊记录',exact:true}).count(),1);
    await page.getByRole('button',{name:'处方',exact:true}).click();
    const input=page.getByRole('textbox',{name:'问诊或诊疗指令'});
    await input.fill('疼了多久？有没有药物过敏？');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/action/execute')&&r.request().method()==='POST');
    await input.press('Enter');
    const result=await (await response).json();
    assert.equal(result.action_type,'INQUIRY');
    assert.ok(result.dialogues.some(d=>d.speaker==='patient'&&d.text.includes('3小时')&&d.text.includes('过敏')));
    await page.waitForFunction(()=>!document.body.classList.contains('is-busy'));
    assert.equal(await page.locator('.scene-log').isVisible(),false);
    assert.ok(await page.locator('.scene-reply').isVisible());
    assert.match(await page.locator('.scene-reply').textContent(),/3小时/);
    await page.getByRole('button',{name:'接诊记录',exact:true}).click();
    await page.locator('.scene-log:not([hidden])').waitFor();
    await page.getByRole('button',{name:'关闭记录'}).click();
    await page.setViewportSize({width:1534,height:840});
    await page.screenshot({path:path.join(process.env.CLINMIND_SCREENSHOT_DIR || '.', 'workstation-radar-fixed.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: all six radar labels visible at 4 window sizes; no duplicate record widget; free-text question correctly routed; no page errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

