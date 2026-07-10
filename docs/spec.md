# papermold/v1 — Specification

Status: v1, hardened 2026-07-10 (micro-decisions resolved the same day)
Depends on: paperdoll >= 0.8.2 (the kernel; name-anchored vessel matching and token-based element checks need no element ids, so papermold requires nothing beyond kernel validity)
Lineage: [`rfc-papermold.md`](rfc-papermold.md) (the pre-RFC; its five decisions are assumed here)

papermold is the judgment layer of the paper* family: **structural
conformance**. A profile is a stencil — a pattern document declaring what a
body must structurally have in order to count as an instance of a kind.
Conformance is the judgment `body : profile` — a pure, deterministic yes/no
check runnable by any validator in any language with the two documents in
hand and nothing else. This specification is language-independent: the
document format plus the clause semantics below are the protocol; the
TypeScript library is one implementation.

## The profile document

```jsonc
{
  "protocol": "papermold/v1",
  "profiles": {
    "<profileId>": { /* Profile */ }
  }
}
```

Strict unknown-key validation applies at every level, like every document in
the family: a key this specification does not name is an error, wherever it
appears. Profile ids and vessel ids are the kernel's lowercase id grammar
(`^[a-z][a-z0-9-]*$`); sides are `top | right | bottom | left`; port
addresses and accept tokens are the kernel's shapes, validated to the same
grammar.

A **Profile** is:

```jsonc
{
  "vessels"?: { "<vesselId>": /* VesselDemand */ },
  "atLeast"?: { "n": /* integer >= 1 */, "of": [ { "vessel": "<vesselId>", "check": /* VesselDemand */ } ] }
}
```

A **VesselDemand** is an object with at least one of the six clauses (an
empty demand object is a validation error):

```jsonc
{
  "exists"?: true,                                    // literal true only
  "ports"?: { "<side>": { "vessel": "<id>", "side": "<side>" } },
  "acceptsAtLeast"?: [ /* AcceptToken */ ],
  "containsAtLeast"?: [ /* AcceptToken */ ],
  "conformsTo"?: { "token": /* AcceptToken */, "profile": "<profileId>" },
  "forbids"?: [ /* AcceptToken */ ]
}
```

### Document validity

`validateProfiles` rejects, with a path-annotated error each, and collects
all errors rather than stopping at the first:

- any unknown key, at any level;
- any profile id or vessel id outside the kernel's id grammar;
- an empty demand object (a demand must demand something);
- `exists` written as anything but the literal `true` — a profile spells "no
  such vessel" with clause absence, never `exists: false`;
- an empty `ports` demand, an unknown side, or a malformed port address;
- an empty or malformed token list (`acceptsAtLeast`, `containsAtLeast`,
  `forbids` must be non-empty arrays of kernel accept tokens);
- a malformed `conformsTo` (must be `{ token, profile }` exactly);
- a `conformsTo.profile` that names no profile in this document — references
  resolve within the same document only (pre-RFC decision 4, no imports);
- an `atLeast` whose `n` is not an integer >= 1, whose `n` exceeds
  `of.length`, whose `of` is not an array, or whose entries are not
  `{ vessel, check }` with a valid id and a valid demand.

Cyclic `conformsTo` references — self-references and mutual references alike
— are **legal** (micro-decision 2 below).

## The judgment

```
judge(body, document, profileId)    -> ProtocolError[]   (empty = conforms)
conforms(body, document, profileId) -> boolean           (= judge(...).length === 0)
```

`judge` requires a kernel-valid body and a valid profile document; invalid
input is a caller error and **throws** the formatted validation errors,
mirroring how the kernel's operations treat bad input. A `profileId` the
document does not define also throws. Everything the judgment returns is
about conformance, never about well-formedness.

Matching is **name-anchored** (pre-RFC decision 1): a profile's vessel id is
looked up literally in `body.vessels`. There are no pattern variables and no
role bindings; a `cockpit` where the profile demands a `head` does not
conform, however identical the geometry.

