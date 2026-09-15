import { describe, expect, it } from "vitest";

import {
  PAPERMOLD_PROTOCOL,
  PAPERMOLD_SCENE_PROTOCOL,
  validatePortableJson,
  validateProfiles,
  validateSceneProfiles,
  type PapermoldDocument,
  type PapermoldSceneDocument
} from "../src/index";

describe("paper-json-portable/v1 through papermold", () => {
  it("reports an unsafe v1 threshold in addition to its existing length error", () => {
    const profiles: PapermoldDocument = {
      protocol: PAPERMOLD_PROTOCOL,
      profiles: { impossible: { atLeast: { n: 9_007_199_254_740_992, of: [] } } }
    };

    expect(validateProfiles(profiles).map((error) => error.path)).toContain("$.profiles.impossible.atLeast.n");
    expect(validatePortableJson(profiles).map((error) => error.path)).toEqual([
      "$.profiles.impossible.atLeast.n"
    ]);
  });

  it("catches v2 budgets and thresholds that alias after JavaScript parsing", () => {
    const profiles: PapermoldSceneDocument = {
      protocol: PAPERMOLD_SCENE_PROTOCOL,
      profiles: {},
      sceneProfiles: {
        arena: {
          kinds: {
            linked: { declaration: { fromMax: 9_007_199_254_740_991, toMax: 9_007_199_254_740_992 } }
          },
          relations: [
            {
              at: "alice",
              kind: "linked",
              atLeast: 9_007_199_254_740_992,
              atMost: 9_007_199_254_740_992
            }
          ]
        }
      }
    };

    expect(validateSceneProfiles(profiles)).toEqual([]);
    expect(validatePortableJson(profiles).map((error) => error.path)).toEqual([
      "$.sceneProfiles.arena.kinds.linked.declaration.toMax",
      "$.sceneProfiles.arena.relations.0.atLeast",
      "$.sceneProfiles.arena.relations.0.atMost"
    ]);
  });
});
