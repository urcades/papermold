import type { Body } from "paperdoll";
import { PAPERMOLD_PROTOCOL, type PapermoldDocument } from "../src/index";

// The pre-RFC's worked example, verbatim: existence + geometry (a head atop
// the body), capability (the body accepts armor), absence (no dead status —
// how "alive" is spelled), presence (a heart in the chest), and a structural
// threshold (at least 2 of 4 organ vessels intact).
export const LIVING_HUMAN: PapermoldDocument = {
  protocol: PAPERMOLD_PROTOCOL,
  profiles: {
    "living-human": {
      vessels: {
        head: {
          exists: true,
          ports: { bottom: { vessel: "body", side: "top" } }
        },
        body: {
          exists: true,
          acceptsAtLeast: [{ kind: "item", type: "armor" }],
          forbids: [{ kind: "status", type: "dead" }]
        },
        chest: {
          exists: true,
          containsAtLeast: [{ kind: "organ", type: "heart" }]
        }
      },
      atLeast: {
        n: 2,
        of: [
          { vessel: "liver", check: { exists: true } },
          { vessel: "left-lung", check: { exists: true } },
          { vessel: "right-lung", check: { exists: true } },
          { vessel: "left-kidney", check: { exists: true } }
        ]
      }
    }
  }
};

// A kernel-valid body that conforms to living-human: head atop the body,
// chest below it, a heart in the chest, four free organ vessels.
export const HUMAN_BODY: Body = {
  root: "body",
  vessels: {
    head: {
      ports: { bottom: { vessel: "body", side: "top" } }
    },
    body: {
      accepts: [{ kind: "item", type: "armor" }, { kind: "status" }],
      ports: {
        top: { vessel: "head", side: "bottom" },
        bottom: { vessel: "chest", side: "top" }
      }
    },
    chest: {
      contains: [{ kind: "organ", type: "heart" }],
      ports: { top: { vessel: "body", side: "bottom" } }
    },
    liver: {},
    "left-lung": {},
    "right-lung": {},
    "left-kidney": {}
  }
};

// The same figure with the head hanging off the body's left side: every
// vessel the profile names is present, but the geometry is wrong.
export const SIDEWAYS_HEAD_BODY: Body = {
  root: "body",
  vessels: {
    head: {
      ports: { right: { vessel: "body", side: "left" } }
    },
    body: {
      accepts: [{ kind: "item", type: "armor" }, { kind: "status" }],
      ports: {
        left: { vessel: "head", side: "right" },
        bottom: { vessel: "chest", side: "top" }
      }
    },
    chest: {
      contains: [{ kind: "organ", type: "heart" }],
      ports: { top: { vessel: "body", side: "bottom" } }
    },
    liver: {},
    "left-lung": {},
    "right-lung": {},
    "left-kidney": {}
  }
};

// The same figure with the head literally named "cockpit": geometrically
// identical, nominally different. Name-anchoring (pre-RFC decision 1) means
// this body does NOT conform — there is no vessel named "head".
export const COCKPIT_BODY: Body = {
  root: "body",
  vessels: {
    cockpit: {
      ports: { bottom: { vessel: "body", side: "top" } }
    },
    body: {
      accepts: [{ kind: "item", type: "armor" }, { kind: "status" }],
      ports: {
        top: { vessel: "cockpit", side: "bottom" },
        bottom: { vessel: "chest", side: "top" }
      }
    },
    chest: {
      contains: [{ kind: "organ", type: "heart" }],
      ports: { top: { vessel: "body", side: "bottom" } }
    },
    liver: {},
    "left-lung": {},
    "right-lung": {},
    "left-kidney": {}
  }
};

// A mech whose torso must hold a reactor part whose embedded body conforms
// to reactor-core — recursive conformance, one level deep.
export const MECH_PROFILES: PapermoldDocument = {
  protocol: PAPERMOLD_PROTOCOL,
  profiles: {
    mech: {
      vessels: {
        torso: {
          exists: true,
          conformsTo: { token: { kind: "part", type: "reactor" }, profile: "reactor-core" }
        }
      }
    },
    "reactor-core": {
      vessels: {
        core: { containsAtLeast: [{ kind: "fuel" }] }
      }
    }
  }
};

export const MECH_BODY: Body = {
  root: "torso",
  vessels: {
    torso: {
      contains: [
        {
          kind: "part",
          type: "reactor",
          id: "reactor",
          body: {
            root: "core",
            vessels: {
              core: { contains: [{ kind: "fuel", type: "uranium" }] }
            }
          }
        }
      ]
    }
  }
};

// A self-referential profile: a matryoshka is a shell holding a doll whose
// embedded body is itself a matryoshka. Legal (cycles among profiles are
// legal); terminating (conformance always descends into a strictly smaller
// embedded body, so a finite body bottoms out).
export const MATRYOSHKA_PROFILES: PapermoldDocument = {
  protocol: PAPERMOLD_PROTOCOL,
  profiles: {
    matryoshka: {
      vessels: {
        shell: {
          conformsTo: { token: { kind: "doll" }, profile: "matryoshka" }
        }
      }
    }
  }
};

// Two profiles referencing each other — mutual cycles are legal too.
export const MUTUAL_PROFILES: PapermoldDocument = {
  protocol: PAPERMOLD_PROTOCOL,
  profiles: {
    yin: {
      vessels: { hollow: { conformsTo: { token: { kind: "seed" }, profile: "yang" } } }
    },
    yang: {
      vessels: { hollow: { conformsTo: { token: { kind: "seed" }, profile: "yin" } } }
    }
  }
};
