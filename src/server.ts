import { ExecutionContext } from "./runtime/execution-context.js";
import { FixtureLoader } from "./runtime/fixture-loader.js";
import { Session, type SessionOptions } from "./runtime/session.js";
import { StatementExecutor } from "./runtime/statement-executor.js";
import type { SlimConnection } from "./transport/frame.js";

export interface SlimServerOptions {
  /**
   * Fixture loader shared by every connection's execution context. When
   * omitted a fresh loader is created per connection.
   */
  fixtureLoader?: FixtureLoader;
  /** Builds the per-connection statement executor. Overrides the options above. */
  createExecutor?: () => StatementExecutor;
  /** Per-instruction timeout in seconds. */
  timeoutSeconds?: number;
  /** Log each instruction and result. */
  verbose?: boolean;
  /** Sink for verbose logs. */
  logger?: (message: string) => void;
}

/**
 * Serves SLiM sessions over a {@link SlimConnection}.
 *
 * Each connection gets a fresh {@link StatementExecutor} (and execution
 * context), matching the Java server which builds a `ListExecutor` per
 * connection. Pass `serve` to `startSocketServer`, `createStdioConnection`, or
 * call it directly.
 */
export class SlimServer {
  private readonly createExecutor: () => StatementExecutor;
  private readonly sessionOptions: SessionOptions;

  constructor(options: SlimServerOptions = {}) {
    this.createExecutor =
      options.createExecutor ??
      (() =>
        new StatementExecutor({
          context: new ExecutionContext({
            fixtureLoader: options.fixtureLoader ?? new FixtureLoader(),
          }),
          timeoutSeconds: options.timeoutSeconds,
        }));

    this.sessionOptions = {
      verbose: options.verbose ?? false,
      logger: options.logger,
    };
  }

  /** Serve one connection: header, instruction batches, `bye`. */
  async serve(connection: SlimConnection): Promise<void> {
    await new Session(this.createExecutor(), this.sessionOptions).run(connection);
  }
}
