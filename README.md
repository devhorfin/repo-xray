# REPO X-RAY

Paste a GitHub link, get six checks on the repository (five on its history, one on its README against its code), each with its evidence, plus the tokens on DexScreener that carry its name.
Plan: slices 1–3 built (history checks, README-vs-code + copycat tokens, x402 pay-per-call); slice 4 (a feed of every repo that gets a coin) not started.

## Run

```bash
node server.js
```

Opens on http://localhost:5480. One-off from the terminal: `node server.js --check owner/name`.

A GitHub token lifts the API limit from 60 to 5,000 requests an hour: set `GITHUB_TOKEN`, or the server
borrows `gh auth token` at start (read-only use, never logged). GitHub's star list needs a token with more
scope than `gh` gives, so the Crowd check runs on forks and pull requests and says so.

## Pay per call (slice 3)

`GET /api/v1/xray?repo=owner/name` sits behind [x402](https://x402.org) v2, scheme `exact`, USDC on Solana.
A bare request gets `402` with the price list in the `PAYMENT-REQUIRED` header; an x402 client pays and
retries; the facilitator verifies and settles; the card comes back as JSON with a `PAYMENT-RESPONSE` receipt.
The free route `/api/xray` (the page) allows 10 checks an hour per address.

Config in `xray.config.json` (or env `XRAY_NETWORK`, `XRAY_PAYTO`, `XRAY_PRICE`, `XRAY_FACILITATOR`):

| | devnet (default) | mainnet |
|---|---|---|
| network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| USDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (test) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| facilitator | `https://x402.org/facilitator` (free) | `https://facilitator.payai.network` |
| payTo | `node setup-devnet.mjs` makes a receiver wallet in `.keys/` and its USDC account | the owner's wallet, which must already hold a USDC token account |

**Status (v0.3.0):** the 402 challenge and the client's signed payment are proven on devnet; the facilitator rejected the test payment because the payer wallet held no devnet USDC, so a settled paid call has not been seen yet.

No payTo → the paid route answers 503 and the page says so. Mainnet is a config switch; nothing turns it on
by itself. Receivers need an existing USDC token account: the scheme looks it up, it does not create it.

Test client: `node pay-test.mjs owner/name --key payer-keypair.json` (or set `XRAY_TEST_KEY`). Devnet setup: `node setup-devnet.mjs --payer funded-devnet-keypair.json`. The payer needs USDC on the chosen network
and no SOL (the facilitator pays the fee). Devnet USDC comes from Circle's faucet (faucet.circle.com).

## What it reads

- A bare, blobless clone (`git clone --bare --filter=blob:none`) of the default branch: every commit's
  author and committer name, email and date. Deleted when the check is done.
- A depth-1 clone of the default branch for the Claims check: the README and up to 4,000 source files
  (≤512 KB each, no lockfiles, no `node_modules`/`target`/`dist`). Deleted when the check is done.
- Solana JSON-RPC `getAccountInfo` on mainnet and devnet for any program id found in `declare_id!` or
  `Anchor.toml`.
- DexScreener's keyless search for tokens carrying the repo's name.
- GitHub API: the repository, its owner, the newest 100 forks and 100 pull requests, and up to five user
  lookups for GitHub no-reply ids in the history.
- Repositories over 300 MB (GitHub's `size`) are refused in slice 1. Forks are refused: paste the source.

## The five checks

| Check | Flag when | Note when |
|---|---|---|
| Clock | history begins ≤14 days after the account was born, then waits ≥1 year to appear on GitHub (personal accounts only) | history predates the account, or ≥1 year of history pushed into a newer repo, or nearly every commit has a committer time a few hours after its author time |
| Metronome | ≥3 full years with <12% variation, or commit gaps on a near-fixed interval | <30% variation year to year |
| Names | ≥3 authors (and ≥60% of them) commit from an address that reads like a *different* full name | ≥2 authors and ≥40% |
| Masks | the owner's own no-reply id commits under a name that is not the owner's, with ≥10% of commits | same, under 10%; or one id under two unrelated names |
| Crowd | ≥6 forks/PRs (and half of them) inside 4 hours, mostly from name-plus-digits accounts | same without the lookalike names |

| Claims (slice 2) | README says money moves and no program or client code transfers, invokes or sends a transaction; README talks about an on-chain program and the repo has no program source; the program id is Anchor's template placeholder; the README calls the program deployed and the id sits on neither mainnet nor devnet | "implemented" next to "not implemented"; "live on mainnet" next to "devnet-only"; "audited" with no audit file or link; two or more named partners (Raydium, Jupiter, OpenAI…) the code never mentions |

Grade: **DRESSED UP** = 2 flags, or 1 flag + 2 notes. **LOOK CLOSER** = 1 flag or 2 notes. Otherwise **CLEAN**.

Under the checks, **Tokens carrying this name**: DexScreener search on the repo name and the README title,
exact name or symbol matches only, newest ~30 pairs per query. Context, not a score: names collide.

Share link: `/r/owner/name` serves the page with the result's grade in the title and description, so a
pasted link previews. "Copy link" on the card writes it to the clipboard.
Nicknames, initials, organisation accounts, bots, rebases and imports are allowed for; that's what the
calibration set (`got`, `zlib`, `express`, `jq`, `rea`, `pumpfun-github-claims`) checks.

## Files

- `server.js` — express: the page, `/api/xray` (free, limited), `/api/v1/xray` (x402), `/api/recent`, `/api/health`, `/r/owner/name`; cache in `cache/` for 1 hour
- `pay-test.mjs` — a paying x402 client; `setup-devnet.mjs` — receiver wallet + token account for devnet
- `xray.config.json` — network, payTo, price (not secret); `.keys/` — devnet receiver keypair (gitignored)
- `checks.js` — the five history checks, pure functions
- `claims.js` — the Claims check (README vs code) and the token lookup
- `public/index.html` — the page
- `version.txt` — bump with every change
