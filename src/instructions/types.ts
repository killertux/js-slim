import type { SlimValue } from "../protocol/types.js";

/**
 * A parsed SLiM instruction.
 *
 * Port of the `fitnesse.slim.instructions` hierarchy: one variant per wire
 * operation, plus {@link InvalidInstruction} for an unrecognised operation
 * (which is reported as an error when executed, not while parsing).
 */
export type SlimInstruction =
  | ImportInstruction
  | MakeInstruction
  | CallInstruction
  | CallAndAssignInstruction
  | AssignInstruction
  | InvalidInstruction;

/** `[id, import, path]` — add a fixture search path. */
export interface ImportInstruction {
  readonly kind: "import";
  readonly id: string;
  readonly path: string;
}

/** `[id, make, instanceName, className, ...args]` — construct a fixture. */
export interface MakeInstruction {
  readonly kind: "make";
  readonly id: string;
  readonly instanceName: string;
  readonly className: string;
  readonly args: readonly SlimValue[];
}

/** `[id, call, instanceName, methodName, ...args]` — invoke a method. */
export interface CallInstruction {
  readonly kind: "call";
  readonly id: string;
  readonly instanceName: string;
  readonly methodName: string;
  readonly args: readonly SlimValue[];
}

/** `[id, callAndAssign, symbolName, instanceName, methodName, ...args]`. */
export interface CallAndAssignInstruction {
  readonly kind: "callAndAssign";
  readonly id: string;
  readonly symbolName: string;
  readonly instanceName: string;
  readonly methodName: string;
  readonly args: readonly SlimValue[];
}

/** `[id, assign, symbolName, value]` — store a symbol value directly. */
export interface AssignInstruction {
  readonly kind: "assign";
  readonly id: string;
  readonly symbolName: string;
  readonly value: string;
}

/** An instruction whose operation is not part of the protocol. */
export interface InvalidInstruction {
  readonly kind: "invalid";
  readonly id: string;
  readonly operation: string;
}
