import { parseSceneAddress, resolveSceneAddress, validateScene } from "paperchain";
import type { BodyName, KindDeclaration, KindId, Relation, Scene } from "paperchain";
import { formatProtocolErrors, isId, PAPER_DOLL_PROTOCOL, parseAddress, validateDocument, validateKnownKeys } from "paperdoll";
import type { Body, ProtocolError, Result } from "paperdoll";
import {
  judgeProfile,
  PAPERMOLD_PROTOCOL,
  validateProfilesRecord,
  type PapermoldDocument,
  type Profile
} from "./papermold.js";

// papermold/v2 — scene profiles: conformance judgment over paperchain scenes.
//
// The v1 discipline widened, not changed. Judgment stays a linear walk: every
// clause quantifies over at most one implicit variable (a relation, a body)
// and no variable is shared between clauses — a shared variable would turn
// judgment into conjunctive-query evaluation over the relation graph, the
// same NP-hard search that pre-RFC decision 1's name-anchoring refuses. Data
// stays unread. Scene profiles reference body profiles in the same document
// only, and never reference other scene profiles: scenes do not nest, so the
// strictly-smaller-descent argument that makes body-profile cycles terminate
// (micro-decision 2) does not transfer.

export const PAPERMOLD_SCENE_PROTOCOL = "papermold/v2" as const;

/** A body demand names a scene body and (optionally) a body profile it must conform to. */
export type BodyDemand = {
  exists?: true;
  conformsTo?: string;
};

/**
 * A kind demand is a field-subset match against the scene's declaration:
 * named booleans compare with absent normalized to false; named budgets must
 * be declared and integer-equal (an absent budget is unbounded, which never
 * satisfies a bounded demand).
 */
export type KindDemand = {
  declared?: true;
  declaration?: KindDeclaration;
};

export type EndpointFilter = {
  prefix?: string;
  conformsTo?: string;
};

/**
 * A relation demand counts relations of one kind touching an anchor. The
 * anchor is a prefix: an endpoint matches iff it equals the anchor or extends
 * it with a "/" segment — subtree-containment anchoring, deliberately wider
 * than paperchain's exact-address relationsAt (a sword sheathed inside the
 * hand still counts as wielded by the hand). One segment anchors a whole
 * body. Counting is per relation, in either position by default (a
 * self-relation under one anchor counts once); `role` restricts the anchor's
 * position for directional kinds and degrades to either-position on
 * symmetric kinds, whose positions are one pool.
 */
export type RelationDemand = {
  at: string;
  kind: KindId;
  role?: "from" | "to";
  atLeast?: number;
  atMost?: number;
  otherEndpoint?: EndpointFilter;
};

export type ForAllBodiesCheck = {
  excluding?: BodyName[];
  check: BodyDemand;
};

/** A universal negative: no relation of this kind (under this anchor) exists. */
export type RelationBan = {
  kind: KindId;
  at?: string;
};

export type SceneProfile = {
  bodies?: Record<BodyName, BodyDemand>;
  kinds?: Record<KindId, KindDemand>;
  relations?: RelationDemand[];
  forAllBodies?: ForAllBodiesCheck[];
  forbidsRelations?: RelationBan[];
};

export type PapermoldSceneDocument = {
  protocol: typeof PAPERMOLD_SCENE_PROTOCOL;
  profiles: Record<string, Profile>;
  sceneProfiles: Record<string, SceneProfile>;
};

const SCENE_PROFILE_CLAUSES = ["bodies", "kinds", "relations", "forAllBodies", "forbidsRelations"] as const;
const BODY_DEMAND_CLAUSES = ["exists", "conformsTo"] as const;
const KIND_DEMAND_CLAUSES = ["declared", "declaration"] as const;

// Parsing and validation

export function parseSceneProfiles(input: unknown): Result<PapermoldSceneDocument, ProtocolError[]> {
  const errors = validateSceneProfiles(input);
  if (errors.length > 0) return { ok: false, errors };
  const document = input as PapermoldSceneDocument;
  return {
    ok: true,
    value: {
      protocol: PAPERMOLD_SCENE_PROTOCOL,
      profiles: structuredClone(document.profiles),
      sceneProfiles: structuredClone(document.sceneProfiles)
    }
  };
}

export function assertSceneProfiles(input: unknown): asserts input is PapermoldSceneDocument {
  const result = parseSceneProfiles(input);
  if (!result.ok) {
    throw new Error(formatProtocolErrors(result.errors));
  }
}

