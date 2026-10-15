/**
 * @name Cash or holdings write outside a transaction
 * @description Writes to gamePlayers.cashBalance and to portfolios rows must go through a db.transaction handle so the balance, the holding and the trade row commit or roll back together.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/balance-write-outside-transaction
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import business.BusinessLib

/** A write whose atomicity with its sibling writes the invariant protects. */
predicate coveredWrite(Business::DrizzleWrite w, string what) {
  w.getOp() = "update" and
  w.getTable() = "gamePlayers" and
  exists(Business::payloadValue(w, "cashBalance")) and
  what = "update of gamePlayers.cashBalance"
  or
  w.getTable() = "portfolios" and
  what = w.getOp() + " on portfolios"
}

/**
 * A `gamePlayers` insert seeds the starting cash. On its own it is a single
 * atomic statement (e.g. joining a game), so it is only flagged when the same
 * function makes another write outside a transaction that it must commit with.
 */
predicate unpairedPlayerInsert(Business::DrizzleWrite w, Business::DrizzleWrite other) {
  w.getOp() = "insert" and
  w.getTable() = "gamePlayers" and
  other != w and
  other.getContainer() = w.getContainer() and
  not Business::inTransaction(other)
}

from Business::DrizzleWrite w, string msg, DataFlow::Node other, string otherLabel
where
  MarketTrader::isServerSrc(w.getFile()) and
  not Business::inTransaction(w) and
  (
    exists(string what | coveredWrite(w, what) |
      msg =
        "This " + what +
          " runs on $@, which is not (on every call path) a transaction handle. Perform it through the tx of a db.transaction callback together with the writes it must commit with."
    ) and
    other = w.getReceiver() and
    otherLabel = w.getReceiver().toString()
    or
    exists(Business::DrizzleWrite o | unpairedPlayerInsert(w, o) |
      other = o and
      otherLabel = "this " + o.getOp() + " on " + o.getTable()
    ) and
    msg =
      "This insert of gamePlayers (starting cash) is not atomic with $@: if it fails the other write is left behind. Wrap both in one db.transaction."
  )
select w, msg, other, otherLabel
