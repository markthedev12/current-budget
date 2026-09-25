import { env } from "cloudflare:workers";
import { cognitoConfig, getAppUser } from "@/app/product-auth";
import {
  accountBalance,
  budgetCategories,
  categories,
  emptyBudget,
  reconcileAccount,
  bridgeToPayday,
  householdBalance,
  type BudgetDocument,
  type PlannedItem,
} from "@/lib/budget";

export const dynamic = "force-dynamic";

type MemberRow = {
  id: string;
  household_id: string;
  user_id: string | null;
  email: string;
  role: "owner" | "member";
  joined_at: string | null;
};
type HouseholdRow = { id: string; name: string };
type DocumentRow = { version: number; document: string };

function db() {
  if (!env.DB) throw new Error("Budget database is unavailable");
  return env.DB;
}

function error(message: string, status = 400) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function clean(value: unknown, max = 80): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cents(value: unknown, allowNegative = false): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= 1_000_000_000 &&
    (allowNegative || value >= 0)
    ? value
    : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function validBackup(value: unknown): value is BudgetDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    item.customCategories !== undefined &&
    (!Array.isArray(item.customCategories) ||
      item.customCategories.length > 25 ||
      !item.customCategories.every(
        (category) =>
          typeof category === "string" &&
          category.trim().length > 0 &&
          category.trim().length <= 30,
      ) ||
      new Set(
        item.customCategories.map((category) => String(category).toLowerCase()),
      ).size !== item.customCategories.length ||
      item.customCategories.some((category) =>
        [...categories, "Income", "Transfer", "Adjustment"].some(
          (reserved) => reserved.toLowerCase() === category.toLowerCase(),
        ),
      ))
  )
    return false;
  if (
    !Array.isArray(item.accounts) ||
    !Array.isArray(item.transactions) ||
    !Array.isArray(item.plannedItems) ||
    !Array.isArray(item.reconciliations) ||
    !item.categoryLimits ||
    typeof item.categoryLimits !== "object" ||
    cents(item.cushionCents) === null
  )
    return false;
  if (
    !item.accounts.length ||
    item.accounts.length > 10 ||
    item.transactions.length > 5000 ||
    item.plannedItems.length > 200 ||
    item.reconciliations.length > 5000
  )
    return false;
  const accounts = item.accounts as Record<string, unknown>[];
  if (
    !accounts.every(
      (account) =>
        typeof account.id === "string" &&
        account.id.length < 100 &&
        clean(account.name) &&
        cents(account.openingBalanceCents, true) !== null,
    )
  )
    return false;
  const accountIds = new Set(accounts.map((account) => account.id));
  if (accountIds.size !== accounts.length) return false;
  const transactions = item.transactions as Record<string, unknown>[];
  if (
    !transactions.every(
      (transaction) =>
        typeof transaction.id === "string" &&
        accountIds.has(transaction.accountId) &&
        validDate(transaction.date) &&
        cents(transaction.amountCents, true) !== null &&
        clean(transaction.name) &&
        typeof transaction.category === "string" &&
        typeof transaction.createdBy === "string" &&
        typeof transaction.createdAt === "string" &&
        (transaction.status === undefined ||
          ["pending", "cleared"].includes(String(transaction.status))) &&
        (transaction.importKey === undefined ||
          typeof transaction.importKey === "string") &&
        (transaction.transferId === undefined ||
          typeof transaction.transferId === "string") &&
        (transaction.splitGroupId === undefined ||
          typeof transaction.splitGroupId === "string"),
    )
  )
    return false;
  const planned = item.plannedItems as Record<string, unknown>[];
  if (
    !planned.every(
      (plannedItem) =>
        typeof plannedItem.id === "string" &&
        clean(plannedItem.name) &&
        cents(plannedItem.amountCents) !== null &&
        validDate(plannedItem.firstDate) &&
        ["bill", "income"].includes(String(plannedItem.kind)) &&
        ["none", "weekly", "biweekly", "monthly"].includes(
          String(plannedItem.repeat),
        ) &&
        Array.isArray(plannedItem.settledDates) &&
        plannedItem.settledDates.every(validDate),
    )
  )
    return false;
  const reconciliations = item.reconciliations as Record<string, unknown>[];
  if (
    !reconciliations.every(
      (reconciliation) =>
        typeof reconciliation.id === "string" &&
        accountIds.has(reconciliation.accountId) &&
        cents(reconciliation.observedBalanceCents, true) !== null &&
        cents(reconciliation.ledgerBeforeCents, true) !== null &&
        cents(reconciliation.adjustmentCents, true) !== null &&
        validDate(reconciliation.date) &&
        typeof reconciliation.createdBy === "string" &&
        typeof reconciliation.createdAt === "string",
    )
  )
    return false;
  const limits = item.categoryLimits as Record<string, unknown>;
  const allowedCategories = [
    ...categories,
    ...((item.customCategories as string[] | undefined) ?? []),
  ];
  if (!allowedCategories.every((category) => cents(limits[category]) !== null))
    return false;
  if (item.funds !== undefined) {
    if (!Array.isArray(item.funds) || item.funds.length > 100) return false;
    if (
      !(item.funds as Record<string, unknown>[]).every(
        (fund) =>
          typeof fund.id === "string" &&
          clean(fund.name) &&
          cents(fund.targetCents) !== null &&
          cents(fund.savedCents) !== null &&
          (fund.targetDate === undefined || validDate(fund.targetDate)),
      )
    )
      return false;
  }
  if (item.checkIns !== undefined) {
    if (!Array.isArray(item.checkIns) || item.checkIns.length > 500)
      return false;
    if (
      !(item.checkIns as Record<string, unknown>[]).every(
        (checkIn) =>
          typeof checkIn.id === "string" &&
          validDate(checkIn.weekStart) &&
          typeof checkIn.createdBy === "string" &&
          typeof checkIn.createdAt === "string" &&
          typeof checkIn.note === "string" &&
          cents(checkIn.safeCents, true) !== null &&
          Array.isArray(checkIn.acknowledgedBy) &&
          checkIn.acknowledgedBy.every(
            (email: unknown) => typeof email === "string",
          ),
      )
    )
      return false;
  }
  return true;
}

