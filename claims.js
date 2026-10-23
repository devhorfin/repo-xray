// REPO X-RAY slice 2 — Claims (README vs code) and Copies (tokens carrying the repo's name).
// checkClaims() is the sixth check and joins the grade. findCopies() is context, not a score.
'use strict';
const fs = require('fs');
const path = require('path');

const CODE_EXT = new Set(['.rs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.sol', '.move', '.toml', '.yaml', '.yml', '.sh', '.c', '.cpp', '.h', '.java', '.kt', '.swift', '.rb', '.php', '.cs', '.vy', '.cairo', '.json']);
const ONCHAIN_EXT = new Set(['.rs', '.sol', '.move', '.vy', '.cairo']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', 'vendor', '.next', 'out', 'coverage', '__pycache__', '.venv', 'venv']);
const MAX_FILES = 4000, MAX_FILE = 512 * 1024;
const ANCHOR_PLACEHOLDERS = new Set(['Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS', '11111111111111111111111111111111']);
const INTEGRATIONS = ['Raydium', 'Jupiter', 'Meteora', 'Orca', 'pump.fun', 'PumpSwap', 'Uniswap', 'Aave', 'Compound', 'Chainlink', 'Pyth', 'Switchboard', 'Metaplex', 'Jito', 'Helius', 'QuickNode', 'Wormhole', 'LayerZero', 'OpenAI', 'Anthropic', 'Claude', 'Gemini', 'Llama', 'Telegram', 'Discord', 'Stripe', 'Coinbase', 'Binance', 'Phantom', 'Squads', 'Marinade', 'Kamino', 'Drift', 'Tensor', 'Magic Eden'];

// ---------- file collection ----------
function collectFiles(root) {
  const files = []; let readme = ''; let readmePath = '';
  const walk = (dir, depth) => {
    if (files.length >= MAX_FILES || depth > 12) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files.length >= MAX_FILES) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      const rel = path.relative(root, p).split(path.sep).join('/');
      const ext = path.extname(e.name).toLowerCase();
      if (!readme && /^readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(e.name) && depth === 0) { readme = safeRead(p); readmePath = rel; continue; }
      if (!CODE_EXT.has(ext) || /(^|\/)(package-lock|yarn|pnpm-lock|Cargo\.lock|poetry\.lock)/i.test(rel)) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size > MAX_FILE) continue;
      files.push({ path: rel, ext, text: safeRead(p), test: /(^|\/)(tests?|__tests__|spec|e2e)\//i.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel) });
    }
  };
  walk(root, 0);
  return { files, readme, readmePath };
}
function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// ---------- README sentences ----------
function sentences(md) {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>|]/g, ' ').replace(/[ \t]+/g, ' ');
  return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length >= 12);
}
function quote(s) { return s.length > 150 ? s.slice(0, 147).trim() + '…' : s; }

