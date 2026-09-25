export type Account = { id: string; name: string; openingBalanceCents: number };
export type Transaction = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  name: string;
  category: string;
  createdBy: string;
  createdAt: string;
  voidedAt?: string;
  plannedItemId?: string;
  occurrenceDate?: string;
  status?: "pending" | "cleared";
  transferId?: string;
  importKey?: string;
  splitGroupId?: string;
};
export type SinkingFund = {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  targetDate?: string;
};
export type CheckIn = {
  id: string;
  weekStart: string;
  createdBy: string;
  createdAt: string;
  note: string;
  safeCents: number;
  acknowledgedBy: string[];
};
export type PlannedItem = {
  id: string;
  name: string;
  amountCents: number;
  kind: "bill" | "income";
  firstDate: string;
  repeat: "none" | "weekly" | "biweekly" | "monthly";
  settledDates: string[];
};
export type Reconciliation = {
  id: string;
  accountId: string;
  observedBalanceCents: number;
  ledgerBeforeCents: number;
  adjustmentCents: number;
  date: string;
  createdBy: string;
  createdAt: string;
};
export type BudgetDocument = {
  accounts: Account[];
  transactions: Transaction[];
  plannedItems: PlannedItem[];
  categoryLimits: Record<string, number>;
  cushionCents: number;
  reconciliations: Reconciliation[];
  funds?: SinkingFund[];
  checkIns?: CheckIn[];
  customCategories?: string[];
};

export const categories = [
  "Groceries",
  "Dining",
  "Transport",
  "Shopping",
  "Health",
  "Home",
  "Other",
] as const;

export function budgetCategories(document: BudgetDocument): string[] {
  return [...categories, ...(document.customCategories ?? [])];
}

export function emptyBudget(): BudgetDocument {
  return {
    accounts: [
      { id: crypto.randomUUID(), name: "Checking", openingBalanceCents: 0 },
    ],
    transactions: [],
    plannedItems: [],
    reconciliations: [],
    funds: [],
    checkIns: [],
    customCategories: [],
    cushionCents: 0,
    categoryLimits: Object.fromEntries(
      categories.map((category) => [category, 0]),
    ),
  };
}

export function accountBalance(
  document: BudgetDocument,
  accountId: string,
  includePending = true,
): number {
  const account = document.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("Account not found");
  return (
    account.openingBalanceCents +
    document.transactions
      .filter(
        (item) =>
          item.accountId === accountId &&
          !item.voidedAt &&
          (includePending || item.status !== "pending"),
      )
      .reduce((sum, item) => sum + item.amountCents, 0)
  );
}

export function reservedBalance(document: BudgetDocument): number {
  return (document.funds ?? []).reduce((sum, fund) => sum + fund.savedCents, 0);
}

export function householdBalance(document: BudgetDocument): number {
  return document.accounts.reduce(
    (sum, account) => sum + accountBalance(document, account.id),
    0,
  );
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function nextMonth(date: string, anchorDay: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  value.setUTCDate(Math.min(anchorDay, lastDay));
  return value.toISOString().slice(0, 10);
}

export type Occurrence = PlannedItem & { date: string };
export function plannedOccurrences(
  document: BudgetDocument,
  start: string,
  end: string,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const item of document.plannedItems) {
    let date = item.firstDate;
    const anchor = Number(item.firstDate.slice(8, 10));
    let limit = 0;
    while (date <= end && limit++ < 400) {
      if (date >= start && !item.settledDates.includes(date))
        occurrences.push({ ...item, date });
      if (item.repeat === "weekly") date = addDays(date, 7);
      else if (item.repeat === "biweekly") date = addDays(date, 14);
      else if (item.repeat === "monthly") date = nextMonth(date, anchor);
      else break;
    }
  }
  return occurrences.sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}

export type Bridge = {
  currentCents: number;
  safeCents: number;
  dailyCents: number;
  billsBeforePaydayCents: number;
  daysToPayday: number;
  paydayDate: string | null;
  lowCents: number;
  lowDate: string;
  occurrences: Occurrence[];
  reservedCents: number;
};
export function bridgeToPayday(
  document: BudgetDocument,
  today: string,
  horizonDays = 30,
): Bridge {
  const currentCents = householdBalance(document);
  const reservedCents = reservedBalance(document);
  const end = addDays(today, horizonDays);
  const occurrences = plannedOccurrences(document, today, end);
  const payday = occurrences.find((item) => item.kind === "income") ?? null;
  const cutoff = payday?.date ?? end;
  const billsBeforePaydayCents = occurrences
    .filter((item) => item.kind === "bill" && item.date <= cutoff)
    .reduce((sum, item) => sum + item.amountCents, 0);
  const daysToPayday = Math.max(
    1,
    Math.round(
      (Date.parse(`${cutoff}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) /
        86400000,
    ),
  );
  const safeCents =
    currentCents -
    billsBeforePaydayCents -
    document.cushionCents -
    reservedCents;
  let running = currentCents,
    lowCents = currentCents,
    lowDate = today;
  for (const item of occurrences) {
    running += item.kind === "income" ? item.amountCents : -item.amountCents;
    if (running < lowCents) {
      lowCents = running;
      lowDate = item.date;
    }
  }
  return {
    currentCents,
    safeCents,
    dailyCents: Math.max(0, Math.floor(safeCents / daysToPayday)),
    billsBeforePaydayCents,
    daysToPayday,
    paydayDate: payday?.date ?? null,
    lowCents,
    lowDate,
    occurrences,
    reservedCents,
  };
}

export function reconcileAccount(
  document: BudgetDocument,
  accountId: string,
  observedBalanceCents: number,
  actor: string,
  date: string,
): BudgetDocument {
  const before = accountBalance(document, accountId, false);
  const adjustment = observedBalanceCents - before;
  const stamp = new Date().toISOString();
  return {
    ...document,
    transactions:
      adjustment === 0
        ? document.transactions
        : [
            ...document.transactions,
            {
              id: crypto.randomUUID(),
              accountId,
              date,
              amountCents: adjustment,
              name: "Balance adjustment",
              category: "Adjustment",
              createdBy: actor,
              createdAt: stamp,
            },
          ],
    reconciliations: [
      ...document.reconciliations,
      {
        id: crypto.randomUUID(),
        accountId,
        observedBalanceCents,
        ledgerBeforeCents: before,
        adjustmentCents: adjustment,
        date,
        createdBy: actor,
        createdAt: stamp,
      },
    ],
  };
}
