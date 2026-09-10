import { SlimSyntaxError } from "./errors.js";
import { MINIMUM_NUMBER_LENGTH } from "./length.js";
import type { SlimList, SlimValue } from "./types.js";

/**
 * Maximum list nesting depth accepted by {@link deserialize}.
 *
 * The Java reference implementation has no limit and can overflow the stack on
 * adversarial input; here, exceeding the limit throws a {@link SlimSyntaxError}
 * instead.
 */
export const MAX_NESTING_DEPTH = 500;

/**
 * Parse a SLiM serialized string back into a (possibly nested) list.
 *
 * The inverse of {@link serialize}. Items that themselves start with `[` are
 * tentatively parsed as nested lists; if that fails they are kept as plain
 * strings. Malformed input throws a {@link SlimSyntaxError}.
 *
 * For parity with the Java reference implementation, any content following
 * the closing `]` of the top-level list is ignored.
 *
 * Port of `fitnesse.slim.protocol.SlimDeserializer`.
 */
export function deserialize(serialized: string): SlimList {
  const source: unknown = serialized;

  if (source === null || source === undefined) {
    throw new SlimSyntaxError("Can't deserialize null");
  }
  if (typeof source !== "string") {
    throw new SlimSyntaxError(`Can't deserialize a ${typeof source}`);
  }
  if (source.length === 0) {
    throw new SlimSyntaxError("Can't deserialize empty string");
  }

  return new Reader(source).readList(0);
}

class NestingDepthError extends SlimSyntaxError {}

class Reader {
  private index = 0;

  constructor(private readonly source: string) {}

  readList(depth: number): SlimList {
    if (depth > MAX_NESTING_DEPTH) {
      throw new NestingDepthError(
        `Serialized list exceeds the maximum nesting depth of ${MAX_NESTING_DEPTH}`,
      );
    }

    this.expect("[", "Serialized list has no starting [");

    const itemCount = this.readLength();
    const result: SlimList = [];

    for (let i = 0; i < itemCount; i += 1) {
      result.push(this.readItem(depth));
    }

    this.expect("]", "Serialized list has no ending ]");
    return result;
  }

  private readItem(depth: number): SlimValue {
    const itemLength = this.readLength();
    const item = this.readString(itemLength);
    return maybeReadList(item, depth + 1) ?? item;
  }

  private readString(length: number): string {
    const end = this.index + length;
    if (end > this.source.length) {
      throw new SlimSyntaxError("String in serialized list is shorter than its length prefix.");
    }
    const value = this.source.slice(this.index, end);
    this.index = end;
    this.expect(":", "String in serialized list not terminated by colon.");
    return value;
  }

  private readLength(): number {
    if (this.index + MINIMUM_NUMBER_LENGTH > this.source.length) {
      throw new SlimSyntaxError("Serialized list is too short to contain a length.");
    }

    const head = this.source.slice(this.index, this.index + MINIMUM_NUMBER_LENGTH);
    if (!/^\d+$/.test(head)) {
      throw new SlimSyntaxError(`Length in serialized list is not a number: ${head}`);
    }

    let length = Number.parseInt(head, 10);
    this.index += MINIMUM_NUMBER_LENGTH;

    // Protocol >= 0.4: the decimal representation may exceed six digits.
    while (this.index < this.source.length && isDigit(this.source[this.index])) {
      length = length * 10 + Number.parseInt(this.source[this.index] as string, 10);
      this.index += 1;
    }

    this.expect(":", "Length in serialized list not terminated by colon.");
    return length;
  }

  private expect(char: string, message: string): void {
    if (this.source[this.index] !== char) {
      throw new SlimSyntaxError(message);
    }
    this.index += 1;
  }
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

/**
 * @returns the string parsed as a nested list if possible, `null` otherwise.
 *
 * A nesting-depth violation is re-thrown rather than treated as a plain string,
 * so adversarial input fails loudly instead of silently degrading.
 */
function maybeReadList(value: string, depth: number): SlimList | null {
  if (value.trim() === "" || !value.startsWith("[")) {
    return null;
  }

  try {
    return new Reader(value).readList(depth);
  } catch (error) {
    if (error instanceof NestingDepthError) {
      throw error;
    }
    if (error instanceof SlimSyntaxError) {
      return null;
    }
    throw error;
  }
}
