import type { Scene } from "paperchain";
import { PAPERMOLD_SCENE_PROTOCOL, type PapermoldSceneDocument } from "../src/index";

// A two-combatant arena scene for exercising papermold/v2 scene judgment:
// red and blue are small combatant bodies (torso root, head atop, a right
// hand holding gear), pool is a loose-item body. Red's hand holds both the
// arena sword and a sheath whose embedded body holds a dagger — so a scene
// address ("red/right-hand/sheath/sheath-shell/sheathed-dagger") exists
// strictly INSIDE the hand's subtree, pinning subtree anchoring.
//
// Red's muscle element carries data ({ hp: -9999 }) on purpose: scene
// judgment must never read it (the relay — state that judgment needs must
// be reified as structure).
export const VERSUS_SCENE: Scene = {
  protocol: "paperchain/v1",
  bodies: {
    red: {
      root: "torso",
      vessels: {
        torso: {
          ports: {
            top: { vessel: "head", side: "bottom" },
            right: { vessel: "right-hand", side: "left" }
          },
          contains: [
            { kind: "tissue", type: "muscle", id: "red-muscle", data: { hp: -9999 } },
            { kind: "organ", type: "heart", id: "red-heart" }
          ]
        },
        head: {
          ports: { bottom: { vessel: "torso", side: "top" } }
        },
        "right-hand": {
          ports: { left: { vessel: "torso", side: "right" } },
          contains: [
            { kind: "item", type: "sword", id: "arena-sword" },
            {
              kind: "item",
              type: "sheath",
              id: "sheath",
              body: {
                root: "sheath-shell",
                vessels: {
                  "sheath-shell": {
                    contains: [{ kind: "item", type: "dagger", id: "sheathed-dagger" }]
                  }
                }
              }
            }
          ]
        }
      }
    },
    blue: {
      root: "torso",
      vessels: {
        torso: {
          ports: {
            top: { vessel: "head", side: "bottom" },
            right: { vessel: "right-hand", side: "left" }
          },
          contains: [
            { kind: "tissue", type: "muscle", id: "blue-muscle" },
            { kind: "organ", type: "heart", id: "blue-heart" }
          ]
        },
        head: {
          ports: { bottom: { vessel: "torso", side: "top" } }
        },
        "right-hand": {
          ports: { left: { vessel: "torso", side: "right" } },
          contains: [{ kind: "item", type: "sword", id: "blue-sword" }]
        }
      }
    },
    pool: {
      root: "pool",
      vessels: {
        pool: {
          contains: [
            { kind: "item", type: "potion", id: "potion" },
            { kind: "item", type: "rope", id: "rope" }
          ]
        }
      }
    }
  },
  kinds: {
    wields: { fromMax: 1, toMax: 1 },
    grapples: { symmetric: true, irreflexive: true, fromMax: 1 }
  },
  relations: [{ kind: "wields", from: "red/right-hand", to: "red/right-hand/arena-sword" }]
};

// The scene-profile document judged against VERSUS_SCENE. living-combatant
// passes for red and blue (a torso holding an organ) and fails for pool
// (no torso at all).
export const VERSUS_PROFILES: PapermoldSceneDocument = {
  protocol: PAPERMOLD_SCENE_PROTOCOL,
  profiles: {
    "living-combatant": {
      vessels: {
        torso: {
          exists: true,
          containsAtLeast: [{ kind: "organ" }]
        }
      }
    }
  },
  sceneProfiles: {
    "armed-red": {
      relations: [{ at: "red", kind: "wields", atLeast: 1 }]
    },
    engaged: {
      relations: [{ at: "red", kind: "grapples", atLeast: 1, otherEndpoint: { prefix: "blue" } }]
    },
    "legal-duel": {
      forAllBodies: [{ excluding: ["pool"], check: { conformsTo: "living-combatant" } }],
      kinds: { wields: { declaration: { fromMax: 1 } } }
    }
  }
};
