// Supplemental exhaustive combinations; the hand-authored corpus defines gold
// expectations. These comparisons probe combinations across two implementations.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as mold from '../dist/index.js';
const profiles = {
  empty: {},
  exists: { vessels: { root: { exists: true } } },
  contains: { vessels: { root: { containsAtLeast: [{ kind: 'item' }] } } },
  forbids: { vessels: { root: { forbids: [{ kind: 'item', type: 'bad' }] } } },
  nested: { vessels: { root: { conformsTo: { token: { kind: 'box' }, profile: 'exists' } } } },
  choice: { atLeast: { n: 1, of: [{ vessel: 'root', check: { containsAtLeast: [{ kind: 'item', type: 'good' }] } }, { vessel: 'extra', check: { exists: true } }] } },
  accepts: { vessels: { root: { acceptsAtLeast: [{ kind: 'item' }] } } },
};
const sceneProfiles = {
  all: { forAllBodies: [{ excluding: ['observer'], check: { conformsTo: 'contains' } }] },
  count: { relations: [{ at: 'actor', kind: 'link', atLeast: 1, atMost: 2 }] },
  filtered: { relations: [{ at: 'actor', kind: 'link', role: 'from', atLeast: 1, otherEndpoint: { prefix: 'observer', conformsTo: 'exists' } }] },
  banned: { forbidsRelations: [{ kind: 'link', at: 'actor' }] },
  declared: { kinds: { link: { declared: true, declaration: { symmetric: true } } }, bodies: { actor: { exists: true, conformsTo: 'exists' } } },
};
const cases = [];
for (let bits = 0; bits < 64; bits++) {
  const contains = [];
  if (bits & 1) contains.push({ kind: 'item', type: 'good', id: 'good' });
  if (bits & 2) contains.push({ kind: 'item', type: 'bad', id: 'bad' });
  if (bits & 4) contains.push({ kind: 'box', id: 'box', body: { root: bits & 8 ? 'root' : 'inner', vessels: { [bits & 8 ? 'root' : 'inner']: {} } } });
  const body = { root: 'root', vessels: { root: { contains }, ...(bits & 16 ? { extra: {} } : {}) } };
  // A typed container accepts all generated elements, preserving valid inputs.
  if (bits & 32) body.vessels.root.accepts = [{ kind: 'item' }, { kind: 'box' }];
  for (const id of Object.keys(profiles)) cases.push({ subject: 'papermold/v1', operation: 'conforms', input: { args: [body, { protocol: 'papermold/v1', profiles }, id] } });
  const relations = bits & 1 ? [{ kind: 'link', from: bits & 2 ? 'observer/root' : 'actor/root', to: bits & 2 ? 'actor/root' : 'observer/root' }] : [];
  const scene = { protocol: 'paperchain/v1', bodies: { actor: body, 'actor-two': { root: 'root', vessels: { root: {} } }, observer: { root: 'root', vessels: { root: {} } } },
    kinds: { link: bits & 4 ? { symmetric: true } : {} }, relations };
  for (const id of Object.keys(sceneProfiles)) cases.push({ subject: 'papermold/v2', operation: 'conformsScene', input: { args: [scene, { protocol: 'papermold/v2', profiles, sceneProfiles }, id] } });
}
const before = structuredClone(cases);
const expected = cases.map(c => {
  try { return { outcome: 'ok', value: mold[c.operation](...c.input.args) }; }
  catch { return { outcome: 'error' }; }
});
// All generated inputs are intended to be valid; agreement on an accidental
// caller error must not make this check pass.
assert.ok(expected.every(result => result.outcome === 'ok'));
const run = spawnSync(process.env.PYTHON ?? 'python3', [fileURLToPath(new URL('./cross-language.py', import.meta.url))], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
assert.ifError(run.error);
assert.equal(run.status, 0, run.stderr);
assert.deepEqual(JSON.parse(run.stdout), expected);
assert.deepEqual(cases, before, 'judgments preserve input objects');
console.log(JSON.stringify({ combinations: 64, bodyProfiles: 7, sceneProfiles: 5, comparisons: cases.length, passed: true }));
