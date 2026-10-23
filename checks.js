// REPO X-RAY — the five checks. Pure functions over data the server collected.
// Each check returns { id, name, level, headline, evidence[] } where
// level is 0 CLEAN, 1 NOTE, 2 FLAG. The grade never stands without the lines.
'use strict';

const DAY = 86400000;
const BOT_RE = /\[bot\]$|^dependabot|^github-actions|^renovate|^greenkeeper|^snyk-bot|^semantic-release/i;
const NOREPLY_RE = /^(?:(\d+)\+)?([^@+]+)@users\.noreply\.github\.com$/i;
const GENERIC_LOCAL = new Set(['git', 'dev', 'me', 'admin', 'info', 'mail', 'hello', 'contact', 'noreply',
  'no-reply', 'root', 'user', 'team', 'ops', 'support', 'github', 'code', 'hi', 'hey', 'i']);

function fmtDate(iso) { return iso ? String(iso).slice(0, 10) : '?'; }
function years(ms) { return (ms / (365.25 * DAY)).toFixed(1); }
function plural(n, w) { return `${n} ${w}${n === 1 ? '' : /(s|x|ch|sh)$/.test(w) ? 'es' : 's'}`; }
function isBot(c) { return BOT_RE.test(c.an) || BOT_RE.test(c.ae); }

// ---------- helpers over the commit list ----------
// commits: [{h, an, ae, aI, cn, ce, cI}] newest first, as git log prints it
function humanCommits(commits) { return commits.filter(c => !isBot(c)); }

