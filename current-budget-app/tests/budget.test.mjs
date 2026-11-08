import test from "node:test";
import assert from "node:assert/strict";
import { accountBalance, householdBalance, plannedOccurrences } from "../lib/budget.ts";

function budget() {
  return { accounts: [{id: "a", name: "A", openingBalanceCents: 10000},
                       {id: "b", name: "B", openingBalanceCents: 2000}],
           transactions: [], plannedItems: [], categoryLimits: {}, cushionCents: 0,
           reconciliations: [] };
}
function transaction(id, accountId, amountCents, extra = {}) {
  return { id, accountId, amountCents, name: id, date: "2026-11-08", category: "Other",
           createdBy: "demo@example.com", createdAt: "2026-11-08T00:00:00Z", ...extra };
}
test("internal transfers conserve household balance", () => {
  const doc = budget();
  const before = householdBalance(doc);
  doc.transactions.push(transaction("out", "a", -3333, {transferId: "t"}),
                        transaction("in", "b", 3333, {transferId: "t"}));
  assert.equal(householdBalance(doc), before);
  assert.equal(accountBalance(doc, "a"), 6667);
});
test("pending reduces available balance; voided entries never count", () => {
  const doc = budget();
  doc.transactions.push(transaction("pending", "a", -500, {status: "pending"}),
                        transaction("void", "a", -900, {voidedAt: "2026-11-08"}));
  assert.equal(accountBalance(doc, "a"), 9500);
  assert.equal(accountBalance(doc, "a", false), 10000);
});
test("monthly recurrence clamps February then restores original day", () => {
  const doc = budget();
  doc.plannedItems.push({id: "rent", name: "Rent", amountCents: 100,
    kind: "bill", firstDate: "2026-01-31", repeat: "monthly", settledDates: []});
  assert.deepEqual(plannedOccurrences(doc, "2026-01-01", "2026-03-31").map(x => x.date),
                   ["2026-01-31", "2026-02-28", "2026-03-31"]);
  doc.plannedItems[0].settledDates = ["2026-02-28"];
  assert.equal(plannedOccurrences(doc, "2026-02-01", "2026-02-28").length, 0);
});
test("unknown accounts are rejected", () => {
  assert.throws(() => accountBalance(budget(), "missing"), /Account not found/);
});
