import { describe, expect, it } from "vitest";
import { validateScene } from "paperchain";
import type { Scene } from "paperchain";
import type { Body } from "paperdoll";
import {
  PAPERMOLD_PROTOCOL,
  PAPERMOLD_SCENE_PROTOCOL,
  assertSceneProfiles,
  conformsBody,
  conformsScene,
  judge,
  judgeBody,
  judgeScene,
  parseSceneProfiles,
  validateSceneProfiles,
  type PapermoldSceneDocument,
  type SceneProfile
} from "../src/index";
import { VERSUS_PROFILES, VERSUS_SCENE } from "./versus-arena";

// A document sharing the fixture's body profiles, with test-local scene
// profiles swapped in.
function docWith(sceneProfiles: Record<string, SceneProfile>): PapermoldSceneDocument {
  return {
    protocol: PAPERMOLD_SCENE_PROTOCOL,
    profiles: structuredClone(VERSUS_PROFILES.profiles),
    sceneProfiles
  };
}

// The fixture scene plus a second wields relation whose "to" endpoint is the
// dagger sheathed deep inside red's hand — from blue's hand, so the wields
// fromMax/toMax budgets of 1 still hold.
function withDaggerWield(): Scene {
  const scene = structuredClone(VERSUS_SCENE);
  scene.relations.push({
    kind: "wields",
    from: "blue/right-hand",
    to: "red/right-hand/sheath/sheath-shell/sheathed-dagger"
  });
  return scene;
}

// The fixture scene plus a grapple, stored as (blue -> red).
function withGrapple(): Scene {
  const scene = structuredClone(VERSUS_SCENE);
  scene.relations.push({ kind: "grapples", from: "blue/torso", to: "red/torso" });
  return scene;
}

describe("the versus-arena fixture", () => {
  it("is a valid paperchain scene and a valid scene-profile document", () => {
    expect(validateScene(VERSUS_SCENE)).toEqual([]);
    expect(validateSceneProfiles(VERSUS_PROFILES)).toEqual([]);
  });
});

