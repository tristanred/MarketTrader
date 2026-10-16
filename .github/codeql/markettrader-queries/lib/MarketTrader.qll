/**
 * Shared vocabulary for the MarketTrader invariant queries: where code lives,
 * and the sources and sinks several queries agree on.
 *
 * File predicates match on the path *suffix* so the same query works on the
 * real repository and on query-test fixtures, which mirror the repo layout
 * under their own test directory.
 */

import javascript

module MarketTrader {
  /** Holds if `f` is under `packages/server/src/`. */
  predicate isServerSrc(File f) { f.getRelativePath().matches("%packages/server/src/%") }

  /** Holds if `f` is under `packages/frontend/src/`. */
  predicate isFrontendSrc(File f) { f.getRelativePath().matches("%packages/frontend/src/%") }

  /** Holds if `f` is under `packages/shared/src/`. */
  predicate isSharedSrc(File f) { f.getRelativePath().matches("%packages/shared/src/%") }

  /** Holds if `f` is application source in any package (not tests, tools or config). */
  predicate isAppSrc(File f) { isServerSrc(f) or isFrontendSrc(f) or isSharedSrc(f) }

  /**
   * Holds if `f` is the file at `pathInPackage` under `packages/server/src/`,
   * e.g. `serverFile(f, "plugins/jwt.ts")`.
   */
  bindingset[pathInPackage]
  predicate serverFile(File f, string pathInPackage) {
    f.getRelativePath().matches("%packages/server/src/" + pathInPackage)
  }

  /** Like {@link serverFile} for `packages/frontend/src/`. */
  bindingset[pathInPackage]
  predicate frontendFile(File f, string pathInPackage) {
    f.getRelativePath().matches("%packages/frontend/src/" + pathInPackage)
  }

  /** A pino log level method. */
  string logLevel() { result = ["trace", "debug", "info", "warn", "error", "fatal"] }

  /**
   * A pino log call: `app.log.warn(...)`, `request.log?.error(...)`,
   * `this.logger?.error(...)`, `logger?.warn(...)`, `deps.logger?.warn(...)`.
   * Identified by the receiver being named `log` or `logger`, which is the
   * convention throughout the server.
   */
  class LoggerCall extends DataFlow::MethodCallNode {
    LoggerCall() {
      this.getMethodName() = logLevel() and
      exists(Expr recv | recv = this.getReceiver().asExpr().getUnderlyingReference() |
        recv.(PropAccess).getPropertyName() = ["log", "logger"]
        or
        recv.(VarAccess).getName() = ["log", "logger"]
      )
    }
  }

  /** A `console.*` call. */
  class ConsoleCall extends DataFlow::CallNode {
    ConsoleCall() { this = DataFlow::globalVarRef("console").getAMemberCall(_) }
  }

  /**
   * A call to the frontend `log(level, body, attrs)` facade exported by
   * `lib/posthog.ts`, which ships to PostHog Logs. It matches neither
   * {@link LoggerCall} (no `log`/`logger` receiver) nor the computed
   * `ph.logger[level](...)` inside it, so its callers are the sinks.
   */
  class FrontendLogCall extends DataFlow::CallNode {
    FrontendLogCall() {
      exists(Function f | f = this.getACallee() |
        frontendFile(f.getFile(), "lib/posthog.ts") and
        f.getName() = "log"
      )
    }
  }

  /** Any argument to a pino log call, a `console.*` call, or the frontend `log()` facade. */
  class LogSink extends DataFlow::Node {
    LogSink() {
      this = any(LoggerCall c).getAnArgument()
      or
      this = any(ConsoleCall c).getAnArgument()
      or
      this = any(FrontendLogCall c).getAnArgument()
    }
  }

  /**
   * An argument to a PostHog SDK method on either side: `capture`,
   * `captureException`, `identify`, `register`, or the frontend facade functions
   * that wrap them. `register` is posthog-js super-properties only: Fastify's
   * `app.register(plugin, opts)` (server) and react-hook-form's
   * `form.register('field')` are excluded.
   */
  class AnalyticsSink extends DataFlow::Node {
    AnalyticsSink() {
      exists(DataFlow::CallNode c |
        (
          c.(DataFlow::MethodCallNode).getMethodName() =
            ["capture", "captureException", "identify", "setPersonProperties"]
          or
          c.(DataFlow::MethodCallNode).getMethodName() = "register" and
          not isServerSrc(c.getFile()) and
          not c.(DataFlow::MethodCallNode).getReceiver().getALocalSource().(DataFlow::CallNode).getCalleeName() =
            "useForm"
          or
          c.getCalleeName() = ["capture", "captureException", "identify", "identifyUser"]
        ) and
        this = c.getAnArgument()
      )
    }
  }

