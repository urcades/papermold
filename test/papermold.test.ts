import { describe, expect, it } from "vitest";
import { deleteVessel, insertElement } from "paperdoll";
import type { Body } from "paperdoll";
import {
  PAPERMOLD_PROTOCOL,
  assertProfiles,
  conforms,
  judge,
  parseProfiles,
  validateProfiles,
  type PapermoldDocument
} from "../src/index";
import {
  COCKPIT_BODY,
  HUMAN_BODY,
  LIVING_HUMAN,
  MATRYOSHKA_PROFILES,
  MECH_BODY,
  MECH_PROFILES,
  MUTUAL_PROFILES,
  SIDEWAYS_HEAD_BODY
} from "./living-human";

function profilesOf(profiles: PapermoldDocument["profiles"]): PapermoldDocument {
  return { protocol: PAPERMOLD_PROTOCOL, profiles };
}

describe("validateProfiles", () => {
  it("accepts the pre-RFC's living-human document verbatim", () => {
    expect(validateProfiles(LIVING_HUMAN)).toEqual([]);
  });

  it("accepts recursive-conformance profiles, including mutual and self cycles", () => {
    expect(validateProfiles(MECH_PROFILES)).toEqual([]);
    expect(validateProfiles(MATRYOSHKA_PROFILES)).toEqual([]);
    expect(validateProfiles(MUTUAL_PROFILES)).toEqual([]);
  });

  it("rejects non-object documents, wrong protocols, and non-object profiles", () => {
    expect(validateProfiles(null)[0].message).toContain("must be an object");
    expect(validateProfiles({ protocol: "papermold/v2", profiles: {} })[0].path).toBe("$.protocol");
    const errors = validateProfiles({ protocol: PAPERMOLD_PROTOCOL, profiles: [] });
    expect(errors[0].path).toBe("$.profiles");
    expect(errors[0].message).toContain("keyed by profile id");
  });

  it("rejects unknown keys at every level, with paths", () => {
    const errors = validateProfiles({
      protocol: PAPERMOLD_PROTOCOL,
      sneaky: true,
      profiles: {
        p: {
          version: 2,
          vessels: {
            head: { exists: true, note: "?" }
          },
          atLeast: {
            n: 1,
            of: [{ vessel: "liver", check: { exists: true }, weight: 0.5 }],
            mode: "any"
          }
        }
      }
    });
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.sneaky");
    expect(paths).toContain("$.profiles.p.version");
    expect(paths).toContain("$.profiles.p.vessels.head.note");
    expect(paths).toContain("$.profiles.p.atLeast.mode");
    expect(paths).toContain("$.profiles.p.atLeast.of.0.weight");
    expect(errors).toHaveLength(5);
  });

  it("rejects invalid profile and vessel ids", () => {
    const errors = validateProfiles({
      protocol: PAPERMOLD_PROTOCOL,
      profiles: { Bad: { vessels: { "Also-Bad": { exists: true } } } }
    });
    expect(errors.map((error) => error.path)).toEqual(["$.profiles.Bad", "$.profiles.Bad.vessels.Also-Bad"]);
  });

  it("rejects an empty demand object", () => {
    const errors = validateProfiles(profilesOf({ p: { vessels: { head: {} } } }));
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("$.profiles.p.vessels.head");
    expect(errors[0].message).toContain("at least one clause");
  });

  it("rejects exists written as anything but the literal true", () => {
    const errors = validateProfiles(
      profilesOf({ p: { vessels: { head: { exists: false as unknown as true } } } })
    );
    expect(errors.map((error) => error.path)).toContain("$.profiles.p.vessels.head.exists");
  });

  it("rejects bad port demands: empty maps, bad sides, bad addresses", () => {
    const empty = validateProfiles(profilesOf({ p: { vessels: { head: { ports: {} } } } }));
    expect(empty[0].path).toBe("$.profiles.p.vessels.head.ports");
    expect(empty[0].message).toContain("at least one side");

    const errors = validateProfiles(
      profilesOf({
        p: {
          vessels: {
            head: {
              ports: {
                middle: { vessel: "body", side: "top" },
                bottom: { vessel: "body", side: "diagonal" }
              } as never
            }
          }
        }
      })
    );
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.profiles.p.vessels.head.ports.middle");
    expect(paths).toContain("$.profiles.p.vessels.head.ports.bottom.side");
  });

  it("rejects empty token lists and malformed tokens", () => {
    const errors = validateProfiles(
      profilesOf({
        p: {
          vessels: {
            body: {
              acceptsAtLeast: [],
              containsAtLeast: [{ kind: "Nope" }],
              forbids: [{ kind: "status", type: "dead", level: 3 }] as never
            }
          }
        }
      })
    );
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.profiles.p.vessels.body.acceptsAtLeast");
    expect(paths).toContain("$.profiles.p.vessels.body.containsAtLeast.0.kind");
    expect(paths).toContain("$.profiles.p.vessels.body.forbids.0.level");
  });

  it("rejects a dangling conformsTo reference", () => {
    const errors = validateProfiles(
      profilesOf({
        mech: { vessels: { torso: { conformsTo: { token: { kind: "part" }, profile: "reactor-core" } } } }
      })
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("$.profiles.mech.vessels.torso.conformsTo.profile");
    expect(errors[0].message).toContain('missing profile "reactor-core"');
  });

  it("rejects bad atLeast shapes: n < 1, non-integer n, n beyond of, bad entries", () => {
    const zero = validateProfiles(
      profilesOf({ p: { atLeast: { n: 0, of: [{ vessel: "liver", check: { exists: true } }] } } })
    );
    expect(zero[0].path).toBe("$.profiles.p.atLeast.n");

    const fractional = validateProfiles(
      profilesOf({ p: { atLeast: { n: 1.5, of: [{ vessel: "liver", check: { exists: true } }] } } })
    );
    expect(fractional[0].path).toBe("$.profiles.p.atLeast.n");

    const beyond = validateProfiles(
      profilesOf({ p: { atLeast: { n: 3, of: [{ vessel: "liver", check: { exists: true } }] } } })
    );
    expect(beyond[0].path).toBe("$.profiles.p.atLeast.n");
    expect(beyond[0].message).toContain("exceeds the number of checks");

    const entries = validateProfiles(
      profilesOf({ p: { atLeast: { n: 1, of: [{ vessel: "liver" } as never] } } })
    );
    expect(entries.map((error) => error.path)).toContain("$.profiles.p.atLeast.of.0.check");
  });
});

describe("parseProfiles / assertProfiles", () => {
  it("returns a deep copy, decoupled from the input in both directions", () => {
    const input = structuredClone(LIVING_HUMAN) as PapermoldDocument;
    const result = parseProfiles(input);
    if (!result.ok) throw new Error("expected ok");

    input.profiles["living-human"].vessels!.head.exists = undefined as never;
    expect(result.value.profiles["living-human"].vessels!.head.exists).toBe(true);

    result.value.profiles["living-human"].atLeast!.n = 4;
    expect(input.profiles["living-human"].atLeast!.n).toBe(2);
  });

  it("assertProfiles throws formatted, path-annotated errors", () => {
    expect(() => assertProfiles(profilesOf({ p: { vessels: { head: {} } } }))).toThrow(
      "$.profiles.p.vessels.head:"
    );
  });
});

describe("judge: the living-human profile", () => {
  it("judges the conforming body empty, and conforms says yes", () => {
    expect(judge(HUMAN_BODY, LIVING_HUMAN, "living-human")).toEqual([]);
    expect(conforms(HUMAN_BODY, LIVING_HUMAN, "living-human")).toBe(true);
  });

  it("fails decapitation with a single no-vessel error, not one per clause", () => {
    const decapitated = deleteVessel(HUMAN_BODY, "head").body;
    const errors = judge(decapitated, LIVING_HUMAN, "living-human");
    expect(errors).toEqual([
      { path: "$.profiles.living-human.vessels.head", message: 'Body has no vessel "head".' }
    ]);
  });

  it("fails forbids when the dead status is structurally reified", () => {
    const dead = insertElement(HUMAN_BODY, "body", { kind: "status", type: "dead" });
    const errors = judge(dead, LIVING_HUMAN, "living-human");
    expect(errors).toEqual([
      {
        path: "$.profiles.living-human.vessels.body.forbids.0",
        message: 'Body vessel "body" contains a forbidden "status/dead" element.'
      }
    ]);
  });

  it("holds at the atLeast boundary: 2 of 4 organs pass", () => {
    const twoOrgans = deleteVessel(deleteVessel(HUMAN_BODY, "liver").body, "left-lung").body;
    expect(conforms(twoOrgans, LIVING_HUMAN, "living-human")).toBe(true);
  });

  it("fails below the atLeast boundary with one threshold error, not one per check", () => {
    const oneOrgan = deleteVessel(
      deleteVessel(deleteVessel(HUMAN_BODY, "liver").body, "left-lung").body,
      "right-lung"
    ).body;
    const errors = judge(oneOrgan, LIVING_HUMAN, "living-human");
    expect(errors).toEqual([
      {
        path: "$.profiles.living-human.atLeast",
        message: "Only 1 of 4 checks passed; the profile requires at least 2."
      }
    ]);
  });

  it("fails wrong geometry: a head hanging off the side has no bottom port", () => {
    const errors = judge(SIDEWAYS_HEAD_BODY, LIVING_HUMAN, "living-human");
    expect(errors).toEqual([
      {
        path: "$.profiles.living-human.vessels.head.ports.bottom",
        message: 'Body vessel "head" has no port on bottom.'
      }
    ]);
  });

  it("is name-anchored: a cockpit where the head should be does not count", () => {
    const errors = judge(COCKPIT_BODY, LIVING_HUMAN, "living-human");
    expect(errors).toEqual([
      { path: "$.profiles.living-human.vessels.head", message: 'Body has no vessel "head".' }
    ]);
  });
});

describe("judge: ports", () => {
  it("names the actual connection when a demanded port points elsewhere", () => {
    const profiles = profilesOf({
      p: { vessels: { a: { ports: { right: { vessel: "c", side: "left" } } } } }
    });
    const body: Body = {
      root: "a",
      vessels: {
        a: { ports: { right: { vessel: "b", side: "left" } } },
        b: { ports: { left: { vessel: "a", side: "right" } } },
        c: {}
      }
    };
    const errors = judge(body, profiles, "p");
    expect(errors).toEqual([
      {
        path: "$.profiles.p.vessels.a.ports.right",
        message: 'Body vessel "a" right connects to b.left, not c.left.'
      }
    ]);
  });
});

describe("judge: acceptsAtLeast", () => {
  const wearer = profilesOf({
    wearer: { vessels: { torso: { acceptsAtLeast: [{ kind: "item", type: "armor" }] } } }
  });

  function torso(vessel: Body["vessels"][string]): Body {
    return { root: "torso", vessels: { torso: vessel } };
  }

  it("passes an open vessel: absent accepts admits everything", () => {
    expect(conforms(torso({}), wearer, "wearer")).toBe(true);
  });

  it("fails a sealed vessel: accepts [] admits nothing", () => {
    const errors = judge(torso({ accepts: [] }), wearer, "wearer");
    expect(errors).toEqual([
      {
        path: "$.profiles.wearer.vessels.torso.acceptsAtLeast.0",
        message: 'Body vessel "torso" does not accept "item/armor" elements.'
      }
    ]);
  });

  it("passes a more general body token: a typeless kind admits every type", () => {
    expect(conforms(torso({ accepts: [{ kind: "item" }] }), wearer, "wearer")).toBe(true);
  });

  it("fails a narrower or mismatched body token", () => {
    expect(conforms(torso({ accepts: [{ kind: "item", type: "weapon" }] }), wearer, "wearer")).toBe(false);

    const anyItem = profilesOf({ wearer: { vessels: { torso: { acceptsAtLeast: [{ kind: "item" }] } } } });
    expect(conforms(torso({ accepts: [{ kind: "item", type: "armor" }] }), anyItem, "wearer")).toBe(false);
  });
});

describe("judge: containsAtLeast", () => {
  it("fails an empty chest with an exact path and message", () => {
    const heartless: Body = structuredClone(HUMAN_BODY);
    delete heartless.vessels.chest.contains;
    const errors = judge(heartless, LIVING_HUMAN, "living-human");
    expect(errors).toEqual([
      {
        path: "$.profiles.living-human.vessels.chest.containsAtLeast.0",
        message: 'Body vessel "chest" contains no "organ/heart" element.'
      }
    ]);
  });
});

describe("judge: conformsTo", () => {
  it("passes one level deep: the mech's reactor element embeds a conforming core", () => {
    expect(conforms(MECH_BODY, MECH_PROFILES, "mech")).toBe(true);
  });

  it("fails when the embedded body does not conform", () => {
    const dry: Body = structuredClone(MECH_BODY);
    delete dry.vessels.torso.contains![0].body!.vessels.core.contains;
    const errors = judge(dry, MECH_PROFILES, "mech");
    expect(errors).toEqual([
      {
        path: "$.profiles.mech.vessels.torso.conformsTo",
        message:
          'Body vessel "torso" contains no "part/reactor" element whose embedded body conforms to profile "reactor-core".'
      }
    ]);
  });

  it("fails when the matching element has no embedded body at all", () => {
    const hollow: Body = {
      root: "torso",
      vessels: { torso: { contains: [{ kind: "part", type: "reactor" }] } }
    };
    expect(conforms(hollow, MECH_PROFILES, "mech")).toBe(false);
  });

  it("fails when the conforming embedded body rides an element the token does not match", () => {
    const mislabeled: Body = structuredClone(MECH_BODY);
    mislabeled.vessels.torso.contains![0].type = "battery";
    expect(conforms(mislabeled, MECH_PROFILES, "mech")).toBe(false);
  });

  it("terminates on cyclic profile references: recursion descends into smaller bodies", () => {
    const twoDolls: Body = {
      root: "shell",
      vessels: {
        shell: {
          contains: [{ kind: "doll", body: { root: "shell", vessels: { shell: {} } } }]
        }
      }
    };
    // The innermost shell holds no doll, so nothing conforms — but the
    // judgment terminates despite the profile referencing itself.
    const errors = judge(twoDolls, MATRYOSHKA_PROFILES, "matryoshka");
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("$.profiles.matryoshka.vessels.shell.conformsTo");
  });
});

describe("judge: input discipline", () => {
  it("throws on a kernel-invalid body, with the kernel's formatted errors", () => {
    const invalid = { root: "torso", vessels: {} } as Body;
    expect(() => judge(invalid, LIVING_HUMAN, "living-human")).toThrow("$.body.root");
  });

  it("throws on an invalid profile document", () => {
    const invalid = profilesOf({ p: { vessels: { head: {} } } });
    expect(() => judge(HUMAN_BODY, invalid, "p")).toThrow("$.profiles.p.vessels.head");
  });

  it("throws on a profile id the document does not define", () => {
    expect(() => judge(HUMAN_BODY, LIVING_HUMAN, "ghost")).toThrow('Profile "ghost" does not exist');
  });
});

describe("the relay: gamecraft counts -> paperfold reifies -> papermold judges", () => {
  it("judges structure only — hp lives in data, and data is never consulted", () => {
    const alive = profilesOf({
      alive: { vessels: { torso: { forbids: [{ kind: "status", type: "dead" }] } } }
    });

    // The game tracks hp in data, where no profile can see it. This hero's
    // hp is nonsensical (-9999): a judge that peeked would call them dead.
    const hero: Body = {
      root: "torso",
      vessels: { torso: { contains: [{ kind: "stat", id: "hp", data: { hp: -9999 } }] } }
    };
    expect(conforms(hero, alive, "alive")).toBe(true);

    // The threshold crossed, so the game reifies the state structurally —
    // the kernel operation a paperfold patch entry would carry.
    const dead = insertElement(hero, "torso", { kind: "status", type: "dead" });
    expect(conforms(dead, alive, "alive")).toBe(false);

    // The hp element was never read and never touched: conformance flipped
    // on structure alone.
    expect(dead.vessels.torso.contains![0]).toEqual({ kind: "stat", id: "hp", data: { hp: -9999 } });
  });
});
