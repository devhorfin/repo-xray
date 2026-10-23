// Builds a SYNTHETIC repository whose history looks staged, so the README can show a DRESSED UP card
// without pointing at a real project. Every person, address and id here is made up; every email is
// on example.com (reserved, cannot belong to anyone).
//   node demo/make-staged-demo.mjs        → demo/staged-demo/ (a git repo; gitignored)
//   node server.js --check-local demo/staged-demo --meta demo/staged-demo.meta.json > public/demo/staged-demo.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'staged-demo');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
git(['init', '-q', '-b', 'main']);

// --- the files: a README that promises more than the code does ---
const files = {
  'README.md': `# Halcyon Liquidity Protocol

Halcyon keeps memecoin pools deep when traders panic. A council of agents watches each pool and the
reserve backstop deploys capital into pools whose depth falls below a floor.

**Status.** The risk engine and the on-chain program are implemented. The program targets devnet.

![architecture](docs/architecture.png)

The on-chain program is drawn dashed because it is not implemented yet.

## How it works
1. Agents attest to pool health every epoch.
2. The engine settles a regime: expand, watch, hedge or backstop.
3. In backstop, the program releases reserve funds into the pool.
`,
  'Anchor.toml': `[programs.devnet]\nhalcyon = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"\n\n[provider]\ncluster = "devnet"\n`,
  'programs/halcyon/src/lib.rs': `use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod halcyon {
    use super::*;
    // "Deploys reserve capital": only bumps a counter. No token transfer, no CPI.
    pub fn deploy_backstop(ctx: Context<Backstop>, amount: u64) -> Result<()> {
        ctx.accounts.reserve.deployed = ctx.accounts.reserve.deployed.saturating_add(amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Backstop<'info> {
    #[account(mut)]
    pub reserve: Account<'info, Reserve>,
    pub authority: Signer<'info>,
}

#[account]
pub struct Reserve { pub deployed: u64 }
`,
  'src/engine.ts': `export type Stance = 'healthy' | 'stressed' | 'abstain';
export function regime(votes: { stance: Stance; weight: number }[]): string {
  const s = votes.filter(v => v.stance === 'healthy').reduce((a, v) => a + v.weight, 0);
  const c = votes.filter(v => v.stance === 'stressed').reduce((a, v) => a + v.weight, 0);
  const d = s + c;
  if (d === 0) return 'backstop';
  const p = (s - c) / d;
  return Math.abs(p) >= 0.66 ? 'expand' : Math.min(s, c) / d >= 0.34 ? 'hedge' : 'watch';
}
`,
};
for (const [f, body] of Object.entries(files)) {
  fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), body);
}

// --- the history: one commit every ~6 days for 7 years, starting 2 days after the "account" was made ---
const OWNER_ID = 1000001;                       // synthetic GitHub user id of the "owner"
const OWNER_OLD_LOGIN = 'quietgrove';           // the account's "earlier login"
const people = [
  { name: 'Marcus Vell', email: `${OWNER_ID}+${OWNER_OLD_LOGIN}@users.noreply.github.com`, w: 0.82 }, // the owner, under another name
  { name: 'Ines Moreau', email: 'harperwalsh1988@example.com', w: 0.08 },
  { name: 'Tomas Reyes', email: 'quinnmercer0412@example.com', w: 0.06 },
  { name: 'Lena Brandt', email: 'averycollins77@example.com', w: 0.04 },
];
const subjects = ['chore: tidy the engine', 'docs: describe the output format in README.md', 'fix(engine): guard regime against empty input',
  'test: pin the watch threshold', 'chore: align Cargo.toml with the toolchain', 'refactor: rename the council', 'ci: cache the toolchain',
  'chore: refresh the reserve docs', 'feat(engine): expose the stress ratio', 'chore(license): re-apply the standard MIT wording'];
let seed = 7;
const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const pick = () => { let r = rand(), acc = 0; for (const p of people) { acc += p.w; if (r <= acc) return p; } return people[0]; };

const start = Date.UTC(2019, 2, 24, 8, 0, 0);   // 2019-03-24; "account created" 2019-03-22 (see meta)
const end = Date.UTC(2026, 9, 14, 12, 0, 0);
const DAY = 86400000;
git(['add', '-A']);
let t = start, i = 0;
while (t < end) {
  const p = pick();
  const authorDate = new Date(t).toISOString();
  const commitDate = new Date(t + (1 + Math.floor(rand() * 4)) * 3600000).toISOString(); // committer a few hours later
  const env = { GIT_AUTHOR_NAME: p.name, GIT_AUTHOR_EMAIL: p.email, GIT_AUTHOR_DATE: authorDate,
    GIT_COMMITTER_NAME: p.name, GIT_COMMITTER_EMAIL: p.email, GIT_COMMITTER_DATE: commitDate };
  if (i === 0) git(['commit', '-q', '-m', 'chore: initial import'], env);
  else git(['commit', '-q', '--allow-empty', '-m', subjects[i % subjects.length]], env);
  t += 5.8 * DAY + (rand() - 0.5) * 0.2 * DAY;   // a metronome: 5.8 days ± 2.4 h
  i++;
}
console.log(`synthetic staged repo: ${i} commits, ${new Date(start).toISOString().slice(0, 10)} → ${new Date(t).toISOString().slice(0, 10)}, in ${dir}`);
