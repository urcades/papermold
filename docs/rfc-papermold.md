# RFC: papermold — The Judgment Layer

Status: pre-RFC (decisions recorded 2026-07-10; drafting precedes any implementation)
Depends on: paper-doll/v2 only (deliberately **not** v3 — see decision 1 and Sequencing)
Relates to: `rfc-vessel-calculus.md`, `rfc-paperchain.md`, `core-ontology.md`, `design-gamecraft-consumer.md`

## Definition

paperdoll's validity is universal: one set of seven laws that every body satisfies or doesn't, knowing nothing of humans or mechs. Its typing is nominal-on-trust: anything can claim `type: "mech"`, and the protocol matches names, never meanings — a caveat the kernel RFC recorded deliberately ("The outer token does not inspect the inner root"). papermold adds the judgment those two facts leave missing: **structural conformance**.

A **profile** is a stencil — a pattern document declaring what a body must structurally have in order to count as an instance of a kind. **Conformance** is the judgment `body : profile` — a pure, deterministic yes/no check runnable by any validator in any language with the two documents in hand and nothing else. The mech-ness lives entirely in a consumer-authored profile document; the kernel never learns what a mech is, and the core ontology's boundary is not crossed but *served* — the sibling exists precisely so the kernel never has to.

Envelope typing is a name tag. A profile is an inspection. papermold is the difference between the two.

## What papermold deliberately does not do

**Profiles judge structure only — never data.** `ContainedElement.data` is opaque to every protocol in the family, always, and papermold is no exception: no clause in a profile can read, compare, or even acknowledge `data`. This is the sibling most tempted to peek (surely "alive" means `hp > 0`?), so the refusal is recorded as the document's central design move rather than a footnote:

**The relay.** "Alive" cannot mean `hp > 0`, because `hp` lives in `data` and data is invisible. Instead: the game mutates `hp` freely in `data`; when a threshold crosses, the game applies a paperfold patch that *structurally reifies* the state — insert a `{ kind: "status", type: "dead" }` element, delete the `head` vessel, seal a slot. Conformance to `living-human` then flips, mechanically, in any validator. The relay is:

> **gamecraft counts → paperfold reifies → papermold judges.**

This is design, not limitation. It keeps judgments language-neutral (a Rust conformance checker needs no game logic), and it forces every game-significant state to become structurally visible — which means diffable saves, replayable histories, and cheating that shows up as a structural anomaly rather than hiding in an opaque blob. The gamecraft design note anticipated exactly this composition: "a scheduled patch generator whose thresholds reify as structural change, so profile conformance can observe them."

papermold also does not monitor (decision 3), does not gate paperdoll validity (decision 5), and does not do cross-vocabulary interpretation ("a cockpit counts as a head") — that is subsumption, which belongs to the vocabulary manifest if and when it exists.

## The profile document

A profile document is papermold's judged artifact, parallel to paperdoll's `{ protocol, body }` and paperchain's scene. It is by-value, strictly validated (unknown keys rejected everywhere), and self-contained:

```jsonc
{
  "protocol": "papermold/v1",
  "profiles": {
    "living-human": {
      "vessels": {
        // existence + geometric demand: a head, attached atop the body
        "head": {
          "exists": true,
          "ports": { "bottom": { "vessel": "body", "side": "top" } }
        },
        "body": {
          "exists": true,
          // accepts-at-least: the body vessel must accept armor
          "acceptsAtLeast": [{ "kind": "item", "type": "armor" }],
          // forbids: contains NO dead-status element
          "forbids": [{ "kind": "status", "type": "dead" }]
        },
        // contains-at-least: a heart is present in the chest
        "chest": {
          "exists": true,
          "containsAtLeast": [{ "kind": "organ", "type": "heart" }]
        }
      },
      // structural threshold: at least 2 of 4 organ vessels intact
      "atLeast": {
        "n": 2,
        "of": [
          { "vessel": "liver",       "check": { "exists": true } },
          { "vessel": "left-lung",   "check": { "exists": true } },
          { "vessel": "right-lung",  "check": { "exists": true } },
          { "vessel": "left-kidney", "check": { "exists": true } }
        ]
      }
    }
  }
}
```

