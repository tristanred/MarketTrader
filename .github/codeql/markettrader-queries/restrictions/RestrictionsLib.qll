/**
 * Helpers for the "X is only allowed in file Y" restriction queries.
 */

import javascript

module Restrictions {
  /**
   * A place where a module is pulled in by path: a static `import`, an
   * `import x = require(...)`, a `require(...)` call, a dynamic `import(...)`,
   * or an `export ... from '...'` re-export.
   */
  class ModuleRef extends AstNode {
    string path;

    ModuleRef() {
      path = this.(Import).getImportedPathString()
      or
      path = this.(ReExportDeclaration).getImportedPath().getStringValue()
    }

    /** The module specifier as written, e.g. `posthog-js` or `./lib/posthog`. */
    string getPath() { result = path }

    /** Holds if this is a dynamic `import(...)` expression. */
    predicate isDynamic() { this instanceof DynamicImportExpr }

    /**
     * Holds if this import is erased by the TypeScript compiler: `import type`,
     * `export type ... from`, or an import whose every specifier is `type`.
     */
    predicate isTypeOnly() {
      this.(ImportDeclaration).isTypeOnly()
      or
      this.(ExportDeclaration).isTypeOnly()
      or
      exists(ImportDeclaration d | d = this |
        exists(d.getASpecifier()) and
        forall(ImportSpecifier s | s = d.getASpecifier() | s.isTypeOnly())
      )
    }
  }

  /** Holds if `p` names `pkg` itself or a subpath export of it (`pkg/...`). */
  bindingset[p, pkg]
  predicate isPackage(string p, string pkg) { p = pkg or p.matches(pkg + "/%") }
}
