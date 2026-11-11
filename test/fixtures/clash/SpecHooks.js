// A per-file hook (Temoc's `file_hooks`): each spec file starts from the
// loader's initial import paths, so it only sees the roots it imports itself.
import { currentFixtureLoader } from "../../../src/runtime/fixture-scope.js";

export class SpecHooks {
  beginFile() {
    const loader = currentFixtureLoader();
    if (loader === undefined) {
      throw new Error("no fixture loader in scope");
    }
    loader.resetPaths();
  }
}
