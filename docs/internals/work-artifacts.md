# Engineering work artifacts

> For maintainers. Where planned work lives, where finished work goes, and how the plan is kept from
> rotting.

## Current facts belong in the docs

Durable architecture, constraints, and operational knowledge live in `docs/internals/`, written in the
**present tense** and updated with the code they describe. When the reason for a decision will matter
after it is implemented, record it beside the architecture it constrains rather than in a separate
history.

**Finishing, renaming, or deleting something is not done until the docs describing it are updated in
the same commit.** The doc set is a grep away, so there is no excuse for guessing which files: before
committing, grep `docs/` and `AGENTS.md` for every identifier the change touched — the function, the
file, the directive, the constant, the item id. Each hit is either still true or it is the drift.

**Two smells to grep for**, because the lines nobody is looking at are the ones that rot:

- **A requirement in the present tense that is now built** — "the installer *must say so* before
  installing", "*still owes*", "*remain to wire*", "does not exist *yet*". Shipped work described as
  owed makes the project look unfinished and sends the next session to redo it. Grep `still owes`,
  `remain to`, `not yet`, `TODO`, `OPEN (`.
- **A name that no longer exists** — grep the OLD name at the moment you rename, not later.

Rank a fix by what a reader would *do* with the lie. Worst is a doc that instructs building what the
architecture forbids. Next is a summary that contradicts its own body, because the summary is what
people read. Last, and still worth fixing, is shipped work listed as owed.

## Planned work belongs in the plan

`docs/PLAN.md` is the tracker: it states what is **open**, with the outcome and constraints each item
must satisfy. A status box is `[ ]` open, `[~]` decided or in flight, `[x]` done.

**A box turns `[x]` only when the change is in code and verified.** A fix may be proposed, designed,
and fully written up while its box stays open — readers trust `[x]` as "handled in the codebase", and
a premature tick hides real remaining work.

**The plan is pruned, not accumulated.** When work closes, its narrative leaves; only what future work
must still respect stays.

- A **superseded section** — a "current focus" that is no longer current, a design supplanted by a
  later decision — is swept and **deleted**. Not kept, renamed "Previous" or "kept for the reasoning".
- A **closed `[x]` item** is split at the moment it is ticked. The done narrative ("we changed X, here
  is how, verified by Y") is git's job: delete it. A **locked decision, a rejected alternative, or a
  constraint the next person must not re-litigate** is not narrative — keep it, but move it where it
  belongs (the relevant spec section, a code comment, a test name) instead of leaving a checkbox
  nobody will ever untick.

Prune when an item closes and when a wave closes. A cleanup nobody schedules is the same as no rule.
The tax this exists to stop is measurable: the plan once carried 598 lines inside `[x]` items against
627 lines of open work — closed work occupying as much of the file as live work.

Git holds the full text forever, so "we might want the reasoning" costs one `git log -p`, not a
permanent charge on every read.

## Retiring a plan document

Before deleting or folding one plan doc into another — or whenever you answer "what is still open in
X?" — enumerate the unfinished work by grepping for **both `[ ]` and `[~]`**, since a partial is
unfinished work too. Sweep the prose for non-checkbox deferral markers as well (`deferred`,
`відкладено`, `лишилось`, `follow-up`, `TODO`, `блокер`); not every open item is a checkbox.

Then, before the doc dies:

1. **Lift every open and partial item** into its new home, plus any non-obvious rationale not already
   captured in code, tests, or another spec. The done-work record and the full design archaeology stay
   recoverable in git, so only the open tails and the load-bearing "why" need to travel.
2. **Watch for stale notes superseded by a later `[x]`** — an early "this is blocked" line that a
   subsequent item already closed. Do not re-lift done work as if it were open.
3. **Re-point every cross-reference** in other docs and in source comments, then delete with `git rm`.
4. **Verify by counting, never by reading.** Diff the structure against `HEAD` and expect every number
   to match except the one you meant to change:

   ```sh
   for pat in '^- \*\*' '^\*\*' '^#' '^- \[ \]' '^- \[~\]' '^  - \[ \]' '^- \[x\]'; do
     echo "$pat  $(git show HEAD:docs/PLAN.md | grep -c "$pat")  ->  $(grep -c "$pat" docs/PLAN.md)"
   done
   diff <(git show HEAD:docs/PLAN.md | grep -o '^- \[ \] \*\*[A-Za-z0-9-]*' | sort) \
        <(grep -o '^- \[ \] \*\*[A-Za-z0-9-]*' docs/PLAN.md | sort)
   ```

   Any unexplained delta is content you dropped. Account for each one out loud before committing —
   "44→40 because R2–R5 merged into one line" is fine; a number you cannot explain is not.
5. **An item does not end at the next `- [`.** A block runs until the next construct at the same
   level, which in the plan also means a bold-heading paragraph or a non-checkbox bullet. A `[x]` item
   may own **nested** `  - [ ]` tails that are live backlog, and `^- \[ \]` will not see them — count
   those separately.

Both rules in 4 and 5 were learned by dropping content twice in one pruning pass, each time after the
sweep had been "done" by reading. Reading does not scale past a few blocks; counting does, and it
takes three seconds.

## Temporary work stays temporary

Keep scratch files, exploratory research, transcripts, and session handoff notes **outside the
worktree**. They are inputs to the work, not project documentation. A commit records what changed and
why; if a fact must survive it, update the relevant document — otherwise the plan entry and the commit
are the record.

## Comments are not a changelog

Git already holds what the code used to be, who changed it, and when. A source file repeating that is
a diary nobody updates.

- **An example of a VALUE earns its place** (`e.g. "5e,5.5e"`) — it shows the shape faster than a
  sentence. An example from the project's history does not.
- **Past tense is allowed only when it names a failure that RETURNS if the code is undone.** "The
  prune used to sit behind this return, so switching modes stranded every staged byte" is a guard and
  stays. "Split out of the old monolithic page" is a diary entry — delete it, and drop the dates and
  session references with it.

A **comment-revision pass** is its own commit, after an extraction lands, never inside it: a reworded
comment inside a byte-preserving move hides whether the code changed too. The pass fixes comments that
narrate *what* instead of *why*, comments naming something that no longer exists, and comments written
before a convention existed that now contradict it. A comment that is still correct is left alone.

**Auditing comment volume**, when someone asks whether they have grown too verbose: measure the repo's
baseline first (this one sits at a 27% comment share, median 26%, p90 42%). The ratio is only
meaningful on **big** files — on a small one it ranks by size, so a necessary 5-line header over 18
lines of code reads as 47% and looks guilty, while a wasted paragraph in a 350-line file hides at 2%.
Judge small files paragraph by paragraph, with one test: *is there a reader who, without this, makes a
mistake?* Look hardest at the header of a small new file.

## Every line of prose carries information

Do not write volume for its own sake. Almost every document here is read by an agent or by one
maintainer, and prose written to look thorough is pure cost — they scroll past 200 lines to find the 2
that matter.

A doc that tracks work states what is open. One reason per fact, once, in one place; two homes for the
same reasoning means one of them rots. A commit body says what changed and why it was wrong before,
not a tour. Cut restatements of what the code says, headings with nothing under them, and hedging. An
explanation someone explicitly asked for is not filler — give that one in full.
