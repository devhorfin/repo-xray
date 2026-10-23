// Captures the README visuals from the running page (node server.js on :5480).
//   node docs/capture.cjs            → docs/img/*.png and docs/img/frames/ for the GIF
// Needs Playwright's Chromium. Set PLAYWRIGHT_PATH to a node_modules/playwright folder if it isn't installed here.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const BASE = process.env.XRAY_URL || 'http://localhost:5480';
const OUT = path.join(__dirname, 'img');
const FRAMES = path.join(OUT, 'frames');
const DEMO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'demo', 'staged-demo.json'), 'utf8'));
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(browser, w, h, scale, { holdScroll = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: 'dark' });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text()); });
  // for the GIF the script moves the page itself, so the log can fill before the report scrolls in
  if (holdScroll) await p.addInitScript(() => { Element.prototype.scrollIntoView = function () {}; });
  // the demo repo is local: answer its check with the saved result, after the usual pause
  await p.route(url => url.pathname === '/api/xray' && /halcyon-liquidity/.test(decodeURIComponent(url.search)), async route => {
    await sleep(1400);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEMO) });
  });
  return p;
}
// element and clip shots: hide the fixed menu bar and taskbar so they don't print over the window
const bars = (p, on) => p.evaluate(on => { for (const el of document.querySelectorAll('.menubar,.taskbar')) el.style.visibility = on ? '' : 'hidden'; const l = document.querySelector('#log'); if (l) l.scrollTop = l.scrollHeight; }, on);
async function settle(p) { await p.evaluate(() => document.fonts.ready); await p.waitForFunction(() => document.querySelectorAll('svg.lucide').length > 10); await sleep(500); }
// the report window from its title bar down to the end of the second row of checks
const reportTop = p => p.evaluate(() => {
  const w = document.querySelector('#w-report').getBoundingClientRect();
  const c = document.querySelectorAll('#w-report .check')[3].getBoundingClientRect();
  return { x: w.x, y: w.y + scrollY, width: w.width, height: c.bottom - w.top + 16 };
});

(async () => {
  const browser = await chromium.launch();

  // 1. hero: the desktop fold, 1280x640 (GitHub's social-preview shape), 2x
  let p = await page(browser, 1280, 640, 2);
  await p.goto(BASE + '/'); await settle(p);
  await p.screenshot({ path: path.join(OUT, 'hero.png') });
  console.log('hero.png');

  // 2. the DRESSED UP report (synthetic demo), desktop 2x
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto(BASE + '/?demo=staged'); await p.waitForSelector('#w-report:not(.hidden) .check'); await settle(p);
  await bars(p, false);
  await p.locator('#w-report').screenshot({ path: path.join(OUT, 'card-dressed-up.png') });
  await p.screenshot({ path: path.join(OUT, 'card-dressed-up-top.png'), clip: await reportTop(p), fullPage: true });
  // and the main window with the log full of the demo's lines
  await p.evaluate(() => scrollTo(0, 0)); await sleep(300); await bars(p, false);
  await p.locator('#w-main').screenshot({ path: path.join(OUT, 'log-dressed-up.png') });
  console.log('card-dressed-up.png, card-dressed-up-top.png, log-dressed-up.png');

  // 3. a real CLEAN report with its token table (sindresorhus/got)
  await p.goto(BASE + '/?repo=sindresorhus/got');
  await p.waitForSelector('#w-report:not(.hidden) .check', { timeout: 120000 }); await settle(p); await bars(p, false);
  await p.locator('#w-report').screenshot({ path: path.join(OUT, 'card-clean.png') });
  await p.screenshot({ path: path.join(OUT, 'card-clean-top.png'), clip: await reportTop(p), fullPage: true });
  const copies = p.locator('#w-report .copies');
  if (await copies.count()) await copies.screenshot({ path: path.join(OUT, 'copies-table.png') });
  console.log('card-clean.png, card-clean-top.png, copies-table.png');

  // 4. the docs and agents windows
  await p.goto(BASE + '/'); await settle(p); await bars(p, false);
  await p.locator('#w-docs').screenshot({ path: path.join(OUT, 'six-checks.png') });
  await p.locator('#w-api').screenshot({ path: path.join(OUT, 'for-agents.png') });
  console.log('six-checks.png, for-agents.png');

  // 5. phone, 430 wide, 3x: fold and the demo report
  const ph = await page(browser, 430, 932, 3);
  await ph.goto(BASE + '/'); await settle(ph);
  await ph.screenshot({ path: path.join(OUT, 'phone-fold.png') });
  await ph.goto(BASE + '/?demo=staged'); await ph.waitForSelector('#w-report:not(.hidden) .check'); await settle(ph);
  await ph.evaluate(() => scrollTo(0, document.querySelector('#w-report').getBoundingClientRect().top + scrollY - 56));
  await sleep(300);
  await ph.screenshot({ path: path.join(OUT, 'phone-card.png') });
  console.log('phone-fold.png, phone-card.png');

  // 6. GIF frames: type a link, run, watch the log fill, scroll through the report
  const g = await page(browser, 1100, 720, 1, { holdScroll: true });
  await g.goto(BASE + '/'); await settle(g);
  let n = 0;
  const shot = async (times = 1) => { for (let i = 0; i < times; i++) await g.screenshot({ path: path.join(FRAMES, String(n++).padStart(4, '0') + '.png') }); };
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  await shot(8);                                          // rest on the boot log
  await g.click('#repo');
  const link = 'github.com/example/halcyon-liquidity';
  for (let i = 1; i <= link.length; i += 2) { await g.fill('#repo', link.slice(0, i)); await shot(); }
  await g.fill('#repo', link); await shot(4);
  await g.click('#go'); await sleep(120); await shot(8);  // "GET … waiting for the server"
  await g.waitForSelector('#w-report:not(.hidden) .check'); await settle(g);
  await shot(16);                                          // the log fills with the six results and the grade
  const y0 = await g.evaluate(() => document.querySelector('#w-report').getBoundingClientRect().top + scrollY - 58);
  const y1 = await g.evaluate(() => document.querySelector('#w-report').getBoundingClientRect().bottom + scrollY - innerHeight + 40);
  for (let i = 1; i <= 20; i++) { await g.evaluate(y => scrollTo(0, y), Math.round(ease(i / 20) * y0)); await shot(); }
  await shot(14);                                          // hold on the grade
  for (let i = 1; i <= 30; i++) { await g.evaluate(y => scrollTo(0, y), Math.round(y0 + ease(i / 30) * (y1 - y0))); await shot(); }
  await shot(14);                                          // hold on Crowd and Claims
  console.log(`${n} GIF frames`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
