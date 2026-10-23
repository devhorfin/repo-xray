// REPO X-RAY server — the page, the free route, the paid route (x402) and /r/ share pages.
// Collects: git log (bare, blobless clone), a depth-1 working tree, repo, owner, forks, pulls.
// Runs checks.js (history) and claims.js (README vs code, tokens carrying the name). Caches 1 h.
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { runAll } = require('./checks');
const { collectFiles, checkClaims, findCopies } = require('./claims');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { ExactSvmScheme } = require('@x402/svm/exact/server');
const { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } = require('@x402/svm');

const PORT = Number(process.env.PORT || 5480);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, 'cache');
const VERSION = fs.readFileSync(path.join(ROOT, 'version.txt'), 'utf8').trim();
const CACHE_TTL = 3600000;
const MAX_REPO_KB = 300000; // 300 MB on GitHub's size field: beyond that, the X-ray says no
const CLONE_TIMEOUT = 120000;
const FREE_PER_HOUR = 10;   // the free web route, per IP; the paid route has no limit
fs.mkdirSync(CACHE, { recursive: true });

// ---------- payment config ----------
// Devnet by default (free test USDC). Mainnet only when XRAY_NETWORK=mainnet and a real payTo is set.
const PAY = (() => {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'xray.config.json'), 'utf8')); } catch {}
  const network = process.env.XRAY_NETWORK || cfg.network || 'devnet';
  const payTo = process.env.XRAY_PAYTO || cfg.payTo || '';
  const price = process.env.XRAY_PRICE || cfg.price || '$0.01';
  const caip2 = network === 'mainnet' ? SOLANA_MAINNET_CAIP2 : SOLANA_DEVNET_CAIP2;
  const facilitator = process.env.XRAY_FACILITATOR || cfg.facilitator || (network === 'mainnet' ? 'https://facilitator.payai.network' : 'https://x402.org/facilitator');
  return { network, caip2, payTo, price, facilitator, enabled: Boolean(payTo) };
})();

// token: env first, then the gh CLI (read-only use, never logged)
let TOKEN = process.env.GITHUB_TOKEN || '';
function loadToken() {
  return new Promise(res => {
    if (TOKEN) return res();
    execFile('gh', ['auth', 'token'], { timeout: 8000 }, (err, out) => { if (!err && out.trim()) TOKEN = out.trim(); res(); });
  });
}

