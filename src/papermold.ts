import {
  PAPER_DOLL_PROTOCOL,
  SIDES,
  formatProtocolErrors,
  isId,
  matches,
  validateAcceptToken,
  validateDocument,
  validateEndpoint,
  validateKnownKeys
} from "paperdoll";
import type {
  AcceptToken,
  Body,
  PortAddress,
  ProtocolError,
  Result,
  Side,
  VesselId
} from "paperdoll";

export const PAPERMOLD_PROTOCOL = "papermold/v1" as const;

// A profile is a stencil: a pattern document declaring what a body must
// structurally have in order to count as an instance of a kind. Conformance
// is the judgment `body : profile` — pure, deterministic, runnable by any
// validator with the two documents in hand and nothing else. Envelope typing
// is a name tag; a profile is an inspection.
//
// Profiles judge structure only — never data. ContainedElement.data is
// opaque to every protocol in the family, and papermold is no exception: no
// clause can read, compare, or even acknowledge data. The relay is:
// gamecraft counts -> paperfold reifies -> papermold judges.

export type ConformsToDemand = {
  token: AcceptToken;
  profile: string;
};

export type VesselDemand = {
  exists?: true;
  ports?: Partial<Record<Side, PortAddress>>;
  acceptsAtLeast?: AcceptToken[];
  containsAtLeast?: AcceptToken[];
  conformsTo?: ConformsToDemand;
  forbids?: AcceptToken[];
};

export type AtLeastCheck = {
  vessel: VesselId;
  check: VesselDemand;
};

export type AtLeast = {
  n: number;
  of: AtLeastCheck[];
};

export type Profile = {
  vessels?: Record<VesselId, VesselDemand>;
  atLeast?: AtLeast;
};

export type PapermoldDocument = {
  protocol: typeof PAPERMOLD_PROTOCOL;
  profiles: Record<string, Profile>;
};

const DEMAND_CLAUSES = ["exists", "ports", "acceptsAtLeast", "containsAtLeast", "conformsTo", "forbids"] as const;

const SIDE_SET = new Set<string>(SIDES);

// Parsing and validation
//
// Profiles are authored documents, not built incrementally: papermold ships
// no insertProfile/deleteProfile operations, no monitoring, no subscriptions.
// The whole surface is parse + judge.

export function parseProfiles(input: unknown): Result<PapermoldDocument, ProtocolError[]> {
  const errors = validateProfiles(input);
  if (errors.length > 0) return { ok: false, errors };
  const document = input as PapermoldDocument;
  return { ok: true, value: { protocol: PAPERMOLD_PROTOCOL, profiles: structuredClone(document.profiles) } };
}

export function assertProfiles(input: unknown): asserts input is PapermoldDocument {
  const result = parseProfiles(input);
  if (!result.ok) {
    throw new Error(formatProtocolErrors(result.errors));
  }
}

export function validateProfiles(input: unknown): ProtocolError[] {
  const errors: ProtocolError[] = [];

  if (!isRecord(input)) {
    return [{ path: "$", message: "Profile document must be an object." }];
  }

  if (input.protocol !== PAPERMOLD_PROTOCOL) {
    errors.push({ path: "$.protocol", message: `Expected "${PAPERMOLD_PROTOCOL}".` });
  }

  validateKnownKeys(input, ["protocol", "profiles"], "$", errors);

  if (!isRecord(input.profiles)) {
    errors.push({ path: "$.profiles", message: "Profiles must be an object keyed by profile id." });
    return errors;
  }

  validateProfilesRecord(input.profiles, errors);

  return errors;
}

/**
 * The per-profile structural walk plus the dangling-reference pass, shared
 * with the papermold/v2 document kind (whose `profiles` half is this grammar
 * verbatim). Module-level export only — not part of the public surface.
 */
