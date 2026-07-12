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

---

# papermold/v2 — Scene profiles

Status: v2, hardened 2026-07-11 (consumer: paperdoll-viewer's versus mode)
Depends on: paperchain >= 0.1.0 and, through it, the paper-doll/v3 address
grammar — but **only for the v2 document kind**. The v1 judgment is unchanged
and still needs nothing beyond kernel validity; the widened dependency enters
via `papermold/v2` alone. v1 documents remain valid interchange; v2 is a
second document kind in the same library.
Lineage: pre-RFC decision 4 recorded profiles-of-scenes as conceivable and
deferred, awaiting a consumer; resolved 2026-07-11.

papermold/v2 does to paperchain what v1 did to the kernel: it extends the
judgment `body : profile` to `scene : profile` — a valid trade, an armed
combatant, a disarmed loser, as pure conformance judgments over a paperchain
scene. The v1 discipline is widened, not changed: judgment stays a linear
walk, data stays unread, and the vocabulary stops before the same cliffs.

## The scene profile document

```jsonc
{
  "protocol": "papermold/v2",
  "profiles": { "<profileId>": { /* Profile — v1 grammar verbatim */ } },
  "sceneProfiles": { "<sceneProfileId>": { /* SceneProfile */ } }
}
```

Both maps are **required**; both may be empty. The `profiles` half is the v1
grammar **verbatim** — same clauses, same validation, same same-document
`conformsTo` reference pass — carried inside the v2 envelope so that scene
clauses have body profiles to point at. `judgeBody` / `conformsBody` are the
v2 counterparts of v1's `judge` / `conforms`: they re-wrap the document's
`profiles` half as a v1 document and land in the same judgment walk.

Scene-side `conformsTo` references (in body demands, `forAllBodies` checks,
and `otherEndpoint` filters) resolve to `profiles` of the **same document**
only — pre-RFC decision 4's same-document rule, extended across the two
namespaces of the v2 document. A dangling reference is a validation error.

A **SceneProfile** is an object of up to five optional clauses (an empty
scene profile is legal and vacuously conformant, as in v1):

```jsonc
{
  "bodies"?: { "<bodyName>": { "exists"?: true, "conformsTo"?: "<profileId>" } },
  "kinds"?: { "<kindId>": { "declared"?: true, "declaration"?: /* KindDeclaration */ } },
  "relations"?: [ /* RelationDemand */ ],
  "forAllBodies"?: [ { "excluding"?: ["<bodyName>"], "check": /* BodyDemand */ } ],
  "forbidsRelations"?: [ { "kind": "<kindId>", "at"?: "<anchor>" } ]
}
```

A **RelationDemand** is:

```jsonc
{
  "at": "<anchor>",                     // required
  "kind": "<kindId>",                   // required
  "role"?: "from" | "to",
  "atLeast"?: /* integer >= 1 */,
  "atMost"?: /* integer >= 0 */,        // at least one of the two required; atLeast <= atMost
  "otherEndpoint"?: { "prefix"?: "<anchor>", "conformsTo"?: "<profileId>" }
}
```

### Anchors

An **anchor** is one or more `/`-joined kernel ids: one segment names a whole
scene body (`"red"`); two or more form a paperchain scene address
(`"red/right-hand/sword"`). Validation checks grammar only; whether an anchor
*resolves* in a particular scene is a judgment-time question. At judgment, a
one-segment anchor resolves iff the scene has that body; longer anchors
resolve through paperchain's own address machinery.

A relation endpoint **matches** an anchor iff it equals the anchor or extends
it with a `/` segment. The `/` guard matters: anchor `"red"` matches
endpoints `"red/hand"` and `"red/hand/sword"` but never any endpoint of a
body named `"red-two"`. This is **subtree-containment anchoring**, and it
deliberately diverges from paperchain's `relationsAt`, which matches exact
addresses only: a relation whose endpoint sits *inside* the anchored subtree
still counts — a sword sheathed inside the hand is still wielded by the hand.
The demand asks about a region of structure, not a coordinate.

### Document validity

`validateSceneProfiles` rejects, path-annotated and all-errors-collected as
everywhere in the family:

- any unknown key, at any level;
- the entire v1 validity list, applied verbatim to the `profiles` half;
- any scene profile id, body name, or kind id outside the kernel's id
  grammar;
- an empty body demand or kind demand (a demand must demand something);
- `exists` or `declared` written as anything but the literal `true` —
  absence is spelled with clause absence, never `false`;
- a malformed kind declaration in a `declaration` demand — paperchain's
  declaration rules, revalidated locally because paperchain does not export
  its validator: `symmetric`/`irreflexive` booleans, `fromMax`/`toMax`
  non-negative integers, and `toMax` forbidden on symmetric kinds (whose
  positions are one pool);
- a relation demand without `at` or `kind`, with a `role` other than `"from"`
  or `"to"`, with neither `atLeast` nor `atMost`, with `atLeast < 1`,
  `atMost < 0`, or `atLeast > atMost`;
- an empty `otherEndpoint` (at least one of `prefix`, `conformsTo`);
- an anchor outside the grammar above (rejected with the kernel address
  parser's own message);
- an empty or non-array `relations`, `forAllBodies`, or `forbidsRelations`
  list; a `forAllBodies` entry without a `check`; an empty `excluding`;
- a `conformsTo` — anywhere on the scene side — naming no profile in this
  document's `profiles`.

## The judgment

```
judgeScene(scene, document, sceneProfileId)    -> ProtocolError[]   (empty = conforms)
conformsScene(scene, document, sceneProfileId) -> boolean
judgeBody(body, document, profileId)           -> ProtocolError[]   (v1 semantics, v2 document)
conformsBody(body, document, profileId)        -> boolean
```

Input discipline is v1's exactly: `judgeScene` requires a paperchain-valid
scene (`validateScene` clean) and a valid v2 document; invalid input is a
caller error and **throws** the formatted validation errors, as does a
`sceneProfileId` the document does not define. `judgeBody` guards the body
with kernel validation and throws on an unknown `profileId`. Everything the
judgment returns is about conformance, never well-formedness.

### Clause semantics

Per named body `<b>`, judged at `$.sceneProfiles.<p>.bodies.<b>`:

- **Absence dominates**, as in v1: a scene without body `<b>` fails all its
  demands with a single error at the demand's path (`Scene has no body
  "<b>".`) — never one per clause.
- **exists** — satisfied by presence; the name lookup is the check.
- **conformsTo** — the scene body must conform to the named body profile of
  the same document, judged by the v1 semantics. The clause is
  **reference-only**: nested body-conformance failures are *not* forwarded
  into the scene verdict — the judgment is the boolean (micro-decision 3
  again), so a failing body yields exactly one wrapper error at
  `...bodies.<b>.conformsTo` naming the body and the profile. A caller who
  wants the inner failures calls `judgeBody` directly.

Per named kind `<k>`, judged at `$.sceneProfiles.<p>.kinds.<k>`:

- **Absence dominates**: a scene declaring no kind `<k>` fails all its
  demands with one error.
- **declared** — satisfied by declaration; the lookup is the check.
- **declaration** — a **field-subset match** against the scene's
  declaration: only fields the demand names are compared. Booleans compare
  with absent normalized to `false` on both sides (demanding
  `symmetric: false` is satisfied by an absent flag). Budgets (`fromMax`,
  `toMax`) must be **declared and integer-equal**: an absent budget is
  unbounded, which never satisfies a bounded demand — there is no
  "at-most-this-strict" ordering, only equality on the named fields.

Per relation demand, judged at `$.sceneProfiles.<p>.relations.<i>`:

- **An unresolvable anchor is absence, and absence dominates**: one error at
  the demand's path (`Anchor "..." does not resolve in the scene.`), and the
  bounds are not evaluated.
- Otherwise, **count** the scene's relations of the demanded kind that touch
  the anchor, then check `atLeast`/`atMost` against the count (one error per
  violated bound, at `...relations.<i>.atLeast` / `.atMost`).
- **Counting is per relation, once each.** A relation counts if *some*
  allowed position assignment puts an endpoint under the anchor with the
  other endpoint passing the filter — so a self-relation whose both
  endpoints sit under one anchor counts **once**, not twice. This is a
  deliberate contrast with paperchain's *budget* accounting, where a
  relation debits both of its endpoints (and a symmetric self-relation
  debits one body twice): budgets meter endpoint slots; this clause counts
  relations.
- **role** restricts which position the anchor may occupy — meaningful for
  directional kinds ("at least one `grasps` *from* red's hand"). On a
  **symmetric** kind, whose positions are one pool, `role` **degrades** to
  either-position rather than erroring: there is no "from" to restrict to.
- **otherEndpoint** filters the relation's other endpoint (the position the
  anchor did not take): `prefix` is subtree matching under the same anchor
  grammar; `conformsTo` requires the *scene body* the endpoint belongs to
  (its first address segment) to conform to the named body profile —
  reference-only, as above. An endpoint that does not parse as a scene
  address fails the filter.

Per `forAllBodies` entry, judged at `$.sceneProfiles.<p>.forAllBodies.<i>`:

- A **universal**: every scene body not named in `excluding` must satisfy
  the `check` body demand. Universals report **every witness** — one error
  per failing body at `...forAllBodies.<i>.check.conformsTo`, in body-name
  order — because "which bodies fail" is exactly what a universal's caller
  needs. (`exists: true` inside the check is vacuous: quantified bodies
  exist by construction.)

Per `forbidsRelations` entry, judged at
`$.sceneProfiles.<p>.forbidsRelations.<i>`:

- A **universal negative**: no relation of the named kind exists — anywhere
  in the scene, or, with `at`, touching the anchored subtree in either
  position. A violated ban yields one error stating the witness count. A
  ban's anchor is not required to resolve: an anchor nothing touches is a
  vacuously satisfied ban (forbidding relations at a body that is gone is
  not an error — it is success).

### The quantifier stance

Every clause in the scene vocabulary binds **at most one implicit variable**
— a relation demand ranges over relations, a `forAllBodies` check over
bodies — and **no variable is shared between clauses**. There are no joins:
"some relation whose other endpoint *also* participates in a second
relation" is not expressible, because a shared variable turns judgment into
conjunctive-query evaluation over the relation graph — the same NP-hard
search that pre-RFC decision 1's name-anchoring refused over vessels,
restated here over scenes. Universal *multiplicity* ("every hand wields at
most one sword") is likewise not a clause: it delegates to paperchain's kind
demands — declare `fromMax: 1` and demand the declaration — because
paperchain validity already enforces declared budgets on every valid scene.
The profile checks that the law is declared; paperchain guarantees it is
obeyed.

### Error reporting

Exactly v1's convention, one namespace over: the profile-side clause in the
`path` (`$.sceneProfiles.armed.relations.0.atLeast`), the scene-side fact in
the `message` (`Anchor "red/right-hand" participates in 0 counted "grasps"
relations; the profile requires at least 1.`). All failures collected, never
stopping at the first.

## What papermold/v2 deliberately does not do

Everything v1 refuses, plus:

- **No scene-level `atLeast`.** A threshold over scene checks ("at least 2
  of these 4 relation demands hold") is conceivable and **deferred**, on the
  same consumer-first discipline that recorded profiles-of-scenes at pre-RFC
  decision 4 and shipped them only when versus mode needed them. No consumer
  has needed the threshold; it waits for one.
- **No sceneProfile → sceneProfile references.** Scene profiles reference
  body profiles only, never each other. Micro-decision 2's termination
  argument — `conformsTo` descends into a strictly *smaller* embedded body —
  does not transfer: scenes do not nest, so a scene-profile reference would
  recurse over the *same* scene and termination would need the cycle
  detection the family has never had to build. Composition is the caller's
  `&&`.
- **No relation-graph queries.** See the quantifier stance: one variable per
  clause, no joins, multiplicity delegated to declared budgets.

## Resolved micro-decisions (2026-07-11)

1. **The v2 document kind carries the dependency widening alone.** v1
   deliberately depended on nothing beyond kernel validity; v2 needs
   paperchain (^0.1.0) for scene validation and address resolution, and
   thereby the paper-doll/v3 address grammar. The widening is scoped to the
   v2 entry points: judging a body against a v1 document still involves
   nothing beyond kernel validity.
2. **A paperchain declaration-rule change is a papermold-breaking event.**
   The `declaration` demand revalidates paperchain's kind-declaration rules
   locally (~15 lines: boolean flags, non-negative integer budgets, `toMax`
   forbidden on symmetric kinds), because paperchain does not export its
   validator. Those lines are a deliberate coupling: if paperchain's
   declaration grammar changes, papermold breaks **by definition** and must
   revise in step — the same posture paperfold takes toward the operation
   sets it reifies.
3. **Reference-only `conformsTo`, everywhere on the scene side.** Body
   demands, `forAllBodies` checks, and `otherEndpoint` filters all judge the
   referenced body profile and forward nothing but the wrapper error — the
   judgment is the boolean (micro-decision 3), applied uniformly.
4. **Subtree anchoring, not exact-address anchoring.** Recorded above with
   the sheathed sword; the divergence from `relationsAt` is deliberate and
   permanent for this vocabulary.

## Complexity, recorded

The scene judgment stays a linear walk: `O(B × D_b + R × D_r + K)` for `B`
scene bodies against `D_b` body-quantified checks, `R` scene relations
against `D_r` relation demands and bans, and `K` named kind demands — plus
v1's `O(P × |body|)` for each `conformsTo` a clause invokes. No pattern
search, no join evaluation, no budget assignment: the quantifier stance is
what keeps the exponent off.
