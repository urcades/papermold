/// <reference path="../conformance/typescript/node-shims.d.ts" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { conforms } from "../src/index";
import { assertCaseMatches, assertRuleAnchorsExist, loadCorpusFiles, runCase } from "paperchain/conformance/v2";
import { dispatchPapermoldCase } from "../conformance/typescript/extended_conformance";

describe("papermold corpus v2", () => {
  const corpus = loadCorpusFiles([
    new URL("../conformance/cases/papermold-v1.json", import.meta.url),
    new URL("../conformance/cases/papermold-v2.json", import.meta.url)
  ]);

  it("links every rule to an explicit normative anchor", () => {
    const specification = readFileSync(new URL("../docs/spec.md", import.meta.url), "utf8");
    assertRuleAnchorsExist(corpus, {
      "papermold/v1": specification,
      "papermold/v2": specification
    });
  });

  for (const testCase of corpus.cases) {
    it(`${testCase.id}: ${testCase.rule}`, () => {
      const before = structuredClone(testCase.input.args);
      const actual = runCase(testCase, dispatchPapermoldCase);
      assertCaseMatches(testCase, actual);
      expect(testCase.input.args).toEqual(before);
    });
  }

  it("reevaluates mutation between public calls instead of retaining memo state", () => {
    const body = { root: "bag", vessels: { bag: { contains: [{ kind: "status", type: "ready" }] } } };
    const document = {
      protocol: "papermold/v1" as const,
      profiles: { ready: { vessels: { bag: { containsAtLeast: [{ kind: "status", type: "ready" }] } } } }
    };
    expect(conforms(body, document, "ready")).toBe(true);
    body.vessels.bag.contains = [];
    expect(conforms(body, document, "ready")).toBe(false);
  });
});