export function validateSceneProfiles(input: unknown): ProtocolError[] {
  const errors: ProtocolError[] = [];

  if (!isRecord(input)) {
    return [{ path: "$", message: "Scene profile document must be an object." }];
  }

  if (input.protocol !== PAPERMOLD_SCENE_PROTOCOL) {
    errors.push({ path: "$.protocol", message: `Expected "${PAPERMOLD_SCENE_PROTOCOL}".` });
  }

  validateKnownKeys(input, ["protocol", "profiles", "sceneProfiles"], "$", errors);

  // The body-profile half is v1 grammar verbatim, validated by the shared
  // walk (including its own same-document conformsTo reference pass).
  if (!isRecord(input.profiles)) {
    errors.push({ path: "$.profiles", message: "Profiles must be an object keyed by profile id." });
  } else {
    validateProfilesRecord(input.profiles, errors);
  }

  if (!isRecord(input.sceneProfiles)) {
    errors.push({ path: "$.sceneProfiles", message: "Scene profiles must be an object keyed by scene profile id." });
    return errors;
  }

  // Scene-side references to body profiles resolve within this document only
  // (the same-document rule of pre-RFC decision 4, extended across the two
  // namespaces of the v2 document).
  const references: { path: string; profile: string }[] = [];

  for (const [profileId, profile] of Object.entries(input.sceneProfiles)) {
    const path = `$.sceneProfiles.${profileId}`;
    if (!isId(profileId)) {
      errors.push({
        path,
        message: "Scene profile id must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens."
      });
    }
    validateSceneProfile(profile, path, errors, references);
  }

  if (isRecord(input.profiles)) {
    for (const reference of references) {
      if (!Object.prototype.hasOwnProperty.call(input.profiles, reference.profile)) {
        errors.push({
          path: reference.path,
          message: `References missing profile "${reference.profile}"; conformsTo resolves within this document only.`
        });
      }
    }
  }

  return errors;
}

function validateSceneProfile(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Scene profile must be an object." });
    return;
  }

  validateKnownKeys(input, SCENE_PROFILE_CLAUSES, path, errors);

  if (input.bodies !== undefined) {
    if (!isRecord(input.bodies)) {
      errors.push({ path: `${path}.bodies`, message: "Bodies must be an object keyed by body name." });
    } else {
      for (const [bodyName, demand] of Object.entries(input.bodies)) {
        const demandPath = `${path}.bodies.${bodyName}`;
        if (!isId(bodyName)) {
          errors.push({
            path: demandPath,
            message: "Body name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens."
          });
        }
        validateBodyDemand(demand, demandPath, errors, references);
      }
    }
  }

  if (input.kinds !== undefined) {
    if (!isRecord(input.kinds)) {
      errors.push({ path: `${path}.kinds`, message: "Kinds must be an object keyed by kind id." });
    } else {
      for (const [kindId, demand] of Object.entries(input.kinds)) {
        const demandPath = `${path}.kinds.${kindId}`;
        if (!isId(kindId)) {
          errors.push({ path: demandPath, message: "Kind id must be a valid lowercase id." });
        }
        validateKindDemand(demand, demandPath, errors);
      }
    }
  }

  validateEntryList(input.relations, `${path}.relations`, "relation demands", errors, (entry, entryPath) =>
    validateRelationDemand(entry, entryPath, errors, references)
  );
  validateEntryList(input.forAllBodies, `${path}.forAllBodies`, "forAllBodies checks", errors, (entry, entryPath) =>
    validateForAllBodiesCheck(entry, entryPath, errors, references)
  );
  validateEntryList(input.forbidsRelations, `${path}.forbidsRelations`, "relation bans", errors, (entry, entryPath) =>
    validateRelationBan(entry, entryPath, errors)
  );
}

function validateEntryList(
  input: unknown,
  path: string,
  noun: string,
  errors: ProtocolError[],
  each: (entry: unknown, entryPath: string) => void
): void {
  if (input === undefined) return;
  if (!Array.isArray(input) || input.length === 0) {
    errors.push({ path, message: `Must be a non-empty array of ${noun}.` });
    return;
  }
  input.forEach((entry, index) => each(entry, `${path}.${index}`));
}