### Clause semantics

Per named vessel `<v>` with demand `<d>`, judged at path
`$.profiles.<p>.vessels.<v>`:

- **Absence dominates.** If `body.vessels[<v>]` is absent, the vessel fails
  *all* its demands with a single error at the demand's path
  (`Body has no vessel "<v>".`) — never one error per clause.
- **exists** — satisfied by presence; the name lookup is the check.
- **ports** — for each demanded side `s`: the body vessel must have
  **exactly** the demanded port address on `s` — same vessel, same side, a
  one-sided literal comparison (micro-decision 1 below). No port on `s`, or
  a port to any other address, fails, at path `...<v>.ports.<s>`.
- **acceptsAtLeast** — for each demanded token `t` (path
  `...<v>.acceptsAtLeast.<i>`): the body vessel's `accepts` must admit every
  element `t` describes. Absent `accepts` is the kernel's open vessel — it
  admits everything, so the demand passes. Otherwise `accepts` must contain
  a token **equal to `t`** (same kind, same type, including both typeless)
  **or more general than `t`** (same kind, no type). Formally: some `a` in
  `accepts` with `a.kind === t.kind` and (`a.type` absent or
  `a.type === t.type`). A narrower or differently-typed token admits only
  part of `t`'s element set and fails; a sealed vessel (`accepts: []`)
  admits nothing and fails every demand.
- **containsAtLeast** — for each token `t` (path
  `...<v>.containsAtLeast.<i>`): at least one element of the vessel's
  `contains` matches `t` under the kernel's `matches()` (kind equal; type
  equal when the token has one). Absent `contains` is the empty list.
- **forbids** — for each token `t` (path `...<v>.forbids.<i>`): **no**
  element of the vessel's `contains` matches `t`. Absent `contains` is the
  empty list, which trivially passes. This is the relay's workhorse:
  `forbids: [{ "kind": "status", "type": "dead" }]` is how "alive" is
  spelled.
- **conformsTo** — `{ token, profile }` (path `...<v>.conformsTo`): at least
  one element of the vessel's `contains` matches `token` under `matches()`,
  carries an embedded `body`, and that embedded body conforms to the named
  profile of the **same document**, judged by these same semantics,
  recursively. An element matching the token without an embedded body does
  not satisfy the clause; a conforming embedded body riding a non-matching
  element does not either.

Profile-level:

- **atLeast** — `{ n, of }`: count the `of` entries whose
  `(vessel, check)` pair passes (a pair passes iff the named vessel is
  present and its check yields no failures; an absent vessel fails the
  pair). If the count is >= `n`, the clause passes and the individual
  failures inside `of` are **not** errors — that is what a threshold means.
  If the count is < `n`, exactly one error is emitted at
  `$.profiles.<p>.atLeast`, stating how many checks passed of how many, and
  the required minimum (`Only 1 of 4 checks passed; the profile requires at
  least 2.`).

### Error reporting

Every failure names the profile-side clause in its `path`
(`$.profiles.living-human.vessels.head.ports.bottom`) and the body-side fact
in its `message` (`Body vessel "head" has no port on bottom.`). Judgment
collects all failures; it never stops at the first.

## What papermold/v1 deliberately does not do

- **No data reads — permanently excluded, not deferred.**
  `ContainedElement.data` is opaque to every protocol in the family, and
  papermold — the sibling most tempted to peek — is no exception: no clause
  can read, compare, or acknowledge `data`. "Alive" cannot mean `hp > 0`;
  instead the game mutates `hp` freely in `data`, and when a threshold
  crosses it applies a paperfold patch that *structurally reifies* the state
  (insert a dead-status element, delete the head vessel, seal a slot).
  Conformance then flips mechanically in any validator. The relay:
  **gamecraft counts → paperfold reifies → papermold judges.**
