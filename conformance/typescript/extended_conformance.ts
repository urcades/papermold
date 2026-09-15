import {
  conforms,
  conformsBody,
  conformsScene,
  judge,
  judgeBody,
  judgeScene,
  validateProfiles,
  validateSceneProfiles,
  type Body,
  type PapermoldDocument,
  type PapermoldSceneDocument,
  type Scene
} from "../../src/index";
import {
  projectJudgment,
  projectValidation,
  projectValue,
  type CaseDispatcher
} from "paperchain/conformance/v2";

export const dispatchPapermoldCase: CaseDispatcher = (testCase) => {
  const args = testCase.input.args;
  switch (testCase.operation) {
    case "validateProfiles":
      return projectValidation(validateProfiles(args[0]));
    case "judge":
      return projectJudgment(judge(args[0] as Body, args[1] as PapermoldDocument, args[2] as string));
    case "conforms":
      return projectValue(conforms(args[0] as Body, args[1] as PapermoldDocument, args[2] as string));
    case "validateSceneProfiles":
      return projectValidation(validateSceneProfiles(args[0]));
    case "judgeBody":
      return projectJudgment(judgeBody(args[0] as Body, args[1] as PapermoldSceneDocument, args[2] as string));
    case "conformsBody":
      return projectValue(conformsBody(args[0] as Body, args[1] as PapermoldSceneDocument, args[2] as string));
    case "judgeScene":
      return projectJudgment(judgeScene(args[0] as Scene, args[1] as PapermoldSceneDocument, args[2] as string));
    case "conformsScene":
      return projectValue(conformsScene(args[0] as Scene, args[1] as PapermoldSceneDocument, args[2] as string));
    default:
      throw new Error(`Unsupported papermold operation ${testCase.operation}`);
  }
};