export function validateProfilesRecord(profiles: Record<string, unknown>, errors: ProtocolError[]): void {
  // conformsTo references resolve within this document only (pre-RFC
  // decision 4); they are collected during the structural walk and checked
  // for danglers once every profile id is known. Cycles are legal — see
  // judgeDemand for the termination argument.
  const references: { path: string; profile: string }[] = [];

  for (const [profileId, profile] of Object.entries(profiles)) {
    const path = `$.profiles.${profileId}`;
    if (!isId(profileId)) {
      errors.push({
        path,
        message: "Profile id must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens."
      });
    }
    validateProfile(profile, path, errors, references);
  }

  for (const reference of references) {
    if (!Object.prototype.hasOwnProperty.call(profiles, reference.profile)) {
      errors.push({
        path: reference.path,
        message: `References missing profile "${reference.profile}"; conformsTo resolves within this document only.`
      });
    }
  }
}

function validateProfile(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Profile must be an object." });
    return;
  }

  validateKnownKeys(input, ["vessels", "atLeast"], path, errors);

  if (input.vessels !== undefined) {
    if (!isRecord(input.vessels)) {
      errors.push({ path: `${path}.vessels`, message: "Vessels must be an object keyed by vessel id." });
    } else {
      for (const [vesselId, demand] of Object.entries(input.vessels)) {
        const demandPath = `${path}.vessels.${vesselId}`;
        if (!isId(vesselId)) {
          errors.push({
            path: demandPath,
            message: "Vessel id must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens."
          });
        }
        validateDemand(demand, demandPath, errors, references);
      }
    }
  }

  if (input.atLeast !== undefined) {
    validateAtLeast(input.atLeast, `${path}.atLeast`, errors, references);
  }
}

function validateAtLeast(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "atLeast must be an object with n and of." });
    return;
  }

  validateKnownKeys(input, ["n", "of"], path, errors);

  const validN = typeof input.n === "number" && Number.isInteger(input.n) && input.n >= 1;
  if (!validN) {
    errors.push({ path: `${path}.n`, message: "n must be an integer >= 1." });
  }

  if (!Array.isArray(input.of)) {
    errors.push({ path: `${path}.of`, message: "of must be an array of { vessel, check } entries." });
    return;
  }

  input.of.forEach((entry, index) => {
    const entryPath = `${path}.of.${index}`;
    if (!isRecord(entry)) {
      errors.push({ path: entryPath, message: "atLeast check must be an object with vessel and check." });
      return;
    }
    validateKnownKeys(entry, ["vessel", "check"], entryPath, errors);
    if (!isId(entry.vessel)) {
      errors.push({ path: `${entryPath}.vessel`, message: "atLeast check vessel must be a valid vessel id." });
    }
    validateDemand(entry.check, `${entryPath}.check`, errors, references);
  });

  if (validN && (input.n as number) > input.of.length) {
    errors.push({ path: `${path}.n`, message: `n (${input.n}) exceeds the number of checks (${input.of.length}).` });
  }
}

function validateDemand(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Demand must be an object with at least one clause." });
    return;
  }

  validateKnownKeys(input, DEMAND_CLAUSES, path, errors);

  if (!DEMAND_CLAUSES.some((clause) => input[clause] !== undefined)) {
    errors.push({
      path,
      message: `Demand must include at least one clause (${DEMAND_CLAUSES.join(", ")}).`
    });
  }

  if (input.exists !== undefined && input.exists !== true) {
    errors.push({ path: `${path}.exists`, message: "exists must be the literal true; omit the clause instead of writing anything else." });
  }

  if (input.ports !== undefined) {
    validatePortsDemand(input.ports, `${path}.ports`, errors);
  }

  validateTokenList(input.acceptsAtLeast, `${path}.acceptsAtLeast`, errors);
  validateTokenList(input.containsAtLeast, `${path}.containsAtLeast`, errors);
  validateTokenList(input.forbids, `${path}.forbids`, errors);

  if (input.conformsTo !== undefined) {
    validateConformsTo(input.conformsTo, `${path}.conformsTo`, errors, references);
  }
}