function validateBodyDemand(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Body demand must be an object with at least one clause." });
    return;
  }
  validateKnownKeys(input, BODY_DEMAND_CLAUSES, path, errors);
  if (!BODY_DEMAND_CLAUSES.some((clause) => input[clause] !== undefined)) {
    errors.push({ path, message: `Body demand must include at least one clause (${BODY_DEMAND_CLAUSES.join(", ")}).` });
  }
  if (input.exists !== undefined && input.exists !== true) {
    errors.push({ path: `${path}.exists`, message: "exists must be the literal true; omit the clause instead of writing anything else." });
  }
  if (input.conformsTo !== undefined) {
    if (!isId(input.conformsTo)) {
      errors.push({ path: `${path}.conformsTo`, message: "conformsTo must be a valid profile id." });
    } else {
      references.push({ path: `${path}.conformsTo`, profile: input.conformsTo });
    }
  }
}

function validateKindDemand(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Kind demand must be an object with at least one clause." });
    return;
  }
  validateKnownKeys(input, KIND_DEMAND_CLAUSES, path, errors);
  if (!KIND_DEMAND_CLAUSES.some((clause) => input[clause] !== undefined)) {
    errors.push({ path, message: `Kind demand must include at least one clause (${KIND_DEMAND_CLAUSES.join(", ")}).` });
  }
  if (input.declared !== undefined && input.declared !== true) {
    errors.push({ path: `${path}.declared`, message: "declared must be the literal true; omit the clause instead of writing anything else." });
  }
  if (input.declaration !== undefined) {
    validateKindDeclarationShape(input.declaration, `${path}.declaration`, errors);
  }
}

// paperchain's declaration rules, revalidated locally (paperchain does not
// export its validator): boolean flags, non-negative integer budgets, and
// toMax forbidden on symmetric kinds.
function validateKindDeclarationShape(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Kind declaration must be an object." });
    return;
  }
  validateKnownKeys(input, ["symmetric", "irreflexive", "fromMax", "toMax"], path, errors);
  for (const flag of ["symmetric", "irreflexive"] as const) {
    if (input[flag] !== undefined && typeof input[flag] !== "boolean") {
      errors.push({ path: `${path}.${flag}`, message: `${flag} must be a boolean.` });
    }
  }
  for (const budget of ["fromMax", "toMax"] as const) {
    const value = input[budget];
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
      errors.push({ path: `${path}.${budget}`, message: `${budget} must be a non-negative integer.` });
    }
  }
  if (input.symmetric === true && input.toMax !== undefined) {
    errors.push({ path: `${path}.toMax`, message: "Symmetric kinds may not declare toMax; positions are one pool." });
  }
}

function validateRelationDemand(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Relation demand must be an object." });
    return;
  }
  validateKnownKeys(input, ["at", "kind", "role", "atLeast", "atMost", "otherEndpoint"], path, errors);
  validateAnchor(input.at, `${path}.at`, errors, true);
  if (!isId(input.kind)) {
    errors.push({ path: `${path}.kind`, message: "Relation demand kind must be a valid kind id." });
  }
  if (input.role !== undefined && input.role !== "from" && input.role !== "to") {
    errors.push({ path: `${path}.role`, message: 'role must be "from" or "to".' });
  }
  const validAtLeast = input.atLeast === undefined || (typeof input.atLeast === "number" && Number.isInteger(input.atLeast) && input.atLeast >= 1);
  if (!validAtLeast) {
    errors.push({ path: `${path}.atLeast`, message: "atLeast must be an integer >= 1." });
  }
  const validAtMost = input.atMost === undefined || (typeof input.atMost === "number" && Number.isInteger(input.atMost) && input.atMost >= 0);
  if (!validAtMost) {
    errors.push({ path: `${path}.atMost`, message: "atMost must be an integer >= 0." });
  }
  if (input.atLeast === undefined && input.atMost === undefined) {
    errors.push({ path, message: "Relation demand must include atLeast, atMost, or both." });
  }
  if (
    validAtLeast &&
    validAtMost &&
    typeof input.atLeast === "number" &&
    typeof input.atMost === "number" &&
    input.atLeast > input.atMost
  ) {
    errors.push({ path: `${path}.atLeast`, message: `atLeast (${input.atLeast}) exceeds atMost (${input.atMost}).` });
  }
  if (input.otherEndpoint !== undefined) {
    validateEndpointFilter(input.otherEndpoint, `${path}.otherEndpoint`, errors, references);
  }
}