async function getMembership(
  user: {
    userId: string;
    email: string;
  },
  requestedHouseholdId?: string | null,
): Promise<MemberRow> {
  const database = db();
  const email = user.email.toLowerCase();
  const memberships = await database
    .prepare(
      "SELECT * FROM household_members WHERE user_id = ? ORDER BY joined_at ASC",
    )
    .bind(user.userId)
    .all<MemberRow>();
  if (memberships.results.length)
    return (
      memberships.results.find(
        (row) => row.household_id === requestedHouseholdId,
      ) ?? memberships.results[0]
    );

  // The original couple invitation remains automatic. Later invitations require
  // an explicit choice, so signing in cannot silently switch households.
  const invited = await database
    .prepare(
      "SELECT * FROM household_members WHERE email = ? AND user_id IS NULL AND household_id = 'initial-shared-household' LIMIT 1",
    )
    .bind(email)
    .first<MemberRow>();
  if (invited) {
    await database
      .prepare(
        "UPDATE household_members SET user_id = ?, joined_at = ? WHERE id = ? AND user_id IS NULL",
      )
      .bind(user.userId, new Date().toISOString(), invited.id)
      .run();
    return {
      ...invited,
      user_id: user.userId,
      joined_at: new Date().toISOString(),
    };
  }
  const initialOwner = env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  const initialPartner = env.INITIAL_PARTNER_EMAIL?.trim().toLowerCase();
  if (
    initialOwner &&
    initialPartner &&
    initialOwner !== initialPartner &&
    (email === initialOwner || email === initialPartner)
  ) {
    const householdId = "initial-shared-household";
    const stamp = new Date().toISOString();
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO households (id, name, created_at) VALUES (?, ?, ?)",
        )
        .bind(householdId, "Our household", stamp),
      database
        .prepare(
          "INSERT OR IGNORE INTO household_members (id, household_id, user_id, email, role, joined_at) VALUES (?, ?, NULL, ?, 'owner', NULL)",
        )
        .bind("initial-owner-member", householdId, initialOwner),
      database
        .prepare(
          "INSERT OR IGNORE INTO household_members (id, household_id, user_id, email, role, joined_at) VALUES (?, ?, NULL, ?, 'member', NULL)",
        )
        .bind("initial-partner-member", householdId, initialPartner),
      database
        .prepare(
          "INSERT OR IGNORE INTO budget_documents (household_id, version, document, updated_at) VALUES (?, 1, ?, ?)",
        )
        .bind(householdId, JSON.stringify(emptyBudget()), stamp),
    ]);
    const member = await database
      .prepare(
        "SELECT * FROM household_members WHERE household_id = ? AND email = ?",
      )
      .bind(householdId, email)
      .first<MemberRow>();
    if (!member) throw new Error("Initial household member is unavailable");
    if (!member.user_id) {
      await database
        .prepare(
          "UPDATE household_members SET user_id = ?, joined_at = ? WHERE id = ? AND user_id IS NULL",
        )
        .bind(user.userId, stamp, member.id)
        .run();
      return {
        ...member,
        user_id: user.userId,
        joined_at: member.joined_at ?? stamp,
      };
    }
  }

  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const stamp = new Date().toISOString();
  await database.batch([
    database
      .prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)")
      .bind(householdId, "Our household", stamp),
    database
      .prepare(
        "INSERT INTO household_members (id, household_id, user_id, email, role, joined_at) VALUES (?, ?, ?, ?, 'owner', ?)",
      )
      .bind(memberId, householdId, user.userId, email, stamp),
    database
      .prepare(
        "INSERT INTO budget_documents (household_id, version, document, updated_at) VALUES (?, 1, ?, ?)",
      )
      .bind(householdId, JSON.stringify(emptyBudget()), stamp),
  ]);
  return {
    id: memberId,
    household_id: householdId,
    user_id: user.userId,
    email,
    role: "owner",
    joined_at: stamp,
  };
}