- **Checked, not monitored** (pre-RFC decision 3). papermold defines only
  the pure judgment: two documents in, a verdict out. No subscriptions, no
  events, no "tell me when alice stops conforming." Monitoring is a
  paperfold composition — re-judge after each patch and diff the verdicts —
  keeping papermold stateless and paperfold the sole owner of time.
- **No boolean combinators.** `forbids` is negation; `atLeast: 1` is
  disjunction; that is enough. A general `not`/`or`/`and` language turns
  profiles into a query language over bodies — the scope cliff the pre-RFC
  stops before.
- **No cross-vocabulary interpretation.** "A cockpit counts as a head" is
  subsumption — vocabulary-manifest territory, if that ever exists.
- **Never wired into paperdoll validity** (pre-RFC decision 5). Claiming
  `type: "mech"` never requires conforming to a mech profile. A body is
  paperdoll-valid or not — one universal judgment; it *additionally*
  conforms to zero or more profiles — any number of consumer-owned
  judgments.
- **No profile-editing operations** (micro-decision 4 below).

## Resolved micro-decisions (2026-07-10)

1. **Port demands are one-sided literal checks** (resolving the pre-RFC's
   port-strictness open question). A `ports` demand is satisfied iff the
   named vessel's own face carries exactly the demanded address. The
   reciprocal half-pair is *not* re-checked, because kernel law 2 already
   guarantees reciprocity in any body `judge` accepts — demanding it again
   would re-state a kernel law inside every profile. One-sided literal
   checking is the whole semantics.
2. **Cyclic `conformsTo` references are legal** (resolving the pre-RFC's
   recursion open question). Termination needs no depth bound and no cycle
   detection: a `conformsTo` clause always descends into an *embedded* body
   — a strictly smaller document than its container — so on a finite
   document the recursion bottoms out regardless of cycles among the
   profiles themselves. A self-referential profile (`matryoshka` demanding a
   doll whose body is a `matryoshka`) is satisfiable by no finite body's
   innermost shell and simply judges false, finitely. Implementations bound
   nothing.
3. **The judgment is the boolean; reporting is reference-implementation
   surface** (resolving the pre-RFC's reporting open question). The protocol
   defines conformance as yes/no. The reference implementation additionally
   reports *which* clause failed, in the kernel's precise-path style —
   profile-side paths, body-side facts, all failures collected. Other
   implementations may report differently or not at all; two conformant
   validators must agree only on the verdict.
4. **No profile-editing operations.** Profiles are authored documents, not
   built incrementally: no `insertProfile`/`deleteProfile` ops in v1,
   no mutation surface beyond `parseProfiles`' defensive copy. This keeps
   the library pure judgment, per pre-RFC decision 3 — the entire API is
   parse + judge.
5. **An empty profile is legal and vacuously conformant.** `vessels` and
   `atLeast` are both optional; a profile demanding nothing is satisfied by
   every body. The strictness lives one level down, where it means
   something: an empty *demand* is an authoring error (a named vessel must
   be demanded something), as is an empty token list and an empty `ports`
   map. Vacuous documents are legal; vacuous clauses are not.
6. **Absence dominates.** A vessel named in `vessels` (or in an `atLeast`
   check) that is absent from the body fails all its demands with a single
   "no vessel" error, not one error per clause — the absence is the fact;
   the per-clause failures are its shadow.
7. **Invalid input throws; nonconformance returns.** `judge` throws formatted
   errors on a kernel-invalid body, an invalid profile document, or an
   unknown profile id — caller errors, in the style of the kernel's
   operations. The returned `ProtocolError[]` speaks only of conformance, so
   an empty result always means "valid inputs, conforming body."

## Complexity, recorded

Name-anchoring (pre-RFC decision 1) keeps the judgment a linear walk: every
clause names its target vessel, so there is no pattern search, no subgraph
isomorphism, no token-budget assignment. `atLeast` is a count of named
checks; `conformsTo` recurses through strictly nested bodies. The judgment
is linear in (size of profile × size of body), and incremental re-judging —
only profiles that name a patched vessel — is an implementation strategy the
spec neither requires nor forbids.