function validateEndpointFilter(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "otherEndpoint must be an object with at least one clause." });
    return;
  }
  validateKnownKeys(input, ["prefix", "conformsTo"], path, errors);
  if (input.prefix === undefined && input.conformsTo === undefined) {
    errors.push({ path, message: "otherEndpoint must include at least one clause (prefix, conformsTo)." });
  }
  if (input.prefix !== undefined) {
    validateAnchor(input.prefix, `${path}.prefix`, errors, true);
  }
  if (input.conformsTo !== undefined) {
    if (!isId(input.conformsTo)) {
      errors.push({ path: `${path}.conformsTo`, message: "conformsTo must be a valid profile id." });
    } else {
      references.push({ path: `${path}.conformsTo`, profile: input.conformsTo });
    }
  }
}

function validateForAllBodiesCheck(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "forAllBodies check must be an object with a check (and optional excluding)." });
    return;
  }
  validateKnownKeys(input, ["excluding", "check"], path, errors);
  if (input.excluding !== undefined) {
    if (!Array.isArray(input.excluding) || input.excluding.length === 0) {
      errors.push({ path: `${path}.excluding`, message: "excluding must be a non-empty array of body names." });
    } else {
      input.excluding.forEach((name, index) => {
        if (!isId(name)) {
          errors.push({ path: `${path}.excluding.${index}`, message: "Excluded body name must be a valid lowercase id." });
        }
      });
    }
  }
  if (input.check === undefined) {
    errors.push({ path: `${path}.check`, message: "forAllBodies requires a check body demand." });
    return;
  }
  validateBodyDemand(input.check, `${path}.check`, errors, references);
}

function validateRelationBan(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Relation ban must be an object with a kind (and optional at anchor)." });
    return;
  }
  validateKnownKeys(input, ["kind", "at"], path, errors);
  if (!isId(input.kind)) {
    errors.push({ path: `${path}.kind`, message: "Relation ban kind must be a valid kind id." });
  }
  if (input.at !== undefined) {
    validateAnchor(input.at, `${path}.at`, errors, false);
  }
}

/**
 * An anchor is one or more "/"-joined kernel ids: one segment names a whole
 * body; two or more form a paperchain scene address. Grammar only — whether
 * the anchor resolves in a particular scene is a judgment-time question.
 */
function validateAnchor(input: unknown, path: string, errors: ProtocolError[], required: boolean): void {
  if (input === undefined) {
    if (required) errors.push({ path, message: "Anchor is required." });
    return;
  }
  if (typeof input !== "string") {
    errors.push({ path, message: "Anchor must be a string of one or more \"/\"-joined lowercase ids." });
    return;
  }
  try {
    parseAddress(input);
  } catch (thrown) {
    errors.push({ path, message: thrown instanceof Error ? thrown.message : String(thrown) });
  }
}

// The judgment
//
// judgeScene(scene, document, sceneProfileId) returns the clause failures;
// empty means the scene conforms. Inputs are guarded exactly as v1's judge
// guards bodies: an invalid scene or document is a caller error and throws.
// Nested body-conformance failures are not forwarded — the judgment is the
// boolean (micro-decision 3); the wrapper error names the body and profile.

export function judgeScene(scene: Scene, document: PapermoldSceneDocument, sceneProfileId: string): ProtocolError[] {
  const sceneErrors = validateScene(scene);
  if (sceneErrors.length > 0) throw new Error(formatProtocolErrors(sceneErrors));

  const documentErrors = validateSceneProfiles(document);
  if (documentErrors.length > 0) throw new Error(formatProtocolErrors(documentErrors));

  if (!Object.prototype.hasOwnProperty.call(document.sceneProfiles, sceneProfileId)) {
    throw new Error(`Scene profile "${sceneProfileId}" does not exist in the document.`);
  }

  return judgeSceneProfile(scene, document, sceneProfileId);
}

export function conformsScene(scene: Scene, document: PapermoldSceneDocument, sceneProfileId: string): boolean {
  return judgeScene(scene, document, sceneProfileId).length === 0;
}