describe("validateSceneProfiles", () => {
  it("accepts the fixture document, including an empty (vacuous) scene profile", () => {
    expect(validateSceneProfiles(docWith({ vacuous: {} }))).toEqual([]);
  });

  it("rejects non-object documents and wrong protocols", () => {
    expect(validateSceneProfiles(null)).toEqual([
      { path: "$", message: "Scene profile document must be an object." }
    ]);
    const errors = validateSceneProfiles({ protocol: "papermold/v1", profiles: {}, sceneProfiles: {} });
    expect(errors.map((error) => error.path)).toContain("$.protocol");
  });

  it("rejects non-record profiles and sceneProfiles", () => {
    const badProfiles = validateSceneProfiles({ protocol: PAPERMOLD_SCENE_PROTOCOL, profiles: [], sceneProfiles: {} });
    expect(badProfiles.map((error) => error.path)).toContain("$.profiles");

    const badScenes = validateSceneProfiles({ protocol: PAPERMOLD_SCENE_PROTOCOL, profiles: {}, sceneProfiles: null });
    expect(badScenes).toEqual([
      { path: "$.sceneProfiles", message: "Scene profiles must be an object keyed by scene profile id." }
    ]);
  });

  it("rejects unknown keys at every level, with paths", () => {
    const errors = validateSceneProfiles({
      protocol: PAPERMOLD_SCENE_PROTOCOL,
      sneaky: true,
      profiles: {},
      sceneProfiles: {
        p: {
          version: 2,
          bodies: { red: { exists: true, note: "?" } },
          kinds: { wields: { declared: true, weight: 1 } },
          relations: [{ at: "red", kind: "wields", atLeast: 1, why: "?" }],
          forAllBodies: [{ check: { exists: true }, mode: "all" }],
          forbidsRelations: [{ kind: "wields", severity: 9 }]
        }
      }
    } as never);
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.sneaky");
    expect(paths).toContain("$.sceneProfiles.p.version");
    expect(paths).toContain("$.sceneProfiles.p.bodies.red.note");
    expect(paths).toContain("$.sceneProfiles.p.kinds.wields.weight");
    expect(paths).toContain("$.sceneProfiles.p.relations.0.why");
    expect(paths).toContain("$.sceneProfiles.p.forAllBodies.0.mode");
    expect(paths).toContain("$.sceneProfiles.p.forbidsRelations.0.severity");
    expect(errors).toHaveLength(7);
  });

  it("rejects invalid scene profile ids, body names, and kind ids", () => {
    const errors = validateSceneProfiles(
      docWith({
        Bad: { bodies: { "Also-Bad": { exists: true } }, kinds: { Worse: { declared: true } } }
      } as never)
    );
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.sceneProfiles.Bad");
    expect(paths).toContain("$.sceneProfiles.Bad.bodies.Also-Bad");
    expect(paths).toContain("$.sceneProfiles.Bad.kinds.Worse");
  });

  it("rejects empty body and kind demands", () => {
    const errors = validateSceneProfiles(docWith({ p: { bodies: { red: {} }, kinds: { wields: {} } } }));
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.sceneProfiles.p.bodies.red");
    expect(paths).toContain("$.sceneProfiles.p.kinds.wields");
    expect(errors).toHaveLength(2);
  });

  it("rejects exists and declared written as anything but the literal true", () => {
    const errors = validateSceneProfiles(
      docWith({
        p: {
          bodies: { red: { exists: false as unknown as true } },
          kinds: { wields: { declared: 1 as unknown as true } }
        }
      })
    );
    expect(errors.map((error) => error.path)).toEqual([
      "$.sceneProfiles.p.bodies.red.exists",
      "$.sceneProfiles.p.kinds.wields.declared"
    ]);
  });

  it("rejects a relation demand missing both atLeast and atMost", () => {
    const errors = validateSceneProfiles(docWith({ p: { relations: [{ at: "red", kind: "wields" }] } }));
    expect(errors).toEqual([
      { path: "$.sceneProfiles.p.relations.0", message: "Relation demand must include atLeast, atMost, or both." }
    ]);
  });

  it("rejects atLeast > atMost, atLeast 0, and bad roles; accepts atMost 0", () => {
    const crossed = validateSceneProfiles(
      docWith({ p: { relations: [{ at: "red", kind: "wields", atLeast: 2, atMost: 1 }] } })
    );
    expect(crossed).toEqual([
      { path: "$.sceneProfiles.p.relations.0.atLeast", message: "atLeast (2) exceeds atMost (1)." }
    ]);

    const zero = validateSceneProfiles(docWith({ p: { relations: [{ at: "red", kind: "wields", atLeast: 0 }] } }));
    expect(zero.map((error) => error.path)).toContain("$.sceneProfiles.p.relations.0.atLeast");

    const role = validateSceneProfiles(
      docWith({ p: { relations: [{ at: "red", kind: "wields", atLeast: 1, role: "sideways" as never }] } })
    );
    expect(role.map((error) => error.path)).toContain("$.sceneProfiles.p.relations.0.role");

    expect(validateSceneProfiles(docWith({ p: { relations: [{ at: "red", kind: "grapples", atMost: 0 }] } }))).toEqual(
      []
    );
  });

  it("rejects bad anchor grammar", () => {
    for (const at of ["Red/hand", "", "a//b"]) {
      const errors = validateSceneProfiles(docWith({ p: { relations: [{ at, kind: "wields", atLeast: 1 }] } }));
      expect(errors.map((error) => error.path)).toContain("$.sceneProfiles.p.relations.0.at");
    }
  });

  it("rejects an otherEndpoint with zero clauses", () => {
    const errors = validateSceneProfiles(
      docWith({ p: { relations: [{ at: "red", kind: "wields", atLeast: 1, otherEndpoint: {} }] } })
    );
    expect(errors).toEqual([
      {
        path: "$.sceneProfiles.p.relations.0.otherEndpoint",
        message: "otherEndpoint must include at least one clause (prefix, conformsTo)."
      }
    ]);
  });

  it("rejects an empty excluding array and forAllBodies without a check", () => {
    const empty = validateSceneProfiles(
      docWith({ p: { forAllBodies: [{ excluding: [], check: { exists: true } }] } })
    );
    expect(empty.map((error) => error.path)).toContain("$.sceneProfiles.p.forAllBodies.0.excluding");

    const noCheck = validateSceneProfiles(docWith({ p: { forAllBodies: [{ excluding: ["pool"] }] } } as never));
    expect(noCheck).toEqual([
      { path: "$.sceneProfiles.p.forAllBodies.0.check", message: "forAllBodies requires a check body demand." }
    ]);
  });

  it("revalidates kind declaration shapes, including toMax on a symmetric kind", () => {
    const errors = validateSceneProfiles(
      docWith({
        p: {
          kinds: {
            grip: { declaration: { symmetric: true, toMax: 1 } },
            pull: { declaration: { fromMax: -1, irreflexive: "yes" as never } }
          }
        }
      })
    );
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.sceneProfiles.p.kinds.grip.declaration.toMax");
    expect(paths).toContain("$.sceneProfiles.p.kinds.pull.declaration.fromMax");
    expect(paths).toContain("$.sceneProfiles.p.kinds.pull.declaration.irreflexive");
    expect(errors.find((error) => error.path.endsWith("grip.declaration.toMax"))?.message).toBe(
      "Symmetric kinds may not declare toMax; positions are one pool."
    );
  });

  it("rejects dangling conformsTo references at all three scene-side sites", () => {
    const errors = validateSceneProfiles(
      docWith({
        p: {
          bodies: { red: { conformsTo: "phantom" } },
          relations: [{ at: "red", kind: "wields", atLeast: 1, otherEndpoint: { conformsTo: "phantom" } }],
          forAllBodies: [{ check: { conformsTo: "phantom" } }]
        }
      })
    );
    const message = 'References missing profile "phantom"; conformsTo resolves within this document only.';
    expect(errors).toEqual([
      { path: "$.sceneProfiles.p.bodies.red.conformsTo", message },
      { path: "$.sceneProfiles.p.relations.0.otherEndpoint.conformsTo", message },
      { path: "$.sceneProfiles.p.forAllBodies.0.check.conformsTo", message }
    ]);
  });

  it("still catches a dangling conformsTo in the v1 profiles half", () => {
    const errors = validateSceneProfiles({
      protocol: PAPERMOLD_SCENE_PROTOCOL,
      profiles: {
        p: { vessels: { torso: { conformsTo: { token: { kind: "part" }, profile: "ghostly" } } } }
      },
      sceneProfiles: {}
    });
    expect(errors).toEqual([
      {
        path: "$.profiles.p.vessels.torso.conformsTo.profile",
        message: 'References missing profile "ghostly"; conformsTo resolves within this document only.'
      }
    ]);
  });
});