async function snapshot(
  member: MemberRow,
  user: { userId: string; email: string; displayName: string },
) {
  const database = db();
  const household = await database
    .prepare("SELECT id, name FROM households WHERE id = ?")
    .bind(member.household_id)
    .first<HouseholdRow>();
  const row = await database
    .prepare(
      "SELECT version, document FROM budget_documents WHERE household_id = ?",
    )
    .bind(member.household_id)
    .first<DocumentRow>();
  const members = await database
    .prepare(
      "SELECT email, role, joined_at FROM household_members WHERE household_id = ? ORDER BY role DESC, email",
    )
    .bind(member.household_id)
    .all<Pick<MemberRow, "email" | "role" | "joined_at">>();
  const households = await database
    .prepare(
      "SELECT h.id, h.name, m.role FROM households h JOIN household_members m ON m.household_id = h.id WHERE m.user_id = ? ORDER BY h.name",
    )
    .bind(user.userId)
    .all<{ id: string; name: string; role: "owner" | "member" }>();
  const invitations = await database
    .prepare(
      "SELECT m.id, h.name AS household_name FROM household_members m JOIN households h ON h.id = m.household_id WHERE m.email = ? AND m.user_id IS NULL ORDER BY h.name",
    )
    .bind(user.email.toLowerCase())
    .all<{ id: string; household_name: string }>();
  if (!household || !row) throw new Error("Household data is unavailable");
  return {
    user: { email: user.email, displayName: user.displayName },
    household: { ...household, role: member.role, members: members.results },
    households: households.results,
    invitations: invitations.results,
    document: JSON.parse(row.document) as BudgetDocument,
    version: row.version,
  };
}

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user) return error("Sign in to open your household", 401);
  try {
    const member = await getMembership(
      user,
      request.headers.get("X-Current-Household"),
    );
    return Response.json(await snapshot(member, user), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    console.error("Budget load failed", cause);
    return error(
      "Your household is temporarily unavailable. Please try again.",
      503,
    );
  }
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return error("Sign in to make changes", 401);
  if (
    cognitoConfig() &&
    request.headers.get("Origin") !== new URL(request.url).origin
  )
    return error("This request must come from Current", 403);
  if (
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return error("Send JSON to update a budget", 415);
  let body: { version?: unknown; action?: Record<string, unknown> };
  try {
    const raw = await request.text();
    if (raw.length > 1_500_000) return error("That file is too large");
    body = JSON.parse(raw);
  } catch {
    return error("Invalid request");
  }
  const action = body.action;
  if (!action || typeof action.type !== "string")
    return error("Choose an action");
  try {
    const member = await getMembership(
      user,
      request.headers.get("X-Current-Household"),
    );
    const database = db();

    if (action.type === "accept_invite") {
      const id = clean(action.id, 60);
      const pending = await database
        .prepare(
          "SELECT * FROM household_members WHERE id = ? AND email = ? AND user_id IS NULL",
        )
        .bind(id, user.email.toLowerCase())
        .first<MemberRow>();
      if (!pending) return error("Invitation is no longer available", 404);
      const stamp = new Date().toISOString();
      const update = await database
        .prepare(
          "UPDATE household_members SET user_id = ?, joined_at = ? WHERE id = ? AND user_id IS NULL",
        )
        .bind(user.userId, stamp, id)
        .run();
      if (!update.meta.changes)
        return error("Invitation was already accepted", 409);
      return Response.json(
        await snapshot(
          { ...pending, user_id: user.userId, joined_at: stamp },
          user,
        ),
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (action.type === "decline_invite") {
      const id = clean(action.id, 60);
      await database
        .prepare(
          "DELETE FROM household_members WHERE id = ? AND email = ? AND user_id IS NULL",
        )
        .bind(id, user.email.toLowerCase())
        .run();
      return Response.json(await snapshot(member, user), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (action.type === "invite_member") {
      if (member.role !== "owner")
        return error("Only the household owner can invite someone", 403);
      const email = clean(action.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === member.email)
        return error("Enter your partner's email address");
      const count = await database
        .prepare(
          "SELECT COUNT(*) AS total FROM household_members WHERE household_id = ?",
        )
        .bind(member.household_id)
        .first<{ total: number }>();
      if ((count?.total ?? 0) >= 2)
        return error("This household already has two members");
      await database
        .prepare(
          "INSERT INTO household_members (id, household_id, user_id, email, role, joined_at) VALUES (?, ?, NULL, ?, 'member', NULL)",
        )
        .bind(crypto.randomUUID(), member.household_id, email)
        .run();
      return Response.json(await snapshot(member, user), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (action.type === "rename_household") {
      if (member.role !== "owner")
        return error("Only the household owner can rename it", 403);
      const name = clean(action.name, 60);
      if (!name) return error("Enter a household name");
      await database
        .prepare("UPDATE households SET name = ? WHERE id = ?")
        .bind(name, member.household_id)
        .run();
      return Response.json(await snapshot(member, user), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const row = await database
      .prepare(
        "SELECT version, document FROM budget_documents WHERE household_id = ?",
      )
      .bind(member.household_id)
      .first<DocumentRow>();
    if (!row) throw new Error("Budget missing");
    if (body.version !== row.version)
      return error(
        "Your partner changed this budget. Reload and try again.",
        409,
      );
    const document = JSON.parse(row.document) as BudgetDocument;
    const today = new Date().toISOString().slice(0, 10);
    let next: BudgetDocument = document;

    switch (action.type) {
      case "add_account": {
        const name = clean(action.name, 60);
        const opening = cents(action.openingBalanceCents, true);
        if (!name || opening === null)
          return error("Enter an account name and starting balance");
        if (document.accounts.length >= 10)
          return error("This preview supports up to ten accounts");
        next = {
          ...document,
          accounts: [
            ...document.accounts,
            { id: crypto.randomUUID(), name, openingBalanceCents: opening },
          ],
        };
        break;
      }
      case "set_cushion": {
        const value = cents(action.cushionCents);
        if (value === null) return error("Enter a valid cushion amount");
        next = { ...document, cushionCents: value };
        break;
      }
      case "set_category_limit": {
        const category = clean(action.category, 30);
        const value = cents(action.limitCents);
        if (!budgetCategories(document).includes(category) || value === null)
          return error("Enter a valid category and amount");
        next = {
          ...document,
          categoryLimits: { ...document.categoryLimits, [category]: value },
        };
        break;
      }
      case "add_category": {
        const category = clean(action.name, 30);
        const allCategories = budgetCategories(document);
        if (!category) return error("Enter a category name");
        if (
          [...allCategories, "Income", "Transfer", "Adjustment"].some(
            (item) => item.toLowerCase() === category.toLowerCase(),
          )
        )
          return error("That category already exists");
        if ((document.customCategories ?? []).length >= 25)
          return error("This household has reached the custom category limit");
        next = {
          ...document,
          customCategories: [...(document.customCategories ?? []), category],
          categoryLimits: { ...document.categoryLimits, [category]: 0 },
        };
        break;
      }
      case "remove_category": {
        const category = clean(action.name, 30);
        if (!(document.customCategories ?? []).includes(category))
          return error("Custom category not found");
        if (
          document.transactions.some(
            (item) => !item.voidedAt && item.category === category,
          )
        )
          return error("Move this category's transactions before removing it");
        const { [category]: _removed, ...remainingLimits } =
          document.categoryLimits;
        next = {
          ...document,
          customCategories: (document.customCategories ?? []).filter(
            (item) => item !== category,
          ),
          categoryLimits: remainingLimits,
        };
        break;
      }
      case "add_transaction": {
        const accountId = clean(action.accountId, 60);
        const name = clean(action.name, 80);
        const date = action.date;
        const amount = cents(action.amountCents);
        const kind = action.kind;
        const category = clean(action.category, 30);
        const status = action.status === "pending" ? "pending" : "cleared";
        if (
          !document.accounts.some((account) => account.id === accountId) ||
          !name ||
          !validDate(date) ||
          amount === null ||
          amount === 0 ||
          !["expense", "income"].includes(String(kind))
        )
          return error("Check the transaction details");
        if (document.transactions.length >= 5000)
          return error(
            "This budget has reached the preview's transaction limit",
          );
        next = {
          ...document,
          transactions: [
            ...document.transactions,
            {
              id: crypto.randomUUID(),
              accountId,
              date,
              amountCents: kind === "income" ? amount : -amount,
              name,
              category:
                kind === "income"
                  ? "Income"
                  : budgetCategories(document).includes(category)
                    ? category
                    : "Other",
              createdBy: user.email,
              createdAt: new Date().toISOString(),
              status,
            },
          ],
        };
        break;
      }
      case "edit_transaction": {
        const id = clean(action.id, 60);
        const target = document.transactions.find(
          (item) => item.id === id && !item.voidedAt,
        );
        const accountId = clean(action.accountId, 60);
        const name = clean(action.name, 80);
        const category = clean(action.category, 30);
        const amount = cents(action.amountCents);
        const kind = String(action.kind);
        const status = action.status === "pending" ? "pending" : "cleared";
        if (
          !target ||
          ["Adjustment", "Transfer"].includes(target.category) ||
          !document.accounts.some((account) => account.id === accountId) ||
          !name ||
          !validDate(action.date) ||
          !amount ||
          !["expense", "income"].includes(kind) ||
          (kind === "expense" && !budgetCategories(document).includes(category))
        )
          return error("Check the transaction details");
        next = {
          ...document,
          transactions: document.transactions.map((item) =>
            item.id === id
              ? {
                  ...item,
                  accountId,
                  name,
                  date: action.date as string,
                  amountCents: kind === "income" ? amount : -amount,
                  category: kind === "income" ? "Income" : category,
                  status,
                }
              : item,
          ),
        };
        break;
      }
      case "split_transaction": {
        const id = clean(action.id, 60);
        const target = document.transactions.find(
          (item) => item.id === id && !item.voidedAt,
        );
        if (
          !target ||
          target.amountCents >= 0 ||
          target.plannedItemId ||
          ["Adjustment", "Transfer"].includes(target.category) ||
          !Array.isArray(action.splits) ||
          action.splits.length < 2 ||
          action.splits.length > 10
        )
          return error("Choose an expense and two to ten split amounts");
        const splits: { category: string; amountCents: number }[] = [];
        for (const raw of action.splits) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw))
            return error("A split is invalid");
          const split = raw as Record<string, unknown>;
          const category = clean(split.category, 30);
          const amountCents = cents(split.amountCents);
          if (!amountCents || !budgetCategories(document).includes(category))
            return error("Each split needs a category and positive amount");
          splits.push({ category, amountCents });
        }
        if (
          splits.reduce((sum, split) => sum + split.amountCents, 0) !==
          Math.abs(target.amountCents)
        )
          return error("Split amounts must equal the original transaction");
        if (document.transactions.length + splits.length > 5000)
          return error("This budget has reached the transaction limit");
        const stamp = new Date().toISOString();
        const splitGroupId = crypto.randomUUID();
        next = {
          ...document,
          transactions: [
            ...document.transactions.map((item) =>
              item.id === id ? { ...item, voidedAt: stamp } : item,
            ),
            ...splits.map((split) => ({
              ...target,
              id: crypto.randomUUID(),
              amountCents: -split.amountCents,
              category: split.category,
              name: `${target.name} · ${split.category}`,
              createdBy: user.email,
              createdAt: stamp,
              splitGroupId,
              voidedAt: undefined,
              importKey: undefined,
            })),
          ],
        };
        break;
      }
      case "void_transaction": {
        const id = clean(action.id, 60);
        const target = document.transactions.find(
          (transaction) =>
            transaction.id === id &&
            !transaction.voidedAt &&
            transaction.category !== "Adjustment",
        );
        if (!target) return error("Transaction not found");
        next = {
          ...document,
          transactions: document.transactions.map((transaction) =>
            transaction.id === id ||
            (target.transferId && transaction.transferId === target.transferId)
              ? { ...transaction, voidedAt: new Date().toISOString() }
              : transaction,
          ),
          plannedItems:
            target.plannedItemId && target.occurrenceDate
              ? document.plannedItems.map((item) =>
                  item.id === target.plannedItemId
                    ? {
                        ...item,
                        settledDates: item.settledDates.filter(
                          (date) => date !== target.occurrenceDate,
                        ),
                      }
                    : item,
                )
              : document.plannedItems,
        };
        break;
      }
      case "set_transaction_status": {
        const id = clean(action.id, 60);
        const status = action.status;
        const target = document.transactions.find(
          (item) => item.id === id && !item.voidedAt,
        );
        if (!target || !["pending", "cleared"].includes(String(status)))
          return error("Transaction or status is invalid");
        if (target.category === "Adjustment")
          return error("Balance adjustments are always cleared");
        next = {
          ...document,
          transactions: document.transactions.map((item) =>
            item.id === id ||
            (target.transferId && item.transferId === target.transferId)
              ? { ...item, status: status as "pending" | "cleared" }
              : item,
          ),
        };
        break;
      }
      case "transfer": {
        const fromAccountId = clean(action.fromAccountId, 60);
        const toAccountId = clean(action.toAccountId, 60);
        const amount = cents(action.amountCents);
        if (
          !amount ||
          !validDate(action.date) ||
          fromAccountId === toAccountId ||
          !document.accounts.some((item) => item.id === fromAccountId) ||
          !document.accounts.some((item) => item.id === toAccountId) ||
          document.transactions.length > 4997
        )
          return error("Check the transfer amount, date, and accounts");
        const transferId = crypto.randomUUID();
        const stamp = new Date().toISOString();
        const status = action.status === "pending" ? "pending" : "cleared";
        const label = clean(action.name, 80) || "Transfer";
        next = {
          ...document,
          transactions: [
            ...document.transactions,
            {
              id: crypto.randomUUID(),
              accountId: fromAccountId,
              date: action.date,
              amountCents: -amount,
              name: label,
              category: "Transfer",
              createdBy: user.email,
              createdAt: stamp,
              transferId,
              status,
            },
            {
              id: crypto.randomUUID(),
              accountId: toAccountId,
              date: action.date,
              amountCents: amount,
              name: label,
              category: "Transfer",
              createdBy: user.email,
              createdAt: stamp,
              transferId,
              status,
            },
          ],
        };
        break;
      }
      case "import_csv": {
        if (!Array.isArray(action.rows) || action.rows.length > 200)
          return error("Import up to 200 rows at a time");
        const knownKeys = new Set(
          document.transactions.map((item) => item.importKey).filter(Boolean),
        );
        const incoming: BudgetDocument["transactions"] = [];
        for (const raw of action.rows) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw))
            return error("A CSV row is invalid");
          const row = raw as Record<string, unknown>;
          const accountId = clean(row.accountId, 60);
          const amount = cents(row.amountCents, true);
          const importKey = clean(row.importKey, 100);
          if (
            !document.accounts.some((item) => item.id === accountId) ||
            !validDate(row.date) ||
            !clean(row.name, 80) ||
            amount === null ||
            amount === 0 ||
            !/^csv:[a-f0-9]{64}:\d+$/.test(importKey)
          )
            return error("A CSV row has an invalid account, date, or amount");
          if (knownKeys.has(importKey)) continue;
          knownKeys.add(importKey);
          const category = clean(row.category, 30);
          incoming.push({
            id: crypto.randomUUID(),
            accountId,
            date: row.date,
            amountCents: amount,
            name: clean(row.name, 80),
            category:
              amount > 0
                ? "Income"
                : budgetCategories(document).includes(category)
                  ? category
                  : "Other",
            status: row.status === "pending" ? "pending" : "cleared",
            importKey,
            createdBy: user.email,
            createdAt: new Date().toISOString(),
          });
        }
        if (!incoming.length)
          return error("These CSV rows were already imported");
        if (document.transactions.length + incoming.length > 5000)
          return error("This budget has reached the transaction limit");
        next = {
          ...document,
          transactions: [...document.transactions, ...incoming],
        };
        break;
      }
      case "add_fund": {
        const name = clean(action.name, 80);
        const targetCents = cents(action.targetCents);
        if (
          !name ||
          !targetCents ||
          (action.targetDate && !validDate(action.targetDate)) ||
          (document.funds ?? []).length >= 100
        )
          return error("Enter a fund name, target, and valid date");
        next = {
          ...document,
          funds: [
            ...(document.funds ?? []),
            {
              id: crypto.randomUUID(),
              name,
              targetCents,
              savedCents: 0,
              ...(action.targetDate
                ? { targetDate: action.targetDate as string }
                : {}),
            },
          ],
        };
        break;
      }
      case "adjust_fund": {
        const id = clean(action.id, 60);
        const amount = cents(action.amountCents, true);
        const fund = (document.funds ?? []).find((item) => item.id === id);
        if (!fund || !amount || fund.savedCents + amount < 0)
          return error("Check the fund amount");
        const reserved = (document.funds ?? []).reduce(
          (sum, item) => sum + item.savedCents,
          0,
        );
        if (
          amount > 0 &&
          reserved + amount > Math.max(0, householdBalance(document))
        )
          return error(
            "You cannot reserve more than the available account balance",
          );
        next = {
          ...document,
          funds: (document.funds ?? []).map((item) =>
            item.id === id
              ? { ...item, savedCents: item.savedCents + amount }
              : item,
          ),
        };
        break;
      }
      case "remove_fund": {
        const id = clean(action.id, 60);
        if (!(document.funds ?? []).some((item) => item.id === id))
          return error("Fund not found");
        next = {
          ...document,
          funds: (document.funds ?? []).filter((item) => item.id !== id),
        };
        break;
      }
      case "add_checkin": {
        const weekStart = action.weekStart;
        const note = clean(action.note, 500);
        if (!validDate(weekStart) || !note)
          return error("Add a note for this week's check-in");
        if (
          (document.checkIns ?? []).some((item) => item.weekStart === weekStart)
        )
          return error("This week already has a check-in");
        next = {
          ...document,
          checkIns: [
            ...(document.checkIns ?? []),
            {
              id: crypto.randomUUID(),
              weekStart,
              createdBy: user.email,
              createdAt: new Date().toISOString(),
              note,
              safeCents: bridgeToPayday(document, today).safeCents,
              acknowledgedBy: [user.email],
            },
          ],
        };
        break;
      }
      case "acknowledge_checkin": {
        const id = clean(action.id, 60);
        const target = (document.checkIns ?? []).find((item) => item.id === id);
        if (!target) return error("Check-in not found");
        next = {
          ...document,
          checkIns: (document.checkIns ?? []).map((item) =>
            item.id === id
              ? {
                  ...item,
                  acknowledgedBy: [
                    ...new Set([...item.acknowledgedBy, user.email]),
                  ],
                }
              : item,
          ),
        };
        break;
      }
      case "add_planned_item": {
        const name = clean(action.name, 80);
        const amount = cents(action.amountCents);
        const kind = action.kind;
        const repeat = action.repeat;
        if (
          !name ||
          amount === null ||
          amount === 0 ||
          !validDate(action.firstDate) ||
          !["bill", "income"].includes(String(kind)) ||
          !["none", "weekly", "biweekly", "monthly"].includes(String(repeat))
        )
          return error("Check the planned item");
        if (document.plannedItems.length >= 200)
          return error("This budget has reached the preview's planning limit");
        next = {
          ...document,
          plannedItems: [
            ...document.plannedItems,
            {
              id: crypto.randomUUID(),
              name,
              amountCents: amount,
              kind: kind as PlannedItem["kind"],
              firstDate: action.firstDate as string,
              repeat: repeat as PlannedItem["repeat"],
              settledDates: [],
            },
          ],
        };
        break;
      }
      case "remove_planned_item": {
        const id = clean(action.id, 60);
        if (!document.plannedItems.some((item) => item.id === id))
          return error("Planned item not found");
        next = {
          ...document,
          plannedItems: document.plannedItems.filter((item) => item.id !== id),
        };
        break;
      }
      case "settle_planned_item": {
        const item = document.plannedItems.find(
          (planned) => planned.id === action.id,
        );
        const accountId = clean(action.accountId, 60);
        const occurrenceDate = action.occurrenceDate;
        if (
          !item ||
          !document.accounts.some((account) => account.id === accountId) ||
          !validDate(occurrenceDate) ||
          item.settledDates.includes(occurrenceDate)
        )
          return error("Planned item is already recorded or unavailable");
        next = {
          ...document,
          plannedItems: document.plannedItems.map((planned) =>
            planned.id === item.id
              ? {
                  ...planned,
                  settledDates: [...planned.settledDates, occurrenceDate],
                }
              : planned,
          ),
          transactions: [
            ...document.transactions,
            {
              id: crypto.randomUUID(),
              accountId,
              date: occurrenceDate,
              amountCents:
                item.kind === "income" ? item.amountCents : -item.amountCents,
              name: item.name,
              category: item.kind === "income" ? "Income" : "Other",
              createdBy: user.email,
              createdAt: new Date().toISOString(),
              plannedItemId: item.id,
              occurrenceDate,
            },
          ],
        };
        break;
      }
      case "reconcile": {
        const accountId = clean(action.accountId, 60);
        const observed = cents(action.observedBalanceCents, true);
        if (
          observed === null ||
          !document.accounts.some((account) => account.id === accountId)
        )
          return error("Enter a valid account balance");
        next = reconcileAccount(
          document,
          accountId,
          observed,
          user.email,
          today,
        );
        if (accountBalance(next, accountId, false) !== observed)
          throw new Error("Reconciliation did not balance");
        break;
      }
      case "import_preview": {
        if (
          document.accounts.length !== 1 ||
          document.accounts[0].openingBalanceCents !== 0 ||
          document.transactions.length ||
          document.plannedItems.length ||
          document.reconciliations.length
        )
          return error(
            "Import is available only before you enter new household data",
          );
        const preview = action.preview;
        if (!preview || typeof preview !== "object" || Array.isArray(preview))
          return error("Preview data is invalid");
        const prior = preview as Record<string, unknown>;
        const balance =
          typeof prior.balance === "number"
            ? cents(Math.round(prior.balance * 100), true)
            : null;
        const buffer =
          typeof prior.buffer === "number"
            ? cents(Math.round(prior.buffer * 100))
            : null;
        if (
          balance === null ||
          buffer === null ||
          !Array.isArray(prior.items) ||
          !Array.isArray(prior.transactions) ||
          prior.items.length > 200 ||
          prior.transactions.length > 5000
        )
          return error("Preview data is incomplete or too large");
        const accountId = document.accounts[0].id;
        const importedTransactions: BudgetDocument["transactions"] = [];
        for (const raw of prior.transactions) {
          if (!raw || typeof raw !== "object")
            return error("Preview transaction is invalid");
          const item = raw as Record<string, unknown>;
          const amount =
            typeof item.amount === "number"
              ? cents(Math.round(item.amount * 100))
              : null;
          if (!clean(item.name) || !validDate(item.date) || amount === null)
            return error("Preview transaction is invalid");
          importedTransactions.push({
            id: crypto.randomUUID(),
            accountId,
            date: item.date,
            amountCents: -amount,
            name: clean(item.name),
            category: categories.includes(
              item.category as (typeof categories)[number],
            )
              ? String(item.category)
              : "Other",
            createdBy: user.email,
            createdAt: new Date().toISOString(),
          });
        }
        const importedPlanned: BudgetDocument["plannedItems"] = [];
        for (const raw of prior.items) {
          if (!raw || typeof raw !== "object")
            return error("Preview planned item is invalid");
          const item = raw as Record<string, unknown>;
          const amount =
            typeof item.amount === "number"
              ? cents(Math.round(item.amount * 100))
              : null;
          if (
            !clean(item.name) ||
            !validDate(item.date) ||
            amount === null ||
            !["bill", "income"].includes(String(item.type))
          )
            return error("Preview planned item is invalid");
          importedPlanned.push({
            id: crypto.randomUUID(),
            name: clean(item.name),
            amountCents: amount,
            kind: item.type as PlannedItem["kind"],
            firstDate: item.date,
            repeat: ["weekly", "biweekly", "monthly"].includes(
              String(item.repeat),
            )
              ? (item.repeat as PlannedItem["repeat"])
              : "none",
            settledDates: [],
          });
        }
        const priorBudgets =
          prior.budgets &&
          typeof prior.budgets === "object" &&
          !Array.isArray(prior.budgets)
            ? (prior.budgets as Record<string, unknown>)
            : {};
        const limits = Object.fromEntries(
          categories.map((category) => [
            category,
            typeof priorBudgets[category] === "number"
              ? (cents(Math.round(Number(priorBudgets[category]) * 100)) ?? 0)
              : 0,
          ]),
        );
        const signedSum = importedTransactions.reduce(
          (sum, transaction) => sum + transaction.amountCents,
          0,
        );
        next = {
          ...document,
          accounts: [
            {
              ...document.accounts[0],
              openingBalanceCents: balance - signedSum,
            },
          ],
          transactions: importedTransactions,
          plannedItems: importedPlanned,
          categoryLimits: limits,
          cushionCents: buffer,
        };
        if (accountBalance(next, accountId) !== balance)
          throw new Error("Imported balance did not match");
        break;
      }
      case "restore_backup": {
        if (
          document.accounts.length !== 1 ||
          document.accounts[0].openingBalanceCents !== 0 ||
          document.transactions.length ||
          document.plannedItems.length ||
          document.reconciliations.length
        )
          return error(
            "Restore is available only before you enter new household data",
          );
        if (!validBackup(action.backup)) return error("Backup data is invalid");
        next = action.backup;
        break;
      }
      default:
        return error("Unknown action");
    }

    const update = await database
      .prepare(
        "UPDATE budget_documents SET version = version + 1, document = ?, updated_at = ? WHERE household_id = ? AND version = ?",
      )
      .bind(
        JSON.stringify(next),
        new Date().toISOString(),
        member.household_id,
        row.version,
      )
      .run();
    if (!update.meta.changes)
      return error(
        "Your partner changed this budget. Reload and try again.",
        409,
      );
    return Response.json(await snapshot(member, user), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    console.error("Budget update failed", cause);
    return error("We couldn't save that change. Please try again.", 503);
  }
}
