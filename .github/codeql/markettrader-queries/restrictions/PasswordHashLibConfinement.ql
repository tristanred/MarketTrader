/**
 * @name Password hashing library used outside its allowed files
 * @description @node-rs/argon2 may only be imported by routes/auth.ts, routes/admin/users.ts
 *              and db/seed-admin.ts, and bcrypt is never used, so password hashing stays
 *              in one audited place.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/password-hash-lib-confinement
 * @tags security
 *       maintainability
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

predicate argon2AllowedFile(File f) {
  MarketTrader::serverFile(f, "routes/auth.ts") or
  MarketTrader::serverFile(f, "routes/admin/users.ts") or
  MarketTrader::serverFile(f, "db/seed-admin.ts")
}

from Restrictions::ModuleRef ref, string msg
where
  MarketTrader::isAppSrc(ref.getFile()) and
  (
    Restrictions::isPackage(ref.getPath(), "@node-rs/argon2") and
    not argon2AllowedFile(ref.getFile()) and
    msg =
      "@node-rs/argon2 is only imported by routes/auth.ts, routes/admin/users.ts and db/seed-admin.ts; hash passwords there."
    or
    Restrictions::isPackage(ref.getPath(), ["bcrypt", "bcryptjs", "bcrypt-ts", "@node-rs/bcrypt"]) and
    msg = "Passwords are hashed with argon2 (@node-rs/argon2), never bcrypt."
    or
    // A second argon2 binding would split hashing across two implementations.
    Restrictions::isPackage(ref.getPath(), ["argon2", "argon2-browser", "hash-wasm"]) and
    msg = "Passwords are hashed with @node-rs/argon2 only; do not add another argon2 binding."
  )
select ref, msg