/** Judge one of the document's body profiles against a bare body (v2 counterpart of v1 judge). */
export function judgeBody(body: Body, document: PapermoldSceneDocument, profileId: string): ProtocolError[] {
  const bodyErrors = validateDocument({ protocol: PAPER_DOLL_PROTOCOL, body });
  if (bodyErrors.length > 0) throw new Error(formatProtocolErrors(bodyErrors));

  const documentErrors = validateSceneProfiles(document);
  if (documentErrors.length > 0) throw new Error(formatProtocolErrors(documentErrors));

  if (!Object.prototype.hasOwnProperty.call(document.profiles, profileId)) {
    throw new Error(`Profile "${profileId}" does not exist in the document.`);
  }

  return judgeProfile(body, asBodyDocument(document), profileId);
}

export function conformsBody(body: Body, document: PapermoldSceneDocument, profileId: string): boolean {
  return judgeBody(body, document, profileId).length === 0;
}

function asBodyDocument(document: PapermoldSceneDocument): PapermoldDocument {
  return { protocol: PAPERMOLD_PROTOCOL, profiles: document.profiles };
}

function judgeSceneProfile(scene: Scene, document: PapermoldSceneDocument, sceneProfileId: string): ProtocolError[] {
  const errors: ProtocolError[] = [];
  const profile = document.sceneProfiles[sceneProfileId] as SceneProfile;
  const profilePath = `$.sceneProfiles.${sceneProfileId}`;
  const bodyDocument = asBodyDocument(document);

  for (const [bodyName, demand] of Object.entries(profile.bodies ?? {})) {
    const path = `${profilePath}.bodies.${bodyName}`;
    const body = scene.bodies[bodyName];
    // Absence dominates, as in v1: a missing body fails all its demands at
    // once with a single error.
    if (!body) {
      errors.push({ path, message: `Scene has no body "${bodyName}".` });
      continue;
    }
    if (demand.conformsTo !== undefined && judgeProfile(body, bodyDocument, demand.conformsTo).length > 0) {
      errors.push({
        path: `${path}.conformsTo`,
        message: `Scene body "${bodyName}" does not conform to profile "${demand.conformsTo}".`
      });
    }
  }

  for (const [kindId, demand] of Object.entries(profile.kinds ?? {})) {
    const path = `${profilePath}.kinds.${kindId}`;
    const declaration = scene.kinds[kindId];
    if (declaration === undefined) {
      errors.push({ path, message: `Scene declares no kind "${kindId}".` });
      continue;
    }
    if (demand.declaration !== undefined) {
      judgeKindDeclaration(kindId, declaration, demand.declaration, `${path}.declaration`, errors);
    }
  }

  (profile.relations ?? []).forEach((demand, index) => {
    const path = `${profilePath}.relations.${index}`;
    if (!anchorResolves(scene, demand.at)) {
      errors.push({ path, message: `Anchor "${demand.at}" does not resolve in the scene.` });
      return;
    }
    const count = countRelations(scene, bodyDocument, demand);
    if (demand.atLeast !== undefined && count < demand.atLeast) {
      errors.push({
        path: `${path}.atLeast`,
        message: `Anchor "${demand.at}" participates in ${count} counted "${demand.kind}" relations; the profile requires at least ${demand.atLeast}.`
      });
    }
    if (demand.atMost !== undefined && count > demand.atMost) {
      errors.push({
        path: `${path}.atMost`,
        message: `Anchor "${demand.at}" participates in ${count} counted "${demand.kind}" relations; the profile allows at most ${demand.atMost}.`
      });
    }
  });

  (profile.forAllBodies ?? []).forEach((check, index) => {
    const path = `${profilePath}.forAllBodies.${index}`;
    const excluded = new Set(check.excluding ?? []);
    // Universals report every witness: one error per failing body.
    for (const bodyName of Object.keys(scene.bodies).sort()) {
      if (excluded.has(bodyName)) continue;
      if (
        check.check.conformsTo !== undefined &&
        judgeProfile(scene.bodies[bodyName], bodyDocument, check.check.conformsTo).length > 0
      ) {
        errors.push({
          path: `${path}.check.conformsTo`,
          message: `Scene body "${bodyName}" does not conform to profile "${check.check.conformsTo}".`
        });
      }
    }
  });

  (profile.forbidsRelations ?? []).forEach((ban, index) => {
    // Unlike relation demands, a ban's anchor is never resolution-checked:
    // a ban at a body the scene no longer has is vacuously satisfied — no
    // relations can exist under a nonexistent anchor, which is exactly what
    // the ban demands.
    const path = `${profilePath}.forbidsRelations.${index}`;
    const witnesses = scene.relations.filter(
      (relation) =>
        relation.kind === ban.kind &&
        (ban.at === undefined || endpointUnderAnchor(relation.from, ban.at) || endpointUnderAnchor(relation.to, ban.at))
    ).length;
    if (witnesses > 0) {
      errors.push({
        path,
        message:
          ban.at === undefined
            ? `Scene contains ${witnesses} forbidden "${ban.kind}" relation${witnesses === 1 ? "" : "s"}.`
            : `Scene contains ${witnesses} forbidden "${ban.kind}" relation${witnesses === 1 ? "" : "s"} under "${ban.at}".`
      });
    }
  });

  return errors;
}

