import { SLIM_ERROR, SlimError, formatSlimMessage } from "../errors.js";
import type { SlimValue } from "../protocol/types.js";
import type { SlimInstruction } from "./types.js";

/**
 * Parse one instruction row into a {@link SlimInstruction}.
 *
 * Operations are matched case-insensitively. Structurally malformed rows
 * (missing or non-string fixed words, or a row that is not a list) throw a
 * {@link SlimError} tagged `MALFORMED_INSTRUCTION` carrying the offending row —
 * matching the Java `InstructionFactory`. An unrecognised operation is *not* an
 * error here: it yields an `invalid` instruction that fails when executed.
 *
 * Port of `fitnesse.slim.instructions.InstructionFactory`.
 */
export function parseInstruction(row: readonly SlimValue[]): SlimInstruction {
  if (!Array.isArray(row)) {
    throw malformedError(formatWord(row));
  }

  const id = requiredWord(row, 0);
  const operation = requiredWord(row, 1);

  switch (operation.toLowerCase()) {
    case "import":
      return { kind: "import", id, path: requiredWord(row, 2) };

    case "make":
      return {
        kind: "make",
        id,
        instanceName: requiredWord(row, 2),
        className: requiredWord(row, 3),
        args: argumentsFrom(row, 4),
      };

    case "call":
      return {
        kind: "call",
        id,
        instanceName: requiredWord(row, 2),
        methodName: requiredWord(row, 3),
        args: argumentsFrom(row, 4),
      };

    case "callandassign":
      return {
        kind: "callAndAssign",
        id,
        symbolName: requiredWord(row, 2),
        instanceName: requiredWord(row, 3),
        methodName: requiredWord(row, 4),
        args: argumentsFrom(row, 5),
      };

    case "assign":
      return {
        kind: "assign",
        id,
        symbolName: requiredWord(row, 2),
        value: requiredWord(row, 3),
      };

    default:
      return { kind: "invalid", id, operation };
  }
}

/** Read a required string word, or fail the whole row as malformed. */
function requiredWord(row: readonly SlimValue[], index: number): string {
  const word = row[index];
  if (typeof word !== "string") {
    throw malformedError(formatRow(row));
  }
  return word;
}

/** Trailing words become method/constructor arguments (strings or lists). */
function argumentsFrom(row: readonly SlimValue[], start: number): SlimValue[] {
  return row.slice(start);
}

function malformedError(formattedRow: string): SlimError {
  return new SlimError(formatSlimMessage(`${formattedRow}.`, SLIM_ERROR.MALFORMED_INSTRUCTION), {
    tag: SLIM_ERROR.MALFORMED_INSTRUCTION,
  });
}

/** Render a row like the Java `wordsToString`: `[id,call,arg]`. */
function formatRow(row: readonly SlimValue[]): string {
  return `[${row.map(formatWord).join(",")}]`;
}

function formatWord(word: unknown): string {
  if (Array.isArray(word)) {
    return `[${word.map(formatWord).join(", ")}]`;
  }
  if (word === null || word === undefined) {
    return "null";
  }
  return String(word);
}