// ---------- GitHub API ----------
async function gh(url) {
  const headers = { 'User-Agent': 'repo-xray/' + VERSION, Accept: 'application/vnd.github.star+json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const r = await fetch(url, { headers });
  if (r.status === 404) throw Object.assign(new Error('not found'), { code: 404 });
  if (r.status === 403 || r.status === 429) throw Object.assign(new Error('GitHub rate limit reached; try again in a few minutes'), { code: 429 });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${url.replace('https://api.github.com', '')}`);
  return r.json();
}
const API = 'https://api.github.com';

// ---------- git ----------
function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, ...opts }, (err, out, errOut) => err ? rej(new Error(errOut || err.message)) : res(out));
  });
}
async function gitLog(url, dir) {
  const bare = path.join(dir, 'repo.git');
  await run('git', ['clone', '--bare', '--quiet', '--filter=blob:none', '--single-branch', url, bare], { timeout: CLONE_TIMEOUT });
  const out = await run('git', ['--git-dir', bare, 'log', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI', '--no-merges', '--date-order', 'HEAD'], { timeout: 60000 });
  const merges = (await run('git', ['--git-dir', bare, 'rev-list', '--merges', '--count', 'HEAD'], { timeout: 60000 })).trim();
  const commits = out.split('\n').filter(Boolean).map(l => { const [h, an, ae, aI, cn, ce, cI] = l.split('\x1f'); return { h, an, ae, aI, cn, ce, cI }; });
  return { commits, merges: Number(merges) };
}
async function gitTree(url, dir) {
  const work = path.join(dir, 'work');
  await run('git', ['clone', '--depth', '1', '--quiet', '--single-branch', url, work], { timeout: CLONE_TIMEOUT });
  return collectFiles(work);
}

// ---------- collect + check ----------
function parseRepo(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/) || s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

async function xray(owner, name) {
  const repo = await gh(`${API}/repos/${owner}/${name}`);
  if (repo.fork) return { error: 'This is a fork. Paste the repository it was forked from.', repo: slim(repo) };
  if (repo.size > MAX_REPO_KB) return { error: `This repository is ${(repo.size / 1024).toFixed(0)} MB on GitHub. The X-ray stops at ${MAX_REPO_KB / 1024} MB.`, repo: slim(repo) };
  const url = `https://github.com/${repo.owner.login}/${repo.name}.git`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-'));
  try {
    const [ownerUser, forks, pulls, stars, log, tree] = await Promise.all([
      gh(`${API}/users/${repo.owner.login}`),
      gh(`${API}/repos/${owner}/${name}/forks?per_page=100&sort=newest`),
      gh(`${API}/repos/${owner}/${name}/pulls?state=all&per_page=100`),
      gh(`${API}/repos/${owner}/${name}/stargazers?per_page=100`).catch(() => []),
      gitLog(url, dir),
      gitTree(url, dir),
    ]);
    // noreply ids that are not the owner: who are they now? (up to 5 lookups)
    const ids = new Set();
    for (const c of log.commits) { const m = c.ae.match(/^(\d+)\+/); if (m && String(m[1]) !== String(ownerUser.id)) ids.add(m[1]); }
    const idLogins = {};
    await Promise.all([...ids].slice(0, 5).map(async id => { try { idLogins[id] = (await gh(`${API}/user/${id}`)).login; } catch {} }));

    const data = {
      commits: log.commits, repo, owner: ownerUser, idLogins,
      forks: forks.map(f => ({ t: Date.parse(f.created_at), login: f.owner.login })),
      pulls: pulls.map(p => ({ t: Date.parse(p.created_at), login: p.user.login })),
      stars: (Array.isArray(stars) ? stars : []).map(s => ({ t: Date.parse(s.starred_at), login: s.user?.login || '' })),
    };
    const history = runAll(data);
    const [claims, copies] = await Promise.all([checkClaims(tree), findCopies(repo, tree.readme)]);
    const checks = [...history.checks, claims];
    const authors = new Map();
    for (const c of log.commits) authors.set(c.ae, (authors.get(c.ae) || 0) + 1);
    return {
      ...grade(checks), checks, copies,
      repo: slim(repo),
      owner: { login: ownerUser.login, id: ownerUser.id, name: ownerUser.name, type: ownerUser.type, created_at: ownerUser.created_at, followers: ownerUser.followers, public_repos: ownerUser.public_repos },
      stats: { commits: log.commits.length, merges: log.merges, authors: authors.size, forks: forks.length, pulls: pulls.length, stars_sampled: data.stars.length, files: tree.files.length },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// a local repository with synthetic metadata (the README's demo): same checks, no GitHub or token lookups
async function xrayLocal(dir, meta) {
  const out = await run('git', ['-C', dir, 'log', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI', '--no-merges', '--date-order', 'HEAD'], { timeout: 60000 });
  const commits = out.split('\n').filter(Boolean).map(l => { const [h, an, ae, aI, cn, ce, cI] = l.split('\x1f'); return { h, an, ae, aI, cn, ce, cI }; });
  const tree = collectFiles(dir);
  const history = runAll({ commits, repo: meta.repo, owner: meta.owner, idLogins: {}, forks: [], pulls: [], stars: [] });
  const claims = await checkClaims(tree);
  const checks = [...history.checks, claims];
  const crowd = checks.find(c => c.id === 'crowd');
  if (crowd && !crowd.level) { crowd.headline = 'Nothing to read.'; crowd.evidence = ['A local demo has no forks, pull requests or stars, so this check has nothing to score.']; }
  return {
    ...grade(checks), checks, synthetic: true,
    copies: { queries: [], searched: 0, count: 0, young: 0, first: null, top_mcap: 0, volume_24h: 0, tokens: [], note: 'Synthetic demo: no token lookup.' },
    repo: meta.repo, owner: meta.owner,
    stats: { commits: commits.length, merges: 0, authors: new Set(commits.map(c => c.ae)).size, forks: 0, pulls: 0, stars_sampled: 0, files: tree.files.length },
    checked_at: new Date().toISOString(), version: VERSION,
  };
}
// same rule as checks.js, over six checks
function grade(checks) {
  const flags = checks.filter(c => c.level === 2).length;
  const notes = checks.filter(c => c.level === 1).length;
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (flags >= 2 || (flags === 1 && notes >= 2)) return { grade: 'DRESSED UP', line: `${n(flags, 'check')} flagged, ${n(notes, 'note')}. The history looks staged. Read the lines before you decide.` };
  if (flags === 1 || notes >= 2) return { grade: 'LOOK CLOSER', line: `${flags ? '1 check flagged, ' : ''}${n(notes, 'note')}. Could be a migration, could be a costume.` };
  return { grade: 'CLEAN', line: notes ? '1 note, nothing flagged.' : 'Nothing flagged in six checks. That is not proof of anything else.' };
}
function slim(r) {
  return { full_name: r.full_name, html_url: r.html_url, name: r.name, description: r.description, created_at: r.created_at, pushed_at: r.pushed_at, stargazers_count: r.stargazers_count, forks_count: r.forks_count, size: r.size, language: r.language, default_branch: r.default_branch };
}

// ---------- cache ----------
function cachePath(owner, name) { return path.join(CACHE, `${owner}__${name}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '_') + '.json'); }
function readCache(owner, name, any = false) {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(owner, name), 'utf8'));
    if (j.version !== VERSION) return null; // a result from an older build is re-run, never shown
    if (any || Date.now() - Date.parse(j.checked_at) < CACHE_TTL) return j;
  } catch {}
  return null;
}
function recent(limit = 12) {
  return fs.readdirSync(CACHE).filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch { return null; } })
    .filter(j => j && !j.error && j.repo)
    .sort((a, b) => Date.parse(b.checked_at) - Date.parse(a.checked_at)).slice(0, limit)
    .map(j => ({ full_name: j.repo.full_name, grade: j.grade, checked_at: j.checked_at, flags: j.checks.filter(c => c.level === 2).length, notes: j.checks.filter(c => c.level === 1).length }));
}
const inflight = new Map();
async function check(p, fresh) {
  const key = `${p.owner}/${p.name}`.toLowerCase();
  if (!fresh) { const c = readCache(p.owner, p.name); if (c) return c; }
  if (!inflight.has(key)) {
    inflight.set(key, xray(p.owner, p.name).then(r => ({ ...r, checked_at: new Date().toISOString(), version: VERSION })).finally(() => inflight.delete(key)));
  }
  const out = await inflight.get(key);
  if (!out.error) fs.writeFileSync(cachePath(p.owner, p.name), JSON.stringify(out));
  return out;
}

// ---------- http ----------
const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// /r/owner/name: the same page with the result's title and description in the <head>, so a pasted link previews
function sharePage(p) {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const c = readCache(p.owner, p.name, true);
  const title = c && !c.error ? `${c.repo.full_name}: ${c.grade} — REPO X-RAY` : `${p.owner}/${p.name} — REPO X-RAY`;
  const desc = c && !c.error ? `${c.line} ${c.checks.filter(x => x.level === 2).map(x => x.name).join(', ') || 'No flags'}.` : 'Six checks on a repository, each with its evidence.';
  return html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escHtml(desc)}"><meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}">`);
}
// the free route: a few per hour per address, so the paid route is the one a bot uses
const freeHits = new Map();
function freeAllowed(ip) {
  const now = Date.now();
  const hits = (freeHits.get(ip) || []).filter(t => now - t < 3600000);
  if (hits.length >= FREE_PER_HOUR) { freeHits.set(ip, hits); return false; }
  hits.push(now); freeHits.set(ip, hits); return true;
}
function errorOut(res, e) {
  const code = e.code === 404 ? 404 : e.code === 429 ? 429 : 500;
  res.status(code).json({ error: code === 404 ? 'No such repository on GitHub (or it is private).' : e.message.split('\n')[0].slice(0, 300) });
}
async function handleXray(req, res, paid) {
  const p = parseRepo(req.query.repo);
  if (!p) return res.status(400).json({ error: 'Paste a GitHub repository link, like https://github.com/owner/name' });
  if (!paid && !freeAllowed(req.ip) && !readCache(p.owner, p.name)) {
    return res.status(429).json({ error: `The free route allows ${FREE_PER_HOUR} checks an hour. Agents: GET /api/v1/xray pays ${PAY.price} USDC per call over x402.` });
  }
  try {
    const out = await check(p, 'fresh' in req.query);
    res.status(out.error ? 422 : 200).json(out);
  } catch (e) { errorOut(res, e); }
}

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

if (PAY.enabled) {
  const facilitator = new HTTPFacilitatorClient({ url: PAY.facilitator });
  const resourceServer = new x402ResourceServer(facilitator).register(PAY.caip2, new ExactSvmScheme());
  app.use(paymentMiddleware({
    'GET /api/v1/xray': {
      accepts: [{ scheme: 'exact', price: PAY.price, network: PAY.caip2, payTo: PAY.payTo, maxTimeoutSeconds: 120 }],
      description: 'REPO X-RAY: six checks on a GitHub repository, each with its evidence. ?repo=owner/name',
      mimeType: 'application/json',
    },
  }, resourceServer));
  app.get('/api/v1/xray', (req, res) => handleXray(req, res, true));
} else {
  app.get('/api/v1/xray', (req, res) => res.status(503).json({ error: 'The paid route is off: no payTo address is configured.' }));
}
app.get('/api/xray', (req, res) => handleXray(req, res, false));
app.get('/api/recent', (req, res) => res.json(recent()));
// GitHub's own count of calls left this hour (the /rate_limit call itself is free), read at most once a minute
let rateCache = { at: 0, core: null };
async function rateLimit() {
  if (Date.now() - rateCache.at < 60000) return rateCache.core;
  try { const j = await gh(`${API}/rate_limit`); rateCache = { at: Date.now(), core: { remaining: j.resources.core.remaining, limit: j.resources.core.limit, reset: j.resources.core.reset } }; }
  catch { rateCache = { at: Date.now(), core: null }; }
  return rateCache.core;
}
function cachedCount() {
  try { return fs.readdirSync(CACHE).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch { return null; } })
    .filter(j => j && j.version === VERSION && Date.now() - Date.parse(j.checked_at) < CACHE_TTL).length; } catch { return 0; }
}
app.get('/api/health', async (req, res) => res.json({
  ok: true, version: VERSION, token: Boolean(TOKEN), github: await rateLimit(), cached: cachedCount(),
  paid: PAY.enabled ? { network: PAY.network, price: PAY.price, payTo: PAY.payTo, facilitator: PAY.facilitator, route: 'GET /api/v1/xray?repo=owner/name' } : null,
}));
app.get(/^\/r\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/, (req, res) => res.type('html').send(sharePage({ owner: req.params[0], name: req.params[1] })));
app.use(express.static(PUBLIC, { index: 'index.html' }));
app.use((req, res) => res.status(404).type('text').send('not found'));

// `node server.js --check owner/name` prints one result and exits (for tests)
const checkArg = process.argv.indexOf('--check');
const localArg = process.argv.indexOf('--check-local');
if (localArg > -1) {
  const metaArg = process.argv.indexOf('--meta');
  const meta = JSON.parse(fs.readFileSync(process.argv[metaArg + 1], 'utf8'));
  xrayLocal(process.argv[localArg + 1], meta).then(r => { console.log(JSON.stringify(r, null, 1)); process.exit(0); }, e => { console.error(e.message); process.exit(1); });
} else if (checkArg > -1) {
  const p = parseRepo(process.argv[checkArg + 1]);
  loadToken().then(() => xray(p.owner, p.name)).then(r => { console.log(JSON.stringify(r, null, 1)); process.exit(0); }, e => { console.error(e.message); process.exit(1); });
} else {
  loadToken().then(() => app.listen(PORT, () => console.log(`repo-xray v${VERSION} on http://localhost:${PORT} (token: ${TOKEN ? 'yes' : 'no'}; paid route: ${PAY.enabled ? `${PAY.network} ${PAY.price} → ${PAY.payTo}` : 'off'})`)));
}
