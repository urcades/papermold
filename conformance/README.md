# Papermold conformance

These hand-authored `paper-family-conformance/v2` corpora bind the normative
papermold specifications to public API behavior. They are shared by the
TypeScript adapter in `typescript/extended_conformance.ts` and the independent
standard-library Python reference shipped by `paperchain`.

The TypeScript adapter and its Vitest test are source-checkout tooling. The
published package omits `src/` and `test/`; the adapter remains an
instructional example for other implementations. From a source checkout, run:

```sh
npx vitest run test/conformance.test.ts
```

The published package includes the corpus JSON and standard-library Python
cross-language scripts. From a source checkout after installing dependencies,
run the packaged workflow against the same JSON with:

```sh
npm run test:conformance:python
```

The npm command invokes `scripts/cross-language.py`, which resolves the
installed `paperchain` conformance modules and dispatches Mold cases to its
independent `papermold.py` reference. Local pre-release integration may instead
resolve a sibling paperchain checkout. `npm run test:cross-language` checks the
TypeScript and Python projections over the same cases.
Build once with `npm run build` when running cross-language checks from a
source checkout; published artifacts are already built.

The 25 cases cover every v1 body clause and v2 scene clause, structural
validation and invalid profiles, exact and wildcard tokens, recursive profiles,
thresholds, anchors and endpoint selectors, symmetric role/count semantics,
body and kind demands, universal and forbidden-relation clauses, namespace and
missing-name errors, explicit `constructor` keys, boolean projections, and
caller-domain errors. The TypeScript suite also verifies that mutation between
public calls is re-evaluated rather than served from stale memo state.
