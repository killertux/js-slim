import type { Converter } from "./types.js";

/** The response value FitNesse shows for a `void` method. */
export const VOID_TAG = "/__VOID__/";

/** Void conversion: renders the void tag and ignores input. */
export class VoidConverter implements Converter<void> {
  toSlim(): string {
    return VOID_TAG;
  }

  fromSlim(): null {
    return null;
  }
}
