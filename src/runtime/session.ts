import { formatException } from "../errors.js";
import { parseInstruction } from "../instructions/parse.js";
import type { SlimInstruction } from "../instructions/types.js";
import { deserialize } from "../protocol/deserializer.js";
import { serialize } from "../protocol/serializer.js";
import type { SlimValue } from "../protocol/types.js";
import { isByeMessage, type SlimConnection } from "../transport/frame.js";
import type { SlimRow, StatementExecutor } from "./statement-executor.js";

export interface SessionOptions {
  /** Log each instruction and its result. */
  verbose?: boolean;
  /** Sink for verbose logs (defaults to none). */
  logger?: ((message: string) => void) | undefined;
}

/**
 * Per-connection SLiM protocol loop.
 *
 * Writes the header, then repeatedly reads a framed instruction batch, executes
 * it and writes the response batch until `bye` or EOF. Port of
 * `fitnesse.slim.SlimServer#tryProcessInstructions` plus the `ListExecutor`
 * batch bookkeeping.
 */
export class Session {
  constructor(
    private readonly executor: StatementExecutor,
    private readonly options: SessionOptions = {},
  ) {}

  /** Serve one connection until `bye` or EOF. */
  async run(connection: SlimConnection): Promise<void> {
    connection.writeHeader();

    for (;;) {
      const message = await connection.readMessage();
      if (message === null) {
        return;
      }
      if (isByeMessage(message)) {
        return;
      }
      connection.writeMessage(await this.handleMessage(message));
    }
  }

  /** Deserialize a batch, execute it and serialize the response. */
  async handleMessage(message: string): Promise<string> {
    const rows = deserialize(message);
    return serialize(await this.handle(rows));
  }

  /**
   * Execute instruction rows, returning `[id, value]` response rows.
   *
   * A structurally malformed row yields an exception row keyed by its id and
   * the batch continues; stop/ignore skips the remaining rows and clears the
   * flag afterwards.
   */
  async handle(rows: readonly SlimValue[]): Promise<SlimRow[]> {
    const results: SlimRow[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      if (this.executor.stopHasBeenRequested()) {
        break;
      }

      const row = rows[index] as SlimValue;
      let instruction: SlimInstruction;
      try {
        instruction = parseInstruction(row as readonly SlimValue[]);
      } catch (error) {
        // A row without a usable id is skipped: fabricating one could collide
        // with a real instruction id and corrupt FitNesse's result mapping.
        const id = rowId(row);
        if (id !== null) {
          results.push([id, formatException(error)]);
        }
        continue;
      }

      this.log(`-> ${describeInstruction(instruction)}`);
      const result = await this.executor.runInstruction(instruction);
      this.log(`<- [${instruction.id}] ${firstLine(result)}`);
      results.push(result);
    }

    if (this.executor.stopHasBeenRequested()) {
      this.executor.reset();
    }
    return results;
  }

  private log(message: string): void {
    if (this.options.verbose === true) {
      this.options.logger?.(message);
    }
  }
}

function rowId(row: SlimValue): string | null {
  const id = Array.isArray(row) ? row[0] : undefined;
  return typeof id === "string" ? id : null;
}

function describeInstruction(instruction: SlimInstruction): string {
  const args = (values: readonly SlimValue[]): string =>
    values.length === 0 ? "" : ` ${values.join(" ")}`;

  switch (instruction.kind) {
    case "import":
      return `import ${instruction.path}`;
    case "make":
      return `make ${instruction.instanceName} ${instruction.className}${args(instruction.args)}`;
    case "call":
      return `call ${instruction.instanceName} ${instruction.methodName}${args(instruction.args)}`;
    case "callAndAssign":
      return `callAndAssign ${instruction.symbolName} ${instruction.instanceName} ${instruction.methodName}${args(instruction.args)}`;
    case "assign":
      return `assign ${instruction.symbolName} ${instruction.value}`;
    case "invalid":
      return `invalid ${instruction.operation}`;
  }
}

function firstLine(row: SlimRow): string {
  const value = row[1];
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value).split("\n")[0] as string;
}
