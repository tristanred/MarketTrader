/**
 * @name process.env read outside env.ts
 * @description Environment variables are parsed and validated once in packages/server/src/env.ts;
 *              everything else reads the typed `env` object so no variable escapes validation.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/process-env-outside-env-module
 * @tags maintainability
 *       correctness
 */

import javascript
import lib.MarketTrader

/**
 * A read of `process.env`. Every form — `process.env.X`, `process.env['X']`,
 * destructuring, or passing `process.env` along — starts with this read.
 */
DataFlow::Node processEnvRead() {
  result = DataFlow::globalVarRef("process").getAPropertyRead("env")
  or
  result = DataFlow::moduleImport(["process", "node:process"]).getAPropertyRead("env")
  or
  result = DataFlow::moduleMember(["process", "node:process"], "env")
}

from DataFlow::Node read
where
  read = processEnvRead() and
  MarketTrader::isAppSrc(read.getFile()) and
  not MarketTrader::serverFile(read.getFile(), "env.ts")
select read,
  "process.env read outside packages/server/src/env.ts; declare and validate the variable in env.ts and read it from the `env` object (frontend: import.meta.env)."