function validatePortsDemand(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Ports demand must be an object keyed by side." });
    return;
  }
  if (Object.keys(input).length === 0) {
    errors.push({ path, message: "Ports demand must name at least one side." });
    return;
  }
  for (const [side, address] of Object.entries(input)) {
    const sidePath = `${path}.${side}`;
    if (!isSide(side)) {
      errors.push({ path: sidePath, message: "Port side must be top, right, bottom, or left." });
      continue;
    }
    // A port address is the kernel's { vessel, side } grammar — the same
    // shape as an endpoint, validated with the kernel's own machinery.
    // Rewrap the messages in port vocabulary ("Port vessel...", matching the
    // kernel's own port-address wording) since this is a ports clause.
    const endpointErrors: ProtocolError[] = [];
    validateEndpoint(address, sidePath, endpointErrors);
    for (const error of endpointErrors) {
      errors.push({ ...error, message: error.message.replace(/^Endpoint\b/, "Port") });
    }
  }
}

function validateTokenList(input: unknown, path: string, errors: ProtocolError[]): void {
  if (input === undefined) return;
  if (!Array.isArray(input) || input.length === 0) {
    errors.push({ path, message: "Token list must be a non-empty array of accept tokens." });
    return;
  }
  input.forEach((token, index) => validateAcceptToken(token, `${path}.${index}`, errors));
}

function validateConformsTo(
  input: unknown,
  path: string,
  errors: ProtocolError[],
  references: { path: string; profile: string }[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "conformsTo must be an object with token and profile." });
    return;
  }
  validateKnownKeys(input, ["token", "profile"], path, errors);
  validateAcceptToken(input.token, `${path}.token`, errors);
  if (!isId(input.profile)) {
    errors.push({ path: `${path}.profile`, message: "conformsTo profile must be a valid profile id." });
    return;
  }
  references.push({ path: `${path}.profile`, profile: input.profile });
}

// The judgment
//
// judge(body, document, profileId) returns the clause failures; empty means
// the body conforms. The judgment itself is the boolean — the errors are the
// reference implementation's reporting surface, path-annotated to the clause
// that failed (`$.profiles.living-human.vessels.head.ports.bottom`) with a
// message naming the body-side fact that failed.
//
// judge requires a kernel-valid body and a valid profile document; invalid
// input is a caller error and throws formatted errors, mirroring how the
// kernel's operations treat bad input.

export function judge(body: Body, document: PapermoldDocument, profileId: string): ProtocolError[] {
  const bodyErrors = validateDocument({ protocol: PAPER_DOLL_PROTOCOL, body });
  if (bodyErrors.length > 0) throw new Error(formatProtocolErrors(bodyErrors));

  const profileErrors = validateProfiles(document);
  if (profileErrors.length > 0) throw new Error(formatProtocolErrors(profileErrors));

  if (!Object.prototype.hasOwnProperty.call(document.profiles, profileId)) {
    throw new Error(`Profile "${profileId}" does not exist in the document.`);
  }

  return judgeProfile(body, document, profileId);
}

export function conforms(body: Body, document: PapermoldDocument, profileId: string): boolean {
  return judge(body, document, profileId).length === 0;
}

/**
 * The validated-input judgment walk, shared with the papermold/v2 scene
 * judgment (body demands re-wrap a v2 document's `profiles` half into a v1
 * document and land here). Module-level export only.
 */
export function judgeProfile(body: Body, document: PapermoldDocument, profileId: string): ProtocolError[] {
  const errors: ProtocolError[] = [];
  const profile = document.profiles[profileId] as Profile;
  const profilePath = `$.profiles.${profileId}`;

  for (const [vesselId, demand] of Object.entries(profile.vessels ?? {})) {
    judgeDemand(body, document, vesselId, demand, `${profilePath}.vessels.${vesselId}`, errors);
  }

  const atLeast = profile.atLeast;
  if (atLeast) {
    const passing = atLeast.of.filter((check) => demandPasses(body, document, check.vessel, check.check)).length;
    if (passing < atLeast.n) {
      // One error at the threshold, never one per failing check: when the
      // threshold is met, individual failures inside atLeast are not errors
      // at all (that is what a threshold means).
      errors.push({
        path: `${profilePath}.atLeast`,
        message: `Only ${passing} of ${atLeast.of.length} checks passed; the profile requires at least ${atLeast.n}.`
      });
    }
  }

  return errors;
}