// ---------- probes ----------
const MONEY_RE = /\b(deploy|deploys|deploying|pull|pulls|move|moves|transfer|transfers|release|releases|send|sends|pay|pays|payout|payouts|distribute|distributes|allocate|allocates|buy|buys|buyback|buybacks|burn|burns|swap|swaps|route|routes|stake|stakes|collect|collects)\b[^.\n]{0,50}\b(reserve|capital|funds?|liquidity|tokens?|SOL|USDC|ETH|BTC|fees?|rewards?|money|lamports|treasury|yield|dividends?)\b/i;
// the README speaking of a program of its own, not of other people's chains in general
const OWN_PROGRAM_RE = /\b(our|the|this|its)\s+(on-?chain\s+)?(solana\s+|anchor\s+|smart\s+)?(program|contract)s?\b|\bprogram\s+id\b|\bdeclare_id\b|\bprogram\s+(is|are|was|targets?|runs?|lives?)\b/i;
const MOVEMENT_ONCHAIN_RE = /invoke_signed\s*\(|\binvoke\s*\(|CpiContext|token::transfer|transfer_checked|system_program::transfer|anchor_spl::token|spl_token::instruction|\.transfer\s*\(|\.call\s*\{\s*value|safeTransfer|IERC20|transferFrom\s*\(|coin::transfer|0x1::coin/;
const MOVEMENT_CLIENT_RE = /SystemProgram\.transfer|createTransferInstruction|getTransferInstruction|createTransferCheckedInstruction|sendAndConfirmTransaction|signAndSendTransaction|sendTransaction\s*\(|sendRawTransaction|TransactionInstruction|VersionedTransaction|ethers\.|web3\.eth\.sendTransaction|contract\.methods/;
const IMPLEMENTED_RE = /\b(is|are|were|been|now|fully)\s+implemented\b/i;
const NOT_IMPLEMENTED_RE = /\bnot\s+(yet\s+)?implemented\b|\bimplemented\s+yet\b|\bunimplemented\b/i;
const MAINNET_RE = /\b(live|deployed|running)\s+on\s+mainnet\b|\bmainnet(-beta)?\s+(deployment|launch(ed)?|live)\b/i;
const AUDITED_RE = /\b(audited\s+by|security\s+audit(ed)?|audit\s+report|has\s+been\s+audited|fully\s+audited)\b/i;

function findProgramIds(files) {
  const ids = new Map(); // id -> where
  for (const f of files) {
    if (f.ext === '.rs') for (const m of f.text.matchAll(/declare_id!\s*\(\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"\s*\)/g)) ids.set(m[1], f.path);
    if (/(^|\/)Anchor\.toml$/.test(f.path)) for (const m of f.text.matchAll(/^\s*[\w-]+\s*=\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/gm)) if (!ids.has(m[1])) ids.set(m[1], f.path);
  }
  return ids;
}
async function programOnChain(id) {
  const ask = async (url) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [id, { encoding: 'base64' }] }) });
      const j = await r.json();
      if (j.error) return 'error';
      return j.result && j.result.value ? (j.result.value.executable ? 'program' : 'account') : 'none';
    } catch { return 'error'; } finally { clearTimeout(t); }
  };
  const [mainnet, devnet] = await Promise.all([ask('https://api.mainnet-beta.solana.com'), ask('https://api.devnet.solana.com')]);
  return { mainnet, devnet };
}

async function checkClaims({ files, readme, readmePath }) {
  const ev = [];
  let flags = 0, notes = 0;
  if (!readme) return { id: 'claims', name: 'Claims', level: 0, headline: 'No README to compare against.', evidence: ['The repository has no README at its root, so there are no written claims to check.'] };
  const sents = sentences(readme);
  const code = files.filter(f => !f.test);
  const onchain = code.filter(f => ONCHAIN_EXT.has(f.ext));
  const client = code.filter(f => !ONCHAIN_EXT.has(f.ext) && f.ext !== '.toml' && f.ext !== '.json' && f.ext !== '.yaml' && f.ext !== '.yml');

  // 1. money claims vs code that moves money. Only when the repo says or shows it runs something on chain;
  //    a feed or a client that merely describes other people's money moving has nothing to check against.
  const moneyClaims = sents.filter(s => MONEY_RE.test(s));
  const ownProgram = sents.filter(s => OWN_PROGRAM_RE.test(s));
  if (moneyClaims.length && !onchain.length) {
    const clHits = client.reduce((n, f) => n + (f.text.match(MOVEMENT_CLIENT_RE) || []).length, 0);
    if (clHits) ev.push(`The README describes money moving and the client code has ${clHits} transaction call${clHits === 1 ? '' : 's'} to back it (no program of its own; it drives someone else's).`);
    else if (!ownProgram.length) ev.push(`The README describes money moving ("${quote(moneyClaims[0])}") but claims no program or contract of its own, so there is nothing on chain to check it against.`);
  } else if (moneyClaims.length) {
    const onHits = onchain.reduce((n, f) => n + (f.text.match(MOVEMENT_ONCHAIN_RE) || []).length, 0);
    const clHits = client.reduce((n, f) => n + (f.text.match(MOVEMENT_CLIENT_RE) || []).length, 0);
    const where = onchain.length ? `${onchain.length} on-chain source file${onchain.length === 1 ? '' : 's'}` : 'no on-chain source files';
    if (onHits === 0 && clHits === 0) {
      ev.push(`The README says money moves ("${quote(moneyClaims[0])}"), but ${where} and ${client.length} client file${client.length === 1 ? '' : 's'} contain no transfer, CPI or transaction-sending call.`);
      flags++;
    } else if (onchain.length && onHits === 0) {
      ev.push(`The README says money moves ("${quote(moneyClaims[0])}"); the on-chain code (${where}) never transfers or invokes anything, only client code does (${clHits} call${clHits === 1 ? '' : 's'}).`);
      notes++;
    } else {
      ev.push(`The README describes money moving and the code has ${onHits + clHits} transfer or transaction call${onHits + clHits === 1 ? '' : 's'} to back it.`);
    }
  }
  // 2. speaks of a program of its own, but holds no program or contract source at all
  if (ownProgram.length && !onchain.length) {
    ev.push(`The README speaks of its own program ("${quote(ownProgram[0])}"), but the repository holds no program or contract source (.rs, .sol, .move, .vy, .cairo).`);
    flags++;
  }
  // 3. program id: placeholder or not on chain
  const ids = findProgramIds(files);
  for (const [id, where] of ids) {
    if (ANCHOR_PLACEHOLDERS.has(id)) {
      ev.push(`The program id in ${where} is ${id.slice(0, 8)}…, the placeholder from Anchor's project template. Nothing was ever deployed under it by this project.`);
      flags++;
      continue;
    }
    const on = await programOnChain(id);
    const say = (c, v) => v === 'program' ? `a program on ${c}` : v === 'account' ? `a non-program account on ${c}` : v === 'none' ? `nothing on ${c}` : `unreachable on ${c}`;
    ev.push(`Program id ${id.slice(0, 8)}… (${where}): ${say('mainnet', on.mainnet)}, ${say('devnet', on.devnet)}.`);
    if (on.mainnet === 'none' && on.devnet === 'none') {
      const claimsDeployed = sents.some(s => /\b(deployed|live|running|targets?)\b/i.test(s) && /\b(mainnet|devnet|solana)\b/i.test(s));
      if (claimsDeployed) { ev.push('The README speaks of a deployed program; the id it ships is not on either network.'); flags++; }
      else notes++;
    }
  }
  // 4. implemented vs not implemented
  const yes = sents.find(s => IMPLEMENTED_RE.test(s) && !NOT_IMPLEMENTED_RE.test(s));
  const no = sents.find(s => NOT_IMPLEMENTED_RE.test(s));
  if (yes && no) { ev.push(`The README says "${quote(yes)}" and also "${quote(no)}".`); notes++; }
  const mainnet = sents.find(s => MAINNET_RE.test(s));
  const devnetOnly = sents.find(s => /\bdevnet-only\b|\bonly\s+on\s+devnet\b|\bnot\s+(yet\s+)?(deployed|on\s+mainnet)\b/i.test(s));
  if (mainnet && devnetOnly) { ev.push(`The README says "${quote(mainnet)}" and also "${quote(devnetOnly)}".`); notes++; }
  // 5. audited?
  const audited = sents.find(s => AUDITED_RE.test(s) && !/\bunaudited\b|\bnot\s+(been\s+)?audited\b|\bno\s+audit\b/i.test(s));
  if (audited) {
    const hasAudit = files.some(f => /audit/i.test(f.path)) || /audit[^)\s]*\.pdf|\/audits?\//i.test(readme);
    if (!hasAudit) { ev.push(`The README says "${quote(audited)}", but no audit file or audit link is in the repository.`); notes++; }
  }
  // 6. named integrations the code never mentions
  const named = INTEGRATIONS.filter(n => new RegExp(`(^|[^\\w.])${n.replace('.', '\\.')}([^\\w]|$)`, 'i').test(readme));
  const missing = named.filter(n => !code.some(f => f.text.toLowerCase().includes(n.toLowerCase())));
  if (missing.length) {
    ev.push(`The README names ${missing.join(', ')}; the code never mentions ${missing.length === 1 ? 'it' : 'them'}.`);
    if (missing.length >= 2) notes++;
  }
  if (!ev.length) ev.push(`${sents.length} README sentences read; no money, deployment, audit or integration claim contradicts the code.`);

  const level = flags ? 2 : notes >= 2 ? 1 : notes === 1 && ev.length > 1 ? 1 : notes ? 1 : 0;
  const headline = level === 2 ? 'The README promises more than the code does.' : level === 1 ? 'The README and the code disagree in places.' : 'The README matches the code.';
  return { id: 'claims', name: 'Claims', level, headline, evidence: ev, stats: { files: files.length, onchain_files: onchain.length, sentences: sents.length } };
}

// ---------- copies: tokens carrying the repo's name ----------
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function titleOf(readme) {
  const m = readme.match(/^\s*#\s+(.+)$/m) || readme.match(/^([^\n]{3,80})\n=+\s*$/m);
  return m ? m[1].replace(/[`*_]/g, '').replace(/\s*\(.*?\)\s*$/, '').trim() : '';
}
async function findCopies(repo, readme) {
  const queries = new Map();
  const nameQ = repo.name.replace(/[-_]+/g, ' ').trim();
  if (nameQ.length >= 3) queries.set(norm(nameQ), nameQ);
  const title = titleOf(readme || '');
  if (title && title.length >= 3 && title.length <= 60 && !queries.has(norm(title))) queries.set(norm(title), title);
  const tokens = new Map();
  let searched = 0;
  for (const [key, q] of queries) {
    let j;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, headers: { 'User-Agent': 'repo-xray' } });
      clearTimeout(t);
      j = await r.json(); searched++;
    } catch { continue; }
    for (const p of j.pairs || []) {
      for (const side of ['baseToken', 'quoteToken']) {
        const tk = p[side]; if (!tk) continue;
        const tn = norm(tk.name), ts = norm(tk.symbol);
        const words = key.split(' ').length;
        const hit = tn === key || ts === key.replace(/ /g, '') || (words >= 2 && tn.includes(key));
        if (!hit) continue;
        const id = `${p.chainId}:${tk.address}`;
        const e = tokens.get(id) || { chain: p.chainId, address: tk.address, symbol: tk.symbol, name: tk.name, mcap: 0, vol24: 0, created: null, dexes: new Set(), url: p.url };
        e.mcap = Math.max(e.mcap, p.marketCap || p.fdv || 0);
        e.vol24 += (p.volume && p.volume.h24) || 0;
        if (p.pairCreatedAt && (!e.created || p.pairCreatedAt < e.created)) e.created = p.pairCreatedAt;
        e.dexes.add(p.dexId);
        tokens.set(id, e);
      }
    }
  }
  const list = [...tokens.values()].map(t => ({ ...t, dexes: [...t.dexes], created: t.created ? new Date(t.created).toISOString() : null })).sort((a, b) => b.mcap - a.mcap);
  const young = list.filter(t => t.created && Date.now() - Date.parse(t.created) < 30 * 86400000);
  return {
    queries: [...queries.values()], searched, count: list.length, young: young.length,
    first: list.filter(t => t.created).sort((a, b) => Date.parse(a.created) - Date.parse(b.created))[0]?.created || null,
    top_mcap: list[0]?.mcap || 0, volume_24h: list.reduce((s, t) => s + t.vol24, 0),
    tokens: list.slice(0, 10),
    note: 'DexScreener search, newest ~30 pairs per query. Names collide: a token carrying this name is not proof of anything about the repository.',
  };
}

module.exports = { collectFiles, checkClaims, findCopies, sentences };