A profile body reads almost like a paperdoll body — named vessels, ports, accepts — plus demand clauses. That resemblance is deliberate: authoring a profile should feel like sketching the body you expect.

## Decisions

Five hard decisions, all resolved 2026-07-10.

### 1. Matching is name-anchored: names, not roles

A profile's vessel `"head"` matches the body's vessel literally named `head`. There are no pattern variables, no role bindings, no "find me any vessel shaped like a head."

Rejected: role-based binding. It reads attractively ("some vessel serving as a head") and is a trapdoor of exactly the shape the kernel RFC's capacity analysis taught us to name: pattern variables over a graph make conformance **subgraph isomorphism** — NP-hard search — where name-anchoring keeps it a linear walk over named vessels. It also unmoors profiles from authorship: the whole family is nominal-on-trust, and vessel ids are semantic, author-chosen names, not anonymous nodes. Name-anchoring is the same complexity discipline as capacity's disjointness escape — one authorship constraint accepted to avoid one algorithm class.

Consequences accepted knowingly: profiles are brittle under vessel renaming, and cross-vocabulary mapping ("cockpit counts as head") is out of scope — it is interpretation-layer work, the vocabulary manifest's subsumption, when that exists.

This decision has a structural payoff beyond complexity: because profiles name the vessels they judge, an implementation can know exactly which profiles a given patch could affect (decision 3), and — decisively for sequencing — name-anchored vessel matching plus token-based element checks need **no element ids at all**, so papermold depends only on paper-doll/v2 and does not wait for v3.

### 2. The constraint vocabulary is closed

Per named vessel, a profile may demand:

- **Existence** — the vessel is present.
- **Ports** — geometric demands: the head attaches atop the body. Checked literally against the body's ports.
- **Accepts-at-least** — the vessel's `accepts` admits the given tokens (the body is *capable* of holding armor, whether or not it currently does).
- **Contains-at-least** — the vessel contains at least one element matching a token.
- **Recursive conformance** — the vessel contains an element whose embedded body conforms to profile X, where X is another profile in the same document.
- **Forbids** — a token list; the vessel contains *no* matching element. Embeddings cannot express absence, so absence gets an explicit clause. This is the relay's workhorse: `forbids: [{ kind: "status", type: "dead" }]` is how "alive" is spelled.

One clause lives at the **profile level** rather than per-vessel, because it spans vessels:

- **atLeast** — `"atLeast": { "n": 2, "of": [checks] }`, where each check names a vessel and a per-vessel demand: a structural threshold, e.g. at least 2 of 4 organ vessels intact. This is *structural* counting — count the checks that pass, a linear scan over named targets — and it does **not** reopen the capacity trapdoor recorded in the kernel RFC: there is no token-budget assignment problem because every check names its target.

**Excluded: full boolean composition.** `forbids` is negation; `atLeast: 1` is disjunction; that is enough. A general `not`/`or`/`and` combinator language turns profiles into a query language over bodies — a different, bigger artifact. That is the scope cliff, and the vocabulary stops before it.

**Permanently excluded: anything that reads `data`.** Not deferred — excluded. See the relay.

### 3. Checked, not monitored

papermold defines only the pure judgment: two documents in, a boolean out. It defines no subscriptions, no events, no "tell me the moment alice stops conforming."

Rejected: a subscription/event surface inside papermold — it would import time and statefulness into a pure judgment, and time is paperfold's sole property.

Monitoring is instead a **paperfold composition**: re-judge after each patch and emit conformance *transitions* — a diff of judgments riding the patch stream. That keeps papermold stateless and paperfold the sole owner of time. Incremental efficiency — only re-checking profiles that name a patched vessel, which decision 1 makes possible — is an implementation strategy, invisible to the spec.

### 4. Document shape: named profiles, same-document references only

The document is `{ protocol: "papermold/v1", profiles: { "living-human": { ... } } }`. Profiles are named so that recursive-conformance clauses can reference each other — but in v1 only within the same document. No imports: the by-value discipline the whole family runs on. Cross-document profile sharing can ride the vocabulary manifest later, if two tools ever need it.

Profiles-of-scenes ("a valid trade" as a conformance judgment over a paperchain scene) are conceivable and deferred — bodies first, on the same one-consumer-at-a-time discipline as everything else in the roster.

