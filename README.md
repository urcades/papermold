# papermold

`papermold` is a small TypeScript protocol library for structural conformance of [paperdoll](https://github.com/urcades/paperdoll) bodies: consumer-authored **profiles**, judged. A profile is a stencil — a pattern document declaring what a body must structurally have in order to count as an instance of a kind — and conformance is the pure judgment `body : profile`, runnable by any validator in any language with the two documents in hand and nothing else.

It is the judgment layer of the paper* family. The kernel's typing is nominal-on-trust: anything can claim `type: "mech"`, and the protocol matches names, never meanings. **Envelope typing is a name tag. A profile is an inspection. papermold is the difference between the two.**

## The relay

Profiles judge structure only — never data. `ContainedElement.data` is opaque to every protocol in the family, and papermold, the sibling most tempted to peek, is no exception: no clause can read, compare, or even acknowledge `data`. "Alive" cannot mean `hp > 0`, because `hp` lives in `data` and data is invisible. Instead: the game mutates `hp` freely; when a threshold crosses, it applies a [paperfold](https://github.com/urcades/paperfold) patch that *structurally reifies* the state — insert a `{ kind: "status", type: "dead" }` element, delete the `head` vessel, seal a slot. Conformance then flips, mechanically, in any validator:

> **gamecraft counts → paperfold reifies → papermold judges.**

This is design, not limitation: judgments stay language-neutral, every game-significant state becomes structurally visible, saves diff, histories replay, and cheating shows up as a structural anomaly instead of hiding in an opaque blob.

## Install

```sh
npm install papermold
```

## Minimal Document

```ts
import { PAPERMOLD_PROTOCOL, conforms, judge } from "papermold";
import type { Body, PapermoldDocument } from "papermold";

const profiles: PapermoldDocument = {
  protocol: PAPERMOLD_PROTOCOL,
  profiles: {
    "living-human": {
      vessels: {
        head: { exists: true, ports: { bottom: { vessel: "body", side: "top" } } },
        body: { forbids: [{ kind: "status", type: "dead" }] }
      }
    }
  }
};

const alice: Body = {
  root: "body",
  vessels: {
    head: { ports: { bottom: { vessel: "body", side: "top" } } },
    body: { ports: { top: { vessel: "head", side: "bottom" } } }
  }
};

console.log(conforms(alice, profiles, "living-human")); // true

// the reifying patch lands: a dead-status element appears in the body vessel
const dead: Body = {
  ...alice,
  vessels: { ...alice.vessels, body: { ...alice.vessels.body, contains: [{ kind: "status", type: "dead" }] } }
};

console.log(conforms(dead, profiles, "living-human")); // false
console.log(judge(dead, profiles, "living-human"));
// [{ path: '$.profiles.living-human.vessels.body.forbids.0',
//    message: 'Body vessel "body" contains a forbidden "status/dead" element.' }]
```

## The Clauses

Matching is **name-anchored**: a profile's vessel id is looked up literally in the body — no pattern variables, no "any vessel shaped like a head" — which keeps conformance a linear walk instead of subgraph isomorphism. Per named vessel:

| clause | demands | passes when |
|---|---|---|
| `exists: true` | presence | the body has a vessel by that name |
| `ports` | geometry | each demanded side carries exactly the demanded port address (one-sided literal check; the kernel already guarantees reciprocity) |
| `acceptsAtLeast` | capability | the vessel's `accepts` admits every element each token describes — a token equal or more general (same kind, no type); absent `accepts` (open) passes, `accepts: []` (sealed) fails |
| `containsAtLeast` | presence | at least one contained element matches each token (kernel `matches()`) |
| `conformsTo` | recursion | some contained element matches the token *and* embeds a body conforming to the named profile of the same document |
| `forbids` | absence | no contained element matches any listed token — how "alive" is spelled |

And one profile-level clause, because it spans vessels:

| clause | demands | passes when |
|---|---|---|
| `atLeast: { n, of }` | threshold | at least `n` of the named `(vessel, check)` pairs pass — e.g. 2 of 4 organ vessels intact |

A vessel the profile names that is absent from the body fails all its demands with a single "no vessel" error. Cyclic `conformsTo` references are legal and always terminate: conformance descends into strictly smaller embedded bodies.

## Operations

All functions are pure; inputs are never mutated.

- `judge(body, document, profileId)` — the judgment: `ProtocolError[]`, empty meaning the body conforms. Every failure names the profile-side clause in its path (`$.profiles.living-human.vessels.head.ports.bottom`) and the body-side fact in its message. Requires a kernel-valid body and a valid profile document — invalid input throws formatted errors; the returned list speaks only of conformance.
- `conforms(body, document, profileId)` — the boolean: `judge(...).length === 0`.
- `parseProfiles` / `validateProfiles` / `assertProfiles` — strict structural validation with path-annotated errors; unknown keys anywhere are rejected; all errors collected; `parseProfiles` returns a deep copy.

There are no profile-editing operations: profiles are authored documents, not built incrementally. The entire surface is parse + judge.

## Scene Profiles (papermold/v2)

papermold/v2 extends the judgment from bodies to [paperchain](https://github.com/urcades/paperchain) scenes: "armed", "engaged", "a valid trade" as pure conformance judgments over a whole scene — its bodies, its kind declarations, and its relations. A `papermold/v2` document carries two namespaces: `profiles` (the v1 grammar verbatim) and `sceneProfiles`, whose clauses may reference the body profiles beside them (same document only, as ever).

```ts
import { PAPERMOLD_SCENE_PROTOCOL, conformsScene, judgeScene } from "papermold";
import type { PapermoldSceneDocument } from "papermold";

const doc: PapermoldSceneDocument = {
  protocol: PAPERMOLD_SCENE_PROTOCOL,
  profiles: {
    combatant: { vessels: { torso: { forbids: [{ kind: "status", type: "dead" }] } } }
  },
  sceneProfiles: {
    engaged: {
      kinds: { fights: { declaration: { symmetric: true } } },
      relations: [{ at: "red", kind: "fights", atLeast: 1, otherEndpoint: { prefix: "blue" } }],
      forAllBodies: [{ excluding: ["pool"], check: { conformsTo: "combatant" } }]
    },
    disarmed: {
      forbidsRelations: [{ kind: "grasps", at: "red" }]
    }
  }
};

conformsScene(scene, doc, "engaged"); // boolean; judgeScene(...) for the clause failures
```

The scene clauses: **`bodies`** (a named body exists / conforms to a body profile), **`kinds`** (a kind is declared / its declaration field-subset-matches — `fromMax: 1` demanded means declared and equal), **`relations`** (count relations of a kind touching an **anchor** — a body name or scene address, matched by subtree containment, so a sword sheathed inside the hand still counts as wielded by the hand — against `atLeast`/`atMost`, optionally restricted by `role` or an `otherEndpoint` filter), **`forAllBodies`** (a universal body check, with `excluding`), and **`forbidsRelations`** (no relation of a kind exists, optionally under an anchor). Every clause binds at most one implicit variable and clauses share none — no joins, no relation-graph queries; universal multiplicity ("every hand at most one sword") delegates to paperchain's declared budgets, which scene validity already enforces. `conformsTo` on the scene side is reference-only: a failing body yields one wrapper error, never the nested failures.

v1 documents remain valid interchange and the v1 judgment is unchanged; only the v2 document kind depends on paperchain. See the papermold/v2 section of [`docs/spec.md`](docs/spec.md).

## What papermold does not do

- **No data reads — permanently excluded, not deferred.** No clause can see `ContainedElement.data`. See the relay.
- **Checked, not monitored.** No subscriptions, no events, no "tell me the moment alice stops conforming" — that would import time into a pure judgment, and time is [paperfold](https://github.com/urcades/paperfold)'s sole property. Monitoring is a paperfold composition: re-judge after each patch and diff the verdicts.
- **No boolean combinators.** `forbids` is negation; `atLeast: 1` is disjunction; that is enough.
- **Never wired into paperdoll validity.** Claiming `type: "mech"` never requires conforming to a mech profile; profiles are a judgment consumers *invoke*. A body is paperdoll-valid or not — one universal judgment; it additionally conforms to zero or more profiles — any number of consumer-owned judgments.
- **No cross-vocabulary interpretation.** "A cockpit counts as a head" is subsumption — vocabulary-manifest territory, if that ever exists.

## The Family

- [paperdoll](https://github.com/urcades/paperdoll) — the kernel: bodies, vessels, containment, the eight laws. papermold reads it; it never reads papermold.
- [paperchain](https://github.com/urcades/paperchain) — the relations layer: scenes of bodies and the relations between them.
- [paperfold](https://github.com/urcades/paperfold) — the dynamics layer: patches over bodies — diff, apply, compose, invert.
- [papermold](https://github.com/urcades/papermold) — the judgment layer: this library.

Profiles-of-scenes shipped as papermold/v2 (above) once versus mode in paperdoll-viewer supplied the consumer — bodies first, then scenes, on the family's one-consumer-at-a-time discipline.

## Portability

The protocol is not the TypeScript library — it is the document format plus the clause semantics. [`schema/papermold-v1.schema.json`](schema/papermold-v1.schema.json) and [`schema/papermold-v2.schema.json`](schema/papermold-v2.schema.json) are JSON Schemas (2020-12) capturing the structural laws of each document kind; the semantics beyond schema expressiveness — same-document `conformsTo` resolution, `n <= of.length`, `atLeast <= atMost`, and the judgments themselves — are specified in [`docs/spec.md`](docs/spec.md). Any language can validate profile documents and judge conformance against any paperdoll implementation.

## API

- constants: `PAPERMOLD_PROTOCOL`, `PAPERMOLD_SCENE_PROTOCOL`
- validation: `parseProfiles`, `assertProfiles`, `validateProfiles`, `parseSceneProfiles`, `assertSceneProfiles`, `validateSceneProfiles`, `formatProtocolErrors` (re-exported from paperdoll)
- judgment: `judge`, `conforms` (v1); `judgeScene`, `conformsScene`, `judgeBody`, `conformsBody` (v2)
- types: `PapermoldDocument`, `Profile`, `VesselDemand`, `ConformsToDemand`, `AtLeast`, `AtLeastCheck`; v2's `PapermoldSceneDocument`, `SceneProfile`, `BodyDemand`, `KindDemand`, `RelationDemand`, `EndpointFilter`, `ForAllBodiesCheck`, `RelationBan`; plus re-exported kernel types (`AcceptToken`, `Body`, `ContainedElement`, `PortAddress`, `ProtocolError`, `Result`, `Side`, `Vessel`, `VesselId`) and paperchain types (`BodyName`, `KindDeclaration`, `KindId`, `Relation`, `Scene`, `SceneAddress`)

Validation is strict: unknown keys anywhere in a profile document are rejected, every error names its path, and validation collects all errors.

## Design Notes

See [`docs/rfc-papermold.md`](docs/rfc-papermold.md) for the pre-RFC lineage (the five decisions: name-anchoring, the closed constraint vocabulary, checked-not-monitored, same-document references, conformance always opt-in), and [`docs/spec.md`](docs/spec.md) for the hardened v1 specification with resolved micro-decisions.