  /**
   * The payload of `reply.send(x)` — including chained `reply.status(n).send(x)` /
   * `reply.code(n).header(..).send(x)` — or a value returned from a Fastify route handler.
   */
  class HttpResponseSink extends DataFlow::Node {
    HttpResponseSink() {
      exists(DataFlow::MethodCallNode send |
        send.getMethodName() = "send" and
        replyReceiver(send.getReceiver()) and
        this = send.getArgument(0)
      )
      or
      exists(RouteHandler h | this = h.getAReturn())
    }
  }

  /** Holds if `n` is `reply`, or a `reply.status(..)`-style chain that returns it. */
  private predicate replyReceiver(DataFlow::Node n) {
    n.asExpr().getUnderlyingReference().(VarAccess).getName() = "reply"
    or
    exists(DataFlow::MethodCallNode chain | chain = n |
      chain.getMethodName() = ["status", "code", "header", "headers", "type"] and
      replyReceiver(chain.getReceiver())
    )
  }

  /** A Fastify route registration: `app.get(path, opts?, handler)` and friends. */
  class RouteRegistration extends DataFlow::MethodCallNode {
    RouteRegistration() {
      this.getMethodName() = ["get", "post", "put", "patch", "delete", "head", "options"] and
      isServerSrc(this.getFile()) and
      exists(string p | p = this.getArgument(0).getStringValue() | p.charAt(0) = "/")
    }

    /** The route path literal, e.g. `/games/:id/trades`. */
    string getPath() { result = this.getArgument(0).getStringValue() }

    /** The options object literal, if the route passes one. */
    DataFlow::ObjectLiteralNode getOptions() {
      result = this.getArgument(1) and this.getNumArgument() >= 3
    }

    /** The handler function (the last argument). */
    DataFlow::FunctionNode getHandler() {
      result = this.getLastArgument().getALocalSource()
    }
  }

  /** The handler function of a {@link RouteRegistration}. */
  class RouteHandler extends DataFlow::FunctionNode {
    RouteHandler() { this = any(RouteRegistration r).getHandler() }
  }

  /** A read of `request.body`, `request.query`, `request.params` or `request.headers`. */
  class RequestInput extends DataFlow::Node instanceof DataFlow::PropRead {
    RequestInput() {
      super.getPropertyName() = ["body", "query", "params", "headers", "cookies"] and
      super.getBase().asExpr().getUnderlyingReference().(VarAccess).getName() = ["request", "req"]
    }

    /** `body`, `query`, `params`, `headers` or `cookies`. */
    string getKind() { result = super.getPropertyName() }
  }

  /** The attributes argument of `meters.<instrument>.add(n, attrs)` / `.record(n, attrs)`. */
  class MetricAttributesSink extends DataFlow::Node {
    MetricAttributesSink() {
      exists(DataFlow::MethodCallNode c, DataFlow::PropRead inst |
        c.getMethodName() = ["add", "record"] and
        inst = c.getReceiver() and
        inst.getBase().asExpr().getUnderlyingReference().(VarAccess).getName() = "meters" and
        this = c.getArgument(1)
      )
    }
  }

  /**
   * A span attribute or name sink: `span.setAttribute(k, v)`, `setAttributes`,
   * `updateName`, `recordException`, and the `attributes` option of `startActiveSpan`.
   */
  class SpanSink extends DataFlow::Node {
    SpanSink() {
      exists(DataFlow::MethodCallNode c |
        c.getMethodName() = ["setAttribute", "setAttributes", "updateName", "recordException", "addEvent"] and
        this = c.getAnArgument()
      )
      or
      exists(DataFlow::MethodCallNode c | c.getMethodName() = ["startActiveSpan", "startSpan"] |
        this = c.getArgument(0)
        or
        this = c.getAnArgument().getALocalSource().(DataFlow::ObjectLiteralNode).getAPropertyWrite("attributes").getRhs()
      )
    }
  }

  /** A read of `env.<NAME>` where `env` is the validated env object from `env.ts`. */
  class EnvRead extends DataFlow::Node instanceof DataFlow::PropRead {
    EnvRead() { super.getBase().asExpr().getUnderlyingReference().(VarAccess).getName() = "env" }

    /** The env var name, e.g. `JWT_SECRET`. */
    string getVarName() { result = super.getPropertyName() }
  }
}
