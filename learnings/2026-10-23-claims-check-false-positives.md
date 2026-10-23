# Reading a README against its code without crying wolf (REPO X-RAY slice 2)

## The problem, in one line
The first Claims check flagged nirholas/pumpfun-github-claims, a read-only Telegram feed, because its README
says developers "collect rewards": a sentence about *other people's* money read as a claim about the repo's own
program.

## The approach
1. Start from the staged-looking test repo and write down the three things a reader can verify without running
   anything: money that "moves" (README) vs transfer/CPI/send calls (code); a program id (`declare_id!`,
   `Anchor.toml`) vs the chain (`getAccountInfo` on mainnet and devnet, keyless public RPC); "implemented" vs
   "not implemented" in the same README.
2. Add the cheap extras with their own escape hatch: "audited" only when the word isn't "unaudited"; named
   partners (Raydium, Jupiter, OpenAI…) that the code never mentions, evidence-only unless two are missing.
3. Run the honest set (`got`, `zlib`, `express`, `jq`, `rea`, the claims feed, `paidhub`, `pump-fun-sdk`).
   Only the feed fired. Its README has no program; it describes pump.fun's.
4. First fix: skip the money comparison when the repo has no on-chain source *and* the README never uses
   on-chain words. Still fired: every crypto README says "on-chain" and "mainnet" somewhere.
5. Second fix, the one that held: the money comparison needs a program to compare against, so it runs only
   when the repo holds program source (.rs/.sol/.move). With no program source, the check asks a narrower
   question: does the README speak of *its own* program ("our program", "the program targets", "program id")?
   Yes → flag "no program source". No → evidence-only ("nothing on chain to check it against"), or, when
   the client code sends transactions, "the client code has N calls to back it (it drives someone else's
   program)". paidhub, a keeper on pump.fun's program, lands on that last line.

## The judgment calls
- Did not try to understand README prose with a model. Regexes with named escape hatches are checkable by
  the reader and cost nothing per call; the evidence line quotes the sentence so a wrong match is visible.
- Kept the placeholder program id as a flag on its own. `Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS` is
  Anchor's template id; a repo that ships it never deployed anything under it, whatever the README says.
- Tokens carrying the repo's name are shown under the checks but never scored: "got" and "rea" are also
  unrelated coins. The table says "names collide" in its own note.
- The cache now refuses results from an older build (`version` mismatch → re-run), after the page served a
  slice-1 result for ten minutes and I debugged a check that had already passed.

## The reusable rule
When comparing a document's claims against code, compare only where the code has something of its own to
compare (a program, a contract); when it doesn't, ask the narrower question "does the document claim one?"
and otherwise print the sentence as evidence without a score.