function byAuthor(commits) {
  const m = new Map();
  for (const c of commits) {
    const k = `${c.an}\u0000${c.ae}`;
    const e = m.get(k) || { name: c.an, email: c.ae, n: 0 };
    e.n++; m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

// ---------- 1. CLOCK ----------
function checkClock({ commits, repo, owner }) {
  const ev = [];
  const hc = humanCommits(commits);
  if (!hc.length) return { id: 'clock', name: 'Clock', level: 0, headline: 'No commits to date.', evidence: ev };
  const authorDates = hc.map(c => Date.parse(c.aI)).filter(Number.isFinite);
  const first = Math.min(...authorDates);
  const repoCreated = Date.parse(repo.created_at);
  const acctCreated = Date.parse(owner.created_at);
  const span = Math.max(...authorDates) - first;
  ev.push(`First commit ${fmtDate(new Date(first).toISOString())}; repository created on GitHub ${fmtDate(repo.created_at)} (${years(repoCreated - first)} years later); account created ${fmtDate(owner.created_at)}.`);
  const diffCount = hc.filter(c => c.aI !== c.cI).length;
  const offsets = hc.filter(c => c.aI !== c.cI).map(c => Math.abs(Date.parse(c.cI) - Date.parse(c.aI)) / 3600000);
  if (hc.length >= 20 && diffCount) {
    const maxOff = Math.max(...offsets);
    ev.push(`Author and committer dates differ on ${diffCount} of ${hc.length} commits` + (maxOff <= 48 ? ` (by up to ${maxOff.toFixed(1)} h).` : ' (rebases, cherry-picks and imports do this).'));
  }
  let level = 0;
  const isOrg = owner.type === 'Organization';
  const daysBeforeAcct = (acctCreated - first) / DAY;
  const daysAfterAcct = (first - acctCreated) / DAY;
  const repoGapYears = (repoCreated - first) / (365.25 * DAY);
  if (daysBeforeAcct > 0 && !isOrg) {
    ev.push(`The history starts ${plural(Math.round(daysBeforeAcct), 'day')} before the owner's GitHub account existed. Normal for work imported from elsewhere; unusual for an original project.`);
    level = Math.max(level, 1);
  } else if (daysBeforeAcct > 0) {
    ev.push(`The history predates the organisation account; organisations are often created to house an existing project.`);
  }
  if (!isOrg && repoGapYears >= 1 && daysAfterAcct >= 0 && daysAfterAcct <= 14 && span > 365 * DAY) {
    ev.push(`The history begins ${plural(Math.round(daysAfterAcct), 'day')} after the account was created, then waits ${repoGapYears.toFixed(1)} years before the repository appears on GitHub.`);
    level = 2;
  } else if (repoGapYears >= 1) {
    ev.push(`${repoGapYears.toFixed(1)} years of history were pushed into a repository created later. Common for migrations and mirrors; worth a look alongside the other checks.`);
    level = Math.max(level, 1);
  }
  if (hc.length >= 50 && diffCount / hc.length > 0.9 && offsets.length && Math.max(...offsets) <= 8) {
    ev.push(`Nearly every commit carries a committer date a few hours after its author date. Plain commits normally carry the same time twice; rebases change it, but not uniformly across the whole history.`);
    level = Math.max(level, 1);
  }
  const headline = level === 2 ? 'The dates don\'t add up.' : level === 1 ? 'Old history, new repository.' : 'Dates line up.';
  return { id: 'clock', name: 'Clock', level, headline, evidence: ev };
}

// ---------- 2. METRONOME ----------
function checkMetronome({ commits }) {
  const ev = [];
  const hc = humanCommits(commits);
  if (hc.length < 30) return { id: 'metronome', name: 'Metronome', level: 0, headline: `Too few commits to read a rhythm (${hc.length}).`, evidence: ev };
  const dates = hc.map(c => Date.parse(c.aI)).filter(Number.isFinite).sort((a, b) => a - b);
  // per full calendar year
  const perYear = new Map();
  for (const t of dates) { const y = new Date(t).getUTCFullYear(); perYear.set(y, (perYear.get(y) || 0) + 1); }
  const ys = [...perYear.keys()].sort();
  const full = ys.slice(1, -1); // drop the partial first and last years
  let level = 0;
  if (full.length >= 3) {
    const counts = full.map(y => perYear.get(y));
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length);
    const cv = mean ? sd / mean : 0;
    ev.push(`Commits per full year: ${full.map(y => `${y}: ${perYear.get(y)}`).join(', ')}.`);
    if (cv < 0.12) { ev.push(`That curve is flat (variation ${(cv * 100).toFixed(0)}%). Real projects are lumpy: releases, holidays, lost interest.`); level = 2; }
    else if (cv < 0.3) { ev.push(`Fairly even year to year (variation ${(cv * 100).toFixed(0)}%).`); level = 1; }
  } else {
    ev.push(`History covers ${ys[0]}–${ys[ys.length - 1]}: ${ys.map(y => `${y}: ${perYear.get(y)}`).join(', ')}.`);
  }
  // spacing between commits
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / DAY);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mad = [...gaps.map(g => Math.abs(g - median))].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (median >= 1 && hc.length >= 50) {
    const spread = median ? mad / median : 1;
    ev.push(`Typical gap between commits: ${median.toFixed(1)} days (half of all gaps within ±${mad.toFixed(1)} days of that).`);
    if (spread < 0.2) { ev.push('Commits land on a near-fixed interval. Humans don\'t; schedulers do.'); level = 2; }
    else if (spread < 0.4) level = Math.max(level, 1);
  } else if (hc.length >= 50) {
    ev.push(`Typical gap between commits: under a day (bursty, like real work).`);
  }
  // weekday shape, as evidence only
  const wd = [0, 0, 0, 0, 0, 0, 0];
  for (const t of dates) wd[new Date(t).getUTCDay()]++;
  const weekend = wd[0] + wd[6];
  ev.push(`${Math.round(100 * weekend / dates.length)}% of commits fall on weekends.`);
  const headline = level === 2 ? 'A schedule, not a person.' : level === 1 ? 'Unusually even.' : 'Lumpy, like real work.';
  return { id: 'metronome', name: 'Metronome', level, headline, evidence: ev };
}

