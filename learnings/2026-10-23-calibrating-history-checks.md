# Calibrating git-history authenticity checks (REPO X-RAY slice 1)

## The problem, in one line
The first version of `checks.js` graded the staged-looking test repo DRESSED UP, but also
graded expressjs/express DRESSED UP and madler/zlib and jqlang/jq LOOK CLOSER: the checks could not tell a
costume from an old project with messy history.

## The approach
1. Build the checks against one repo whose history looks staged first (back-dated commits at a fixed rate,
   persona co-authors, a burst of lookalike forks; picked from a study, `node server.js --check owner/name`),
   so each check has a line of evidence it is meant to print.
2. Pick a calibration set of honest repos with *different shapes of mess*: a one-person repo with squash
   merges (sindresorhus/got), a 1990s project pushed to GitHub years later (madler/zlib), an org-owned repo
   whose org was created after the history (expressjs/express, jqlang/jq), a huge trending repo (morluto/rea),
   and a tiny fresh repo (nirholas/pumpfun-github-claims). Run all of them in one background command, save
   each result as JSON, print only the checks with level > 0.
3. Read every false alarm and name the honest reason behind it:
   - Names: nicknames and initials (`tj@`, `mu@`, `wlangfor@`) are not costumes. Only an address that reads
     like a *different full name* (9+ letters, no token of the author's name, optional digits) is.
   - Names: big projects always have some of those (23–35% of authors). Only a *ratio* ≥ 60% with ≥ 3 such
     authors is a flag; the staged-looking test repo scores 4 of 4.
   - Masks: one GitHub id under two display names is normal (nirholas/nich, Chris de Almeida/ctcpip). Only
     names that share no token and are not the login count, and only with ≥ 5 commits each.
   - Clock: organisations are created to house existing projects, so "history predates the account" is
     evidence-only for `owner.type === 'Organization'`.
   - Clock: committer-vs-author offsets of 79,000 h are rebases and imports; print the hours only when ≤ 48 h.
   - Crowd: a repo with 368K stars gets 100 forks an hour; when the newest 100 forks all land inside the
     window the sample is saturated and cannot show a burst. Say so, don't score it.
4. Re-run the whole set after every threshold change. Done when the staged-looking test repo keeps ≥ 4 flags and every
   honest repo is CLEAN (a single note is allowed).
5. Dead end: printing all mismatched authors as evidence even when the check is clean. It put false claims on
   screen (a long-time maintainer listed as "commits from someone else's address" for using his own domain). Evidence lines now print only when the check scores.

## The judgment calls
- Did not use stars. GitHub's stargazer list returns 401 without a token and 404 with the `gh` CLI token, so
  the Crowd check runs on forks and pull requests and prints a line saying the star list was unavailable.
  Stated, not hidden.
- Did not try to prove *who typed the code*. The checks read dates, ids and names; the grade copy says
  "looks staged" and "could be a migration", never "fake" or "scam".
- Did not make the grade a score out of 100. A number invites arguing about the number; flags with lines
  invite reading the lines.
- Kept the clone blobless and bare (`git clone --bare --filter=blob:none --single-branch`): 2 s for a
  550-commit repo, no file contents on disk, deleted after. Refused repos over 300 MB instead of streaming.

## The reusable rule
When a heuristic must separate staging from mess, calibrate it on a set of honest inputs chosen for their
*kinds of mess* (imports, orgs, nicknames, renames, popularity), score with ratios not counts, show evidence
only for checks that score, and name every data source you could not read.