> **Resolved 2026-07-11.** The consumer arrived — paperdoll-viewer's versus
> mode ("armed", "engaged", "disarmed" as judgments over a two-combatant
> scene) — and profiles-of-scenes shipped as **papermold/v2** (`docs/spec.md`,
> second section). The one-consumer-at-a-time discipline held: the vocabulary
> is exactly what versus mode exercised, nothing speculative.

### 5. Conformance is opt-in, always

Claiming `type: "mech"` never requires conforming to a mech profile. Nominal trust stands, exactly as the kernel RFC's resolved questions record it. Profiles are a judgment consumers *invoke*; they are never wired into paperdoll validity, and no future version should wire them in. A body is paperdoll-valid or it is not — one universal judgment; it *additionally* conforms to zero or more profiles — any number of consumer-owned judgments. The rejected alternative (validity conditional on declared type) would make the kernel's laws mean different things for different bodies, dissolving the universality that makes a paperdoll validator portable.

## Dependencies

- **paper-doll/v2 only.** Name-anchored vessel matching and token-based element checks need no element ids, so papermold does **not** depend on paper-doll/v3 — unlike paperchain and paperfold, both blocked on the address grammar. papermold drafting and implementation can proceed in parallel with v3.
- **Composes with paperfold**, twice: monitoring (decision 3) and planning goal-states (below). Neither composition is a dependency — the pure judgment stands alone.

## What this unlocks

- **Life, death, and status thresholds — via the relay.** Poisoned, petrified, airworthy, seaworthy: any state a game cares about becomes a profile plus a reifying patch. The judgment is portable; the semantics stay in the consumer; the state history is diffable.
- **Gates.** Equipment prerequisites: heavy armor demands conformance to `powered-frame` before the equip patch applies. Structural admission: a mech bay whose nominal `accepts: [{ kind: "unit", type: "mech" }]` is upgraded by the consumer to "and conforms to the `mech` profile" — the inspection behind the name tag. Matchmaking: only `arena-legal` bodies enter the arena.
- **Goal states for paperfold planning.** "Patch me until airworthy": profiles are the goal language, paperfold patches the move language. A planner searches patch space for a body conforming to the target profile — the family's first glimpse of ends, not just means.
- **Acceptance tests for procedural generation.** A generator emits candidate bodies; conformance to `viable-creature` filters them. The profile is the spec the generator is tested against, in any language.
- **Save-file gates.** A loader refuses saves whose bodies fail the profiles the game version requires — structural corruption and stale-schema drift caught at the door, mechanically.
- **Design-time linting.** "Every merchant in the world document conforms to `has-shop-inventory`," run in CI. Profiles used the way types check a codebase: authored once, enforced everywhere, failing loudly at build time instead of strangely at runtime.

## Sequencing

1. **papermold v1 drafting** — this document; proceeds now, independent of paper-doll/v3 (no shared prerequisite — see Dependencies). Pure conformance checking can ship before, alongside, or after the v3/paperfold track.
2. **Hardening to a full RFC** — schema, the closed constraint vocabulary as laws, reference validator — *after* the first-party gamecraft consumer (`design-gamecraft-consumer.md`) exercises profiles against real mechanics, per the family's consumer-first discipline.
3. **The paperfold compositions** — monitoring (conformance transitions over the patch stream) and planning (profiles as goal language) inherit paperfold's own prerequisites (the v2.x symmetry-completion and paper-doll/v3), even though pure conformance does not. They land when paperfold does.

The npm name `papermold` is available as of 2026-07-10 and not yet registered — to be reserved alongside the family's placeholders.

## Open questions

- **Port-demand strictness.** Whether a profile's port clause requires the exact reciprocal pair or only the named vessel's own face — to be settled when the constraint vocabulary is written as laws.
- **Recursive conformance meets nesting depth.** Whether implementations bound profile-recursion depth the same way body-embedding depth may be bounded, and whether mutual profile references within a document are legal or rejected.
- **Reporting shape.** The judgment is a boolean; whether the reference validator additionally reports *which* clause failed (in the style of paperdoll's precise-path errors) is implementation surface to be decided at hardening, not spec.