// ---------- 3. NAMES ----------
function strip(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function allTokens(name) { return strip(name).split(/[^a-z]+/).filter(Boolean); }
function nameTokens(name) { return allTokens(name).filter(t => t.length >= 3); }
function localPart(email) { return strip(email.split('@')[0]).replace(/[^a-z]/g, ''); }
// true when the email could plausibly belong to this name (nicknames and initials count as plausible)
function nameMatchesEmail(name, email) {
  const local = localPart(email);
  if (!local || GENERIC_LOCAL.has(local)) return true; // nothing to compare
  const all = allTokens(name), toks = nameTokens(name);
  if (!all.length) return true;
  if (toks.some(t => local.includes(t))) return true;
  if (all.some(t => t.length >= 2 && t.includes(local) && local.length >= 2)) return true; // "rob" in "robert", "tj" in "tj"
  const initials = all.map(t => t[0]).join('');
  const last = all[all.length - 1];
  if (local === initials || local.startsWith(all[0][0] + last) || local.startsWith(all[0] + last[0])) return true;
  return false;
}
// a handle that reads like somebody else's full name: long, mostly letters, no token of the author's name
function looksLikeAnotherName(name, email) {
  if (nameMatchesEmail(name, email)) return false;
  const raw = strip(email.split('@')[0]);
  const letters = raw.replace(/[^a-z]/g, '');
  return letters.length >= 9 && /^[a-z.]+\d{0,6}$/.test(raw);
}
// two display names on one address or id: the same person, or two different names?
function sameName(a, b) {
  const sa = strip(a).replace(/[^a-z]/g, ''), sb = strip(b).replace(/[^a-z]/g, '');
  if (!sa || !sb || sa.includes(sb) || sb.includes(sa)) return true;
  const ta = nameTokens(a), tb = nameTokens(b);
  return ta.some(t => tb.some(u => u.includes(t) || t.includes(u)));
}

function checkNames({ commits }) {
  const ev = [];
  const hc = humanCommits(commits);
  const authors = byAuthor(hc).filter(a => !NOREPLY_RE.test(a.email) && a.email.includes('@'));
  const total = hc.length || 1;
  const bad = authors.filter(a => looksLikeAnotherName(a.name, a.email));
  const badShare = bad.reduce((s, a) => s + a.n, 0) / total;
  const ratio = authors.length ? bad.length / authors.length : 0;
  let level = 0;
  if (bad.length >= 3 && ratio >= 0.6) level = 2;
  else if (bad.length >= 2 && ratio >= 0.4) level = 1;
  if (level) for (const a of bad.slice(0, 6)) ev.push(`${a.name} (${plural(a.n, 'commit')}) commits as ${a.email}.`);
  if (!authors.length) ev.push('Every commit uses a GitHub-generated address (see Masks).');
  else if (!bad.length) ev.push(`${plural(authors.length, 'author')} with ordinary addresses; no address reads like a different person's name.`);
  else ev.push(`${bad.length} of ${authors.length} authors commit from an address that reads like a different person's name (${Math.round(badShare * 100)}% of commits). Nicknames and initials are not counted.`);
  const headline = level === 2 ? 'Names and addresses don\'t belong together.' : level === 1 ? 'Some names don\'t match.' : 'Names match their addresses.';
  return { id: 'names', name: 'Names', level, headline, evidence: ev };
}

// ---------- 4. MASKS ----------
function checkMasks({ commits, owner, idLogins }) {
  const ev = [];
  const hc = humanCommits(commits);
  const total = hc.length || 1;
  // group noreply commits by id (or login for the old form)
  const groups = new Map();
  for (const c of hc) {
    const m = c.ae.match(NOREPLY_RE);
    if (!m) continue;
    const id = m[1] || null, login = m[2];
    const key = id || `login:${login}`;
    const g = groups.get(key) || { id, login, names: new Map(), n: 0 };
    g.n++; g.names.set(c.an, (g.names.get(c.an) || 0) + 1);
    groups.set(key, g);
  }
  let level = 0;
  const ownerLogin = strip(owner.login);
  for (const g of groups.values()) {
    const names = [...g.names.entries()].sort((a, b) => b[1] - a[1]);
    const isOwner = g.id ? String(g.id) === String(owner.id) : strip(g.login) === ownerLogin;
    const loginDiffers = strip(g.login) !== ownerLogin;
    const ownerNames = new Set([strip(owner.login), strip(owner.name || '')].filter(Boolean));
    const ownerLabels = [owner.login, owner.name || ''].filter(Boolean);
    const foreignNames = names.filter(([n]) => !ownerLabels.some(o => sameName(n, o)) && !sameName(n, g.login));
    if (isOwner && foreignNames.length) {
      const who = foreignNames.map(([n, k]) => `${n} (${plural(k, 'commit')})`).join(', ');
      ev.push(`${who} commit${foreignNames.length === 1 ? 's' : ''} with the repository owner's own GitHub address (user ${g.id || g.login}${loginDiffers ? `, under the earlier login "${g.login}"` : ''}), and that is not the owner's name.`);
      const share = foreignNames.reduce((s, [, k]) => s + k, 0) / total;
      if (share >= 0.1) level = 2; else level = Math.max(level, 1);
    } else {
      // several display names on one id: only count names that don't look like the same person
      const distinct = [];
      for (const [n, k] of names) if (k >= 5 && !sameName(n, g.login) && !distinct.some(([d]) => sameName(n, d))) distinct.push([n, k]);
      if (distinct.length >= 2) {
        ev.push(`One GitHub user (${g.login}${g.id ? `, id ${g.id}` : ''}) commits under ${distinct.length} unrelated names: ${distinct.map(([n, k]) => `${n} (${k})`).join(', ')}.`);
        level = Math.max(level, 1);
      }
    }
  }
  if (!ev.length) ev.push(groups.size ? `${plural(groups.size, 'GitHub address')} in the history, each under its own name.` : 'No GitHub-generated addresses in the history.');
  const headline = level === 2 ? 'The owner commits under another name.' : level === 1 ? 'One address, several names.' : 'No masks.';
  return { id: 'masks', name: 'Masks', level, headline, evidence: ev };
}

// ---------- 5. CROWD ----------
const LOOKALIKE_RE = /^[a-z]+\d{2,}$|^[a-z]+[a-z]*\d{3,}$|^[A-Z][a-z]+\d{3,}$/;
function bursts(events, windowMs) {
  // events: [{t, login}] -> largest set within any window
  const s = events.filter(e => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
  let best = { n: 0, from: null, to: null, logins: [] };
  for (let i = 0, j = 0; i < s.length; i++) {
    while (j < s.length && s[j].t - s[i].t <= windowMs) j++;
    if (j - i > best.n) best = { n: j - i, from: s[i].t, to: s[j - 1].t, logins: s.slice(i, j).map(e => e.login) };
  }
  return best;
}
function hhmm(t) { return new Date(t).toISOString().slice(11, 16); }

function checkCrowd({ forks = [], pulls = [], stars = [], repo = {} }) {
  const ev = [];
  let level = 0;
  if (!stars.length && repo.stargazers_count > 0) ev.push(`GitHub did not return the star list for this repository (${repo.stargazers_count} stars shown); forks and pull requests were checked.`);
  const kinds = [['fork', forks], ['pull request', pulls], ['star', stars]];
  for (const [kind, list] of kinds) {
    if (list.length < 6) continue;
    const b = bursts(list, 4 * 3600000);
    const distinct = new Set(b.logins);
    const look = [...distinct].filter(l => LOOKALIKE_RE.test(l));
    const saturated = list.length >= 100 && b.n >= list.length * 0.9; // a popular repo gets 100 forks an hour; that isn't a burst
    if (saturated && look.length / Math.max(distinct.size, 1) < 0.5) {
      ev.push(`The newest 100 ${kind}s all arrived within ${Math.max(1, Math.round((b.to - b.from) / 3600000))} h: the sample is too small to tell a burst from a busy repository.`);
      continue;
    }
    if (b.n >= 6 && b.n / list.length >= 0.5) {
      const ex = look.slice(0, 3).join(', ') || [...distinct].slice(0, 3).join(', ');
      ev.push(`${b.n} of ${plural(list.length, kind)} arrived between ${fmtDate(new Date(b.from).toISOString())} ${hhmm(b.from)} and ${hhmm(b.to)} UTC` + (look.length ? `; ${look.length} of them from accounts like ${ex}.` : ` (e.g. ${ex}).`));
      if (look.length >= 4 && look.length / distinct.size >= 0.5) level = 2; else level = Math.max(level, 1);
    } else if (look.length >= 5 && look.length / distinct.size >= 0.6) {
      ev.push(`${look.length} of ${distinct.size} ${kind} accounts follow a name-plus-digits pattern (${look.slice(0, 3).join(', ')}).`);
      level = Math.max(level, 1);
    }
  }
  if (!level) ev.push(`${plural(forks.length, 'fork')}, ${plural(pulls.length, 'pull request')}, ${plural(stars.length, 'star')} checked (newest 100 of each); no bunching, no lookalike accounts.`);
  const headline = level === 2 ? 'A crowd that arrived together.' : level === 1 ? 'Some bunching.' : 'An ordinary crowd.';
  return { id: 'crowd', name: 'Crowd', level, headline, evidence: ev };
}

// ---------- grade ----------
function grade(checks) {
  const flags = checks.filter(c => c.level === 2).length;
  const notes = checks.filter(c => c.level === 1).length;
  if (flags >= 2 || (flags === 1 && notes >= 2)) return { grade: 'DRESSED UP', line: `${plural(flags, 'check')} flagged, ${plural(notes, 'note')}. The history looks staged. Read the lines before you decide.` };
  if (flags === 1 || notes >= 2) return { grade: 'LOOK CLOSER', line: `${flags ? '1 check flagged, ' : ''}${plural(notes, 'note')}. Could be a migration, could be a costume.` };
  return { grade: 'CLEAN', line: notes ? '1 note, nothing flagged.' : 'Nothing flagged in five checks. That is not proof of anything else.' };
}

function runAll(data) {
  const checks = [checkClock(data), checkMetronome(data), checkNames(data), checkMasks(data), checkCrowd(data)];
  return { ...grade(checks), checks };
}

module.exports = { runAll, checkClock, checkMetronome, checkNames, checkMasks, checkCrowd, nameMatchesEmail, isBot };