function demandPasses(body: Body, document: PapermoldDocument, vesselId: VesselId, demand: VesselDemand): boolean {
  const probe: ProtocolError[] = [];
  judgeDemand(body, document, vesselId, demand, "$", probe);
  return probe.length === 0;
}

function judgeDemand(
  body: Body,
  document: PapermoldDocument,
  vesselId: VesselId,
  demand: VesselDemand,
  path: string,
  errors: ProtocolError[]
): void {
  const vessel = body.vessels[vesselId];

  // Matching is name-anchored (pre-RFC decision 1): the profile's vessel id
  // is looked up literally. A vessel absent from the body fails all its
  // demands at once, with a single error.
  if (!vessel) {
    errors.push({ path, message: `Body has no vessel "${vesselId}".` });
    return;
  }

  // exists: satisfied by presence — the lookup above is the check.

  for (const side of SIDES) {
    const want = demand.ports?.[side];
    if (!want) continue;
    const have = vessel.ports?.[side];
    if (!have) {
      errors.push({ path: `${path}.ports.${side}`, message: `Body vessel "${vesselId}" has no port on ${side}.` });
    } else if (have.vessel !== want.vessel || have.side !== want.side) {
      errors.push({
        path: `${path}.ports.${side}`,
        message: `Body vessel "${vesselId}" ${side} connects to ${have.vessel}.${have.side}, not ${want.vessel}.${want.side}.`
      });
    }
  }

  (demand.acceptsAtLeast ?? []).forEach((token, index) => {
    // Absent accepts is the kernel's open vessel: it admits everything, so
    // every accepts demand passes. A sealed vessel (accepts: []) admits
    // nothing and fails every demand.
    if (vessel.accepts === undefined) return;
    if (!admits(vessel.accepts, token)) {
      errors.push({
        path: `${path}.acceptsAtLeast.${index}`,
        message: `Body vessel "${vesselId}" does not accept ${label(token)} elements.`
      });
    }
  });

  (demand.containsAtLeast ?? []).forEach((token, index) => {
    if (!(vessel.contains ?? []).some((element) => matches(token, element))) {
      errors.push({
        path: `${path}.containsAtLeast.${index}`,
        message: `Body vessel "${vesselId}" contains no ${label(token)} element.`
      });
    }
  });

  (demand.forbids ?? []).forEach((token, index) => {
    if ((vessel.contains ?? []).some((element) => matches(token, element))) {
      errors.push({
        path: `${path}.forbids.${index}`,
        message: `Body vessel "${vesselId}" contains a forbidden ${label(token)} element.`
      });
    }
  });

  if (demand.conformsTo) {
    const { token, profile } = demand.conformsTo;
    // Cyclic profile references are legal and always terminate: conformance
    // descends into a strictly smaller embedded body (element.body is a
    // proper part of its container), so on a finite document the recursion
    // bottoms out regardless of cycles among the profiles themselves.
    const found = (vessel.contains ?? []).some(
      (element) =>
        matches(token, element) && element.body !== undefined && judgeProfile(element.body, document, profile).length === 0
    );
    if (!found) {
      errors.push({
        path: `${path}.conformsTo`,
        message: `Body vessel "${vesselId}" contains no ${label(token)} element whose embedded body conforms to profile "${profile}".`
      });
    }
  }
}

// A body vessel's accepts admits every element a demanded token describes
// iff it contains a token equal to the demand or more general than it (same
// kind, no type). A narrower token (same kind, different or narrower type)
// admits only part of the demanded set, and fails.
function admits(accepts: readonly AcceptToken[], token: AcceptToken): boolean {
  return accepts.some((have) => have.kind === token.kind && (have.type === undefined || have.type === token.type));
}

function label(token: AcceptToken): string {
  return token.type === undefined ? `"${token.kind}"` : `"${token.kind}/${token.type}"`;
}

// Predicates

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSide(value: unknown): value is Side {
  return typeof value === "string" && SIDE_SET.has(value);
}
