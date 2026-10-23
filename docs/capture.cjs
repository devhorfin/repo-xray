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
async function page(browser, w, h, scale) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: 'dark' });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text()); });
  // the demo repo is local: answer its check with the saved result, after the usual pause
  await p.route(url => url.pathname === '/api/xray' && /halcyon-liquidity/.test(decodeURIComponent(url.search)), async route => {
    await sleep(1400);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEMO) });
  });
  return p;
}
async function settle(p) { await p.evaluate(() => document.fonts.ready); await sleep(400); }

(async () => {
  const browser = await chromium.launch();

  // 1. hero: the page fold, 1280x640 (GitHub's social-preview shape), 2x
  let p = await page(browser, 1280, 640, 2);
  await p.goto(BASE + '/'); await settle(p);
  await p.fill('#repo', 'https://github.com/owner/repo');
  await p.screenshot({ path: path.join(OUT, 'hero.png') });
  console.log('hero.png');

  // 2. the DRESSED UP card (synthetic demo), whole card, desktop 2x
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto(BASE + '/?demo=staged'); await p.waitForSelector('.card'); await settle(p);
  await p.locator('.card').screenshot({ path: path.join(OUT, 'card-dressed-up.png') });
  // and just its head + first three checks, for the side-by-side
  const top = await p.evaluate(() => {
    const card = document.querySelector('.card').getBoundingClientRect();
    const third = document.querySelectorAll('.check')[2].getBoundingClientRect();
    return { x: card.x, y: card.y + scrollY, width: card.width, height: third.bottom - card.top };
  });
  await p.screenshot({ path: path.join(OUT, 'card-dressed-up-top.png'), clip: top, fullPage: true });
  console.log('card-dressed-up.png, card-dressed-up-top.png');

  // 3. a real CLEAN card with its token table (sindresorhus/got), head + copies
  await p.goto(BASE + '/?repo=sindresorhus/got');
  await p.waitForSelector('.card', { timeout: 120000 }); await settle(p);
  await p.locator('.card').screenshot({ path: path.join(OUT, 'card-clean.png') });
  const head = await p.evaluate(() => {
    const card = document.querySelector('.card').getBoundingClientRect();
    const third = document.querySelectorAll('.check')[2].getBoundingClientRect();
    return { x: card.x, y: card.y + scrollY, width: card.width, height: third.bottom - card.top };
  });
  await p.screenshot({ path: path.join(OUT, 'card-clean-top.png'), clip: head, fullPage: true });
  const copies = p.locator('.copies');
  if (await copies.count()) await copies.screenshot({ path: path.join(OUT, 'copies-table.png') });
  console.log('card-clean.png, card-clean-top.png, copies-table.png');

  // 4. the six-checks grid and the agents section
  await p.goto(BASE + '/'); await settle(p);
  await p.locator('section.how').screenshot({ path: path.join(OUT, 'six-checks.png') });
  await p.locator('section.agents').screenshot({ path: path.join(OUT, 'for-agents.png') });
  console.log('six-checks.png, for-agents.png');

  // 5. phone, 430 wide, 3x: fold and the demo card
  const ph = await page(browser, 430, 932, 3);
  await ph.goto(BASE + '/'); await settle(ph);
  await ph.screenshot({ path: path.join(OUT, 'phone-fold.png') });
  await ph.goto(BASE + '/?demo=staged'); await ph.waitForSelector('.card'); await settle(ph);
  await ph.evaluate(() => document.querySelector('.card').scrollIntoView());
  await sleep(200);
  await ph.screenshot({ path: path.join(OUT, 'phone-card.png') });
  console.log('phone-fold.png, phone-card.png');

  // 6. GIF frames: type a link, press the button, wait, scroll through the card
  const g = await page(browser, 1100, 720, 1);
  await g.goto(BASE + '/'); await settle(g);
  let n = 0;
  const shot = async (times = 1) => { for (let i = 0; i < times; i++) await g.screenshot({ path: path.join(FRAMES, String(n++).padStart(4, '0') + '.png') }); };
  await g.evaluate(() => scrollTo(0, 0));
  await shot(8);                                         // rest on the fold
  await g.click('#repo');
  const link = 'github.com/example/halcyon-liquidity';
  for (let i = 1; i <= link.length; i += 2) { await g.fill('#repo', link.slice(0, i)); await shot(); }
  await g.fill('#repo', link); await shot(6);
  await g.click('#go'); await sleep(150); await shot(6);   // "Reading the history…"
  await g.waitForSelector('.card'); await settle(g);
  const y0 = await g.evaluate(() => document.querySelector('.card').getBoundingClientRect().top + scrollY - 24);
  const y1 = await g.evaluate(() => document.querySelector('.card').getBoundingClientRect().bottom + scrollY - innerHeight + 24);
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await g.evaluate(y => scrollTo(0, y), Math.round(e * y0)); await shot();
  }
  await shot(14);                                        // hold on the grade
  for (let i = 1; i <= 40; i++) {
    const t = i / 40, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await g.evaluate(y => scrollTo(0, y), Math.round(y0 + e * (y1 - y0))); await shot();
  }
  await shot(16);                                        // hold on Claims
  console.log(`${n} GIF frames`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