describe("parseSceneProfiles / assertSceneProfiles", () => {
  it("returns a deep copy, decoupled from the input in both directions", () => {
    const input = structuredClone(VERSUS_PROFILES);
    const result = parseSceneProfiles(input);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.protocol).toBe(PAPERMOLD_SCENE_PROTOCOL);

    input.sceneProfiles["armed-red"].relations![0].atLeast = 9;
    expect(result.value.sceneProfiles["armed-red"].relations![0].atLeast).toBe(1);

    result.value.profiles["living-combatant"].vessels!.torso.exists = undefined as never;
    expect(input.profiles["living-combatant"].vessels!.torso.exists).toBe(true);
  });

  it("returns the errors on invalid input instead of a value", () => {
    const result = parseSceneProfiles(docWith({ p: { bodies: { red: {} } } }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected errors");
    expect(result.errors.map((error) => error.path)).toContain("$.sceneProfiles.p.bodies.red");
  });

  it("assertSceneProfiles throws formatted, path-annotated errors", () => {
    expect(() => assertSceneProfiles(docWith({ p: { bodies: { red: {} } } }))).toThrow(
      "$.sceneProfiles.p.bodies.red:"
    );
  });
});

describe("judgeScene: input discipline", () => {
  it("throws on an invalid scene, with the scene's formatted errors", () => {
    const invalid = { ...structuredClone(VERSUS_SCENE), protocol: "nope" } as unknown as Scene;
    expect(() => judgeScene(invalid, VERSUS_PROFILES, "armed-red")).toThrow("$.protocol");
  });

  it("throws on an invalid document", () => {
    const invalid = docWith({ p: { bodies: { red: { conformsTo: "phantom" } } } });
    expect(() => judgeScene(VERSUS_SCENE, invalid, "p")).toThrow('missing profile "phantom"');
  });

  it("throws on a scene profile id the document does not define", () => {
    expect(() => judgeScene(VERSUS_SCENE, VERSUS_PROFILES, "ghost")).toThrow(
      'Scene profile "ghost" does not exist in the document.'
    );
  });

  it("returns errors on nonconformance instead of throwing", () => {
    const errors = judgeScene(VERSUS_SCENE, VERSUS_PROFILES, "engaged");
    expect(errors).toHaveLength(1);
    expect(conformsScene(VERSUS_SCENE, VERSUS_PROFILES, "engaged")).toBe(false);
  });
});

describe("judgeScene: bodies", () => {
  it("fails a missing body with a single error — absence dominates conformsTo", () => {
    const document = docWith({ p: { bodies: { green: { exists: true, conformsTo: "living-combatant" } } } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      { path: "$.sceneProfiles.p.bodies.green", message: 'Scene has no body "green".' }
    ]);
  });

  it("passes conformsTo for a conforming body", () => {
    const document = docWith({ p: { bodies: { red: { conformsTo: "living-combatant" } } } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([]);
  });

  it("fails conformsTo with the wrapper error only — nested failures are not forwarded", () => {
    const document = docWith({ p: { bodies: { pool: { conformsTo: "living-combatant" } } } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      {
        path: "$.sceneProfiles.p.bodies.pool.conformsTo",
        message: 'Scene body "pool" does not conform to profile "living-combatant".'
      }
    ]);
  });
});

describe("judgeScene: kinds", () => {
  it("fails an undeclared kind", () => {
    const document = docWith({ p: { kinds: { blesses: { declared: true } } } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      { path: "$.sceneProfiles.p.kinds.blesses", message: 'Scene declares no kind "blesses".' }
    ]);
  });

  it("normalizes absent flags to false: demanding symmetric on wields fails", () => {
    const document = docWith({ p: { kinds: { wields: { declaration: { symmetric: true } } } } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      {
        path: "$.sceneProfiles.p.kinds.wields.declaration.symmetric",
        message: 'Scene kind "wields" declares symmetric: false, not true.'
      }
    ]);
  });

  it("fails a demanded budget the scene leaves unbounded", () => {
    const document = docWith({ p: { kinds: { grapples: { declaration: { toMax: 1 } } } } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      {
        path: "$.sceneProfiles.p.kinds.grapples.declaration.toMax",
        message: 'Scene kind "grapples" declares no toMax; the profile requires toMax: 1.'
      }
    ]);
  });

  it("fails an unequal budget and passes an equal one", () => {
    const unequal = docWith({ p: { kinds: { wields: { declaration: { fromMax: 2 } } } } });
    expect(judgeScene(VERSUS_SCENE, unequal, "p")).toEqual([
      {
        path: "$.sceneProfiles.p.kinds.wields.declaration.fromMax",
        message: 'Scene kind "wields" declares fromMax: 1, not 2.'
      }
    ]);

    const equal = docWith({ p: { kinds: { wields: { declaration: { fromMax: 1, toMax: 1 } } } } });
    expect(judgeScene(VERSUS_SCENE, equal, "p")).toEqual([]);
  });

  it("is a field-subset match: fields the demand does not name are ignored", () => {
    // grapples also declares symmetric and irreflexive; the demand names
    // only fromMax, so they are not compared.
    const document = docWith({ p: { kinds: { grapples: { declaration: { fromMax: 1 } } } } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([]);
  });
});

describe("judgeScene: relations", () => {
  it("passes armed-red on the fixture: red wields the arena sword", () => {
    expect(judgeScene(VERSUS_SCENE, VERSUS_PROFILES, "armed-red")).toEqual([]);
    expect(conformsScene(VERSUS_SCENE, VERSUS_PROFILES, "armed-red")).toBe(true);
  });

  it("fails atLeast after the wields relation is removed", () => {
    const disarmed = structuredClone(VERSUS_SCENE);
    disarmed.relations = disarmed.relations.filter((relation) => relation.kind !== "wields");
    expect(judgeScene(disarmed, VERSUS_PROFILES, "armed-red")).toEqual([
      {
        path: "$.sceneProfiles.armed-red.relations.0.atLeast",
        message: 'Anchor "red" participates in 0 counted "wields" relations; the profile requires at least 1.'
      }
    ]);
  });

  it("fails atMost when the count exceeds it", () => {
    const document = docWith({ p: { relations: [{ at: "red", kind: "wields", atMost: 0 }] } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      {
        path: "$.sceneProfiles.p.relations.0.atMost",
        message: 'Anchor "red" participates in 1 counted "wields" relations; the profile allows at most 0.'
      }
    ]);
  });

  it("anchors subtrees: a relation to the sheathed dagger counts for the hand and the body", () => {
    const scene = withDaggerWield();
    expect(validateScene(scene)).toEqual([]);
    const document = docWith({
      hand: { relations: [{ at: "red/right-hand", kind: "wields", atLeast: 2 }] },
      body: { relations: [{ at: "red", kind: "wields", atLeast: 2 }] }
    });
    expect(judgeScene(scene, document, "hand")).toEqual([]);
    expect(judgeScene(scene, document, "body")).toEqual([]);
  });

  it('guards the prefix boundary: anchor "red" does not match body "red-two"', () => {
    const scene = structuredClone(VERSUS_SCENE);
    scene.bodies["red-two"] = {
      root: "arm",
      vessels: { arm: { contains: [{ kind: "item", type: "club", id: "club" }] } }
    };
    scene.relations.push({ kind: "wields", from: "red-two/arm", to: "red-two/arm/club" });
    expect(validateScene(scene)).toEqual([]);
    const document = docWith({
      p: { relations: [{ at: "red", kind: "wields", atLeast: 1, atMost: 1 }] },
      sanity: { relations: [{ at: "red-two", kind: "wields", atLeast: 1, atMost: 1 }] }
    });
    expect(judgeScene(scene, document, "p")).toEqual([]);
    expect(judgeScene(scene, document, "sanity")).toEqual([]);
  });

  it("restricts the anchor's position with role on a directional kind", () => {
    const scene = withDaggerWield();
    const document = docWith({
      from: { relations: [{ at: "blue", kind: "wields", role: "from", atLeast: 1, atMost: 1 }] },
      to: { relations: [{ at: "blue", kind: "wields", role: "to", atMost: 0 }] }
    });
    // blue's hand is the "from" of exactly one wields relation and the "to" of none.
    expect(judgeScene(scene, document, "from")).toEqual([]);
    expect(judgeScene(scene, document, "to")).toEqual([]);
  });

  it("degrades role to either-position on a symmetric kind", () => {
    const scene = withGrapple(); // stored as (blue -> red)
    const document = docWith({
      p: { relations: [{ at: "red", kind: "grapples", role: "from", atLeast: 1 }] }
    });
    expect(judgeScene(scene, document, "p")).toEqual([]);
  });

  it("counts a symmetric relation from either position", () => {
    const scene = withGrapple(); // stored as (blue -> red); still counts for red
    const document = docWith({ p: { relations: [{ at: "red", kind: "grapples", atLeast: 1, atMost: 1 }] } });
    expect(judgeScene(scene, document, "p")).toEqual([]);
  });

  it("counts a self-relation once, not twice", () => {
    const scene = structuredClone(VERSUS_SCENE);
    scene.kinds.hums = { symmetric: true };
    scene.relations.push({ kind: "hums", from: "red/torso", to: "red/torso" });
    expect(validateScene(scene)).toEqual([]);
    const document = docWith({ p: { relations: [{ at: "red", kind: "hums", atLeast: 1, atMost: 1 }] } });
    expect(judgeScene(scene, document, "p")).toEqual([]);
  });

  it("filters by otherEndpoint prefix: engaged needs the grapple's other end under blue", () => {
    expect(judgeScene(withGrapple(), VERSUS_PROFILES, "engaged")).toEqual([]);

    const wrongPartner = structuredClone(VERSUS_SCENE);
    wrongPartner.relations.push({ kind: "grapples", from: "red/torso", to: "pool/pool" });
    expect(judgeScene(wrongPartner, VERSUS_PROFILES, "engaged")).toEqual([
      {
        path: "$.sceneProfiles.engaged.relations.0.atLeast",
        message: 'Anchor "red" participates in 0 counted "grapples" relations; the profile requires at least 1.'
      }
    ]);
  });

  it("filters by otherEndpoint conformsTo", () => {
    const document = docWith({
      p: {
        relations: [
          { at: "red", kind: "grapples", atLeast: 1, otherEndpoint: { conformsTo: "living-combatant" } }
        ]
      }
    });
    // Grappled by blue (a living combatant): counts.
    expect(judgeScene(withGrapple(), document, "p")).toEqual([]);

    // Grappling the pool (not a living combatant): filtered out.
    const poolGrapple = structuredClone(VERSUS_SCENE);
    poolGrapple.relations.push({ kind: "grapples", from: "red/torso", to: "pool/pool" });
    expect(judgeScene(poolGrapple, document, "p")).toEqual([
      {
        path: "$.sceneProfiles.p.relations.0.atLeast",
        message: 'Anchor "red" participates in 0 counted "grapples" relations; the profile requires at least 1.'
      }
    ]);
  });

  it("fails an unresolvable anchor with a single error — counting is shadowed", () => {
    const document = docWith({
      p: { relations: [{ at: "red/left-hand", kind: "wields", atLeast: 1, atMost: 1 }] }
    });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      { path: "$.sceneProfiles.p.relations.0", message: 'Anchor "red/left-hand" does not resolve in the scene.' }
    ]);
  });
});

describe("judgeScene: forAllBodies", () => {
  it("passes legal-duel on the fixture: both combatants are living, pool excluded", () => {
    expect(judgeScene(VERSUS_SCENE, VERSUS_PROFILES, "legal-duel")).toEqual([]);
  });

  it("reports one error per failing body, naming the witness", () => {
    const wounded = structuredClone(VERSUS_SCENE);
    wounded.bodies.blue.vessels.torso.contains = wounded.bodies.blue.vessels.torso.contains!.filter(
      (element) => element.kind !== "organ"
    );
    expect(judgeScene(wounded, VERSUS_PROFILES, "legal-duel")).toEqual([
      {
        path: "$.sceneProfiles.legal-duel.forAllBodies.0.check.conformsTo",
        message: 'Scene body "blue" does not conform to profile "living-combatant".'
      }
    ]);
  });

  it("reports two errors when two bodies fail", () => {
    const carnage = structuredClone(VERSUS_SCENE);
    for (const name of ["red", "blue"] as const) {
      carnage.bodies[name].vessels.torso.contains = carnage.bodies[name].vessels.torso.contains!.filter(
        (element) => element.kind !== "organ"
      );
    }
    expect(judgeScene(carnage, VERSUS_PROFILES, "legal-duel")).toEqual([
      {
        path: "$.sceneProfiles.legal-duel.forAllBodies.0.check.conformsTo",
        message: 'Scene body "blue" does not conform to profile "living-combatant".'
      },
      {
        path: "$.sceneProfiles.legal-duel.forAllBodies.0.check.conformsTo",
        message: 'Scene body "red" does not conform to profile "living-combatant".'
      }
    ]);
  });

  it("honors excluding: without it, pool is a witness", () => {
    const document = docWith({ p: { forAllBodies: [{ check: { conformsTo: "living-combatant" } }] } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      {
        path: "$.sceneProfiles.p.forAllBodies.0.check.conformsTo",
        message: 'Scene body "pool" does not conform to profile "living-combatant".'
      }
    ]);
  });
});

describe("judgeScene: forbidsRelations", () => {
  it("passes a ban with no witnesses", () => {
    const document = docWith({ p: { forbidsRelations: [{ kind: "grapples" }] } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([]);
  });

  it("fails a ban with witnesses, reporting the count", () => {
    const document = docWith({ p: { forbidsRelations: [{ kind: "wields" }] } });
    expect(judgeScene(VERSUS_SCENE, document, "p")).toEqual([
      { path: "$.sceneProfiles.p.forbidsRelations.0", message: 'Scene contains 1 forbidden "wields" relation.' }
    ]);
  });

  it("only counts relations under an anchored ban's anchor", () => {
    const document = docWith({
      clear: { forbidsRelations: [{ kind: "wields", at: "blue" }] },
      caught: { forbidsRelations: [{ kind: "wields", at: "red" }] }
    });
    expect(judgeScene(VERSUS_SCENE, document, "clear")).toEqual([]);
    expect(judgeScene(VERSUS_SCENE, document, "caught")).toEqual([
      {
        path: "$.sceneProfiles.caught.forbidsRelations.0",
        message: 'Scene contains 1 forbidden "wields" relation under "red".'
      }
    ]);
  });
});

describe("judgeBody / conformsBody", () => {
  it("judges a conforming body empty against the document's body profiles", () => {
    expect(judgeBody(VERSUS_SCENE.bodies.red, VERSUS_PROFILES, "living-combatant")).toEqual([]);
    expect(conformsBody(VERSUS_SCENE.bodies.blue, VERSUS_PROFILES, "living-combatant")).toBe(true);
    expect(conformsBody(VERSUS_SCENE.bodies.pool, VERSUS_PROFILES, "living-combatant")).toBe(false);
  });

  it("throws on a kernel-invalid body", () => {
    const invalid = { root: "torso", vessels: {} } as Body;
    expect(() => judgeBody(invalid, VERSUS_PROFILES, "living-combatant")).toThrow("$.body.root");
  });

  it("throws on a profile id the document does not define", () => {
    expect(() => judgeBody(VERSUS_SCENE.bodies.red, VERSUS_PROFILES, "ghost")).toThrow(
      'Profile "ghost" does not exist in the document.'
    );
  });

  it("matches v1 judge for the same profile on a re-wrapped v1 document", () => {
    const v1Document = { protocol: PAPERMOLD_PROTOCOL, profiles: structuredClone(VERSUS_PROFILES.profiles) };
    for (const body of [VERSUS_SCENE.bodies.red, VERSUS_SCENE.bodies.pool]) {
      expect(judgeBody(body, VERSUS_PROFILES, "living-combatant")).toEqual(
        judge(body, v1Document, "living-combatant")
      );
    }
  });
});

describe("the relay: scene judgment never reads element data", () => {
  it("ignores nonsensical hp data — verdicts flip on structure alone", () => {
    // The fixture's red muscle element carries { hp: -9999 }; a judge that
    // peeked would call red dead. Every verdict is unmoved.
    expect(VERSUS_SCENE.bodies.red.vessels.torso.contains![0].data).toEqual({ hp: -9999 });
    expect(conformsScene(VERSUS_SCENE, VERSUS_PROFILES, "legal-duel")).toBe(true);
    expect(conformsScene(VERSUS_SCENE, VERSUS_PROFILES, "armed-red")).toBe(true);

    // Cursing the sword's data changes nothing either.
    const cursed = structuredClone(VERSUS_SCENE);
    cursed.bodies.red.vessels["right-hand"].contains![0].data = { cursed: true, hp: -9999 };
    expect(validateScene(cursed)).toEqual([]);
    expect(conformsScene(cursed, VERSUS_PROFILES, "armed-red")).toBe(true);
    expect(conformsScene(cursed, VERSUS_PROFILES, "legal-duel")).toBe(true);
  });
});