function judgeKindDeclaration(
  kindId: KindId,
  declaration: KindDeclaration,
  demand: KindDeclaration,
  path: string,
  errors: ProtocolError[]
): void {
  // Field-subset match: only fields the demand names are compared.
  for (const flag of ["symmetric", "irreflexive"] as const) {
    if (demand[flag] === undefined) continue;
    const have = declaration[flag] === true;
    const want = demand[flag] === true;
    if (have !== want) {
      errors.push({
        path: `${path}.${flag}`,
        message: `Scene kind "${kindId}" declares ${flag}: ${have}, not ${want}.`
      });
    }
  }
  for (const budget of ["fromMax", "toMax"] as const) {
    if (demand[budget] === undefined) continue;
    const have = declaration[budget];
    if (have === undefined) {
      // An absent budget is unbounded, which never satisfies a bounded demand.
      errors.push({
        path: `${path}.${budget}`,
        message: `Scene kind "${kindId}" declares no ${budget}; the profile requires ${budget}: ${demand[budget]}.`
      });
    } else if (have !== demand[budget]) {
      errors.push({
        path: `${path}.${budget}`,
        message: `Scene kind "${kindId}" declares ${budget}: ${have}, not ${demand[budget]}.`
      });
    }
  }
}

// Anchoring
//
// An endpoint matches an anchor iff it equals the anchor or extends it with a
// "/" segment. The "/" guard means anchor "red" never matches an endpoint of
// body "red-two". A one-segment anchor resolves iff the scene has that body;
// longer anchors resolve through paperchain's own address machinery.

function endpointUnderAnchor(endpoint: string, anchor: string): boolean {
  return endpoint === anchor || endpoint.startsWith(`${anchor}/`);
}

function anchorResolves(scene: Scene, anchor: string): boolean {
  const segments = anchor.split("/");
  if (!Object.prototype.hasOwnProperty.call(scene.bodies, segments[0])) return false;
  if (segments.length === 1) return true;
  try {
    return resolveSceneAddress(scene, anchor) !== null;
  } catch {
    return false;
  }
}

function countRelations(scene: Scene, bodyDocument: PapermoldDocument, demand: RelationDemand): number {
  const symmetric = scene.kinds[demand.kind]?.symmetric === true;
  // role restricts the anchor's position for directional kinds; symmetric
  // kinds have no positions, so role degrades to either-position.
  const positions: ("from" | "to")[] = demand.role !== undefined && !symmetric ? [demand.role] : ["from", "to"];

  let count = 0;
  for (const relation of scene.relations) {
    if (relation.kind !== demand.kind) continue;
    // A relation counts once if any allowed position assignment matches the
    // anchor and its other endpoint passes the filter (a self-relation under
    // one anchor counts once, not twice).
    const counted = positions.some((position) => {
      if (!endpointUnderAnchor(relation[position], demand.at)) return false;
      const other = relation[position === "from" ? "to" : "from"];
      return otherEndpointPasses(scene, bodyDocument, other, demand.otherEndpoint);
    });
    if (counted) count += 1;
  }
  return count;
}

function otherEndpointPasses(
  scene: Scene,
  bodyDocument: PapermoldDocument,
  endpoint: string,
  filter: EndpointFilter | undefined
): boolean {
  if (filter === undefined) return true;
  if (filter.prefix !== undefined && !endpointUnderAnchor(endpoint, filter.prefix)) return false;
  if (filter.conformsTo !== undefined) {
    let split;
    try {
      split = parseSceneAddress(endpoint);
    } catch {
      return false;
    }
    const body = scene.bodies[split.bodyName];
    if (!body) return false;
    if (judgeProfile(body, bodyDocument, filter.conformsTo).length > 0) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
