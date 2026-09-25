"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeftRight,
  Bell,
  CalendarCheck,
  Landmark,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addDays,
  bridgeToPayday,
  householdBalance,
  plannedOccurrences,
  reservedBalance,
  type BudgetDocument,
} from "@/lib/budget";

type Action = Record<string, unknown> & { type: string };
type Mutate = (action: Action, success?: string) => Promise<boolean>;
type CsvRow = {
  accountId: string;
  date: string;
  name: string;
  amountCents: number;
  category: string;
  status: "pending" | "cleared";
  importKey: string;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const cents = (value: string) => Math.round(Number(value) * 100);
const shortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted field");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match
    ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`
    : null;
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  const negative = /^\(.*\)$/.test(trimmed);
  const normalized = trimmed.replace(/[,$()\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Math.round(Number(normalized) * 100) * (negative ? -1 : 1);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function ActivityTools({
  document,
  today,
  busy,
  mutate,
}: {
  document: BudgetDocument;
  today: string;
  busy: boolean;
  mutate: Mutate;
}) {
  const [transfer, setTransfer] = useState({
    fromAccountId: document.accounts[0]?.id ?? "",
    toAccountId: document.accounts[1]?.id ?? "",
    amount: "",
    date: today,
    name: "Transfer",
    status: "cleared",
  });
  const [csv, setCsv] = useState<{ name: string; rows: CsvRow[] } | null>(null);
  const [csvError, setCsvError] = useState("");
  const [csvAccountId, setCsvAccountId] = useState(
    document.accounts[0]?.id ?? "",
  );
  const [expensePositive, setExpensePositive] = useState(false);

  async function prepareCsv(file: File) {
    setCsvError("");
    setCsv(null);
    try {
      if (file.size > 1_000_000) throw new Error("Choose a CSV under 1 MB");
      const bytes = await file.arrayBuffer();
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const grid = parseCsv(
        new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""),
      );
      if (grid.length < 2 || grid.length > 201)
        throw new Error("Choose a CSV with 1 to 200 transactions");
      const headings = grid[0].map((value) =>
        value
          .trim()
          .toLowerCase()
          .replace(/[^a-z]/g, ""),
      );
      const column = (...names: string[]) =>
        headings.findIndex((value) => names.includes(value));
      const dateColumn = column("date", "transactiondate", "posteddate");
      const nameColumn = column(
        "description",
        "name",
        "merchant",
        "memo",
        "payee",
      );
      const amountColumn = column("amount", "transactionamount");
      const debitColumn = column("debit", "withdrawal", "withdrawals");
      const creditColumn = column("credit", "deposit", "deposits");
      const categoryColumn = column("category");
      const statusColumn = column("status");
      if (
        dateColumn < 0 ||
        nameColumn < 0 ||
        (amountColumn < 0 && (debitColumn < 0 || creditColumn < 0))
      )
        throw new Error(
          "CSV needs Date, Description, and Amount columns, or separate Debit and Credit columns",
        );
      const rows: CsvRow[] = [];
      for (let index = 1; index < grid.length; index++) {
        const source = grid[index];
        const date = parseDate(source[dateColumn] ?? "");
        const name = (source[nameColumn] ?? "").trim().slice(0, 80);
        const amount =
          amountColumn >= 0
            ? parseAmount(source[amountColumn] ?? "")
            : (parseAmount(source[creditColumn] || "0") ?? 0) -
              (parseAmount(source[debitColumn] || "0") ?? 0);
        if (
          !date ||
          Number.isNaN(Date.parse(`${date}T12:00:00Z`)) ||
          new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date ||
          !name ||
          amount === null ||
          amount === 0
        )
          throw new Error(
            `Check date, description, and amount on CSV row ${index + 1}`,
          );
        rows.push({
          accountId: csvAccountId,
          date,
          name,
          amountCents: amountColumn >= 0 && expensePositive ? -amount : amount,
          category: (source[categoryColumn] ?? "Other").trim(),
          status:
            (source[statusColumn] ?? "").trim().toLowerCase() === "pending"
              ? "pending"
              : "cleared",
          importKey: `csv:${hash}:${index}`,
        });
      }
      setCsv({ name: file.name, rows });
    } catch (cause) {
      setCsvError(
        cause instanceof Error ? cause.message : "Could not read CSV",
      );
    }
  }

  return (
    <div className="content-grid activity-grid extra-grid">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Move money between accounts</h2>
            <p>
              A transfer creates two linked entries and leaves the household
              total unchanged.
            </p>
          </div>
          <ArrowLeftRight size={18} />
        </div>
        <form
          className="form-stack"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            if (
              await mutate(
                {
                  type: "transfer",
                  ...transfer,
                  amountCents: cents(transfer.amount),
                },
                "Transfer recorded",
              )
            )
              setTransfer((prior) => ({ ...prior, amount: "" }));
          }}
        >
          <div className="form-two">
            <label>
              From
              <select
                value={transfer.fromAccountId}
                onChange={(event) =>
                  setTransfer({
                    ...transfer,
                    fromAccountId: event.target.value,
                  })
                }
              >
                {document.accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To
              <select
                value={transfer.toAccountId}
                onChange={(event) =>
                  setTransfer({ ...transfer, toAccountId: event.target.value })
                }
              >
                {document.accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-two">
            <label>
              Amount
              <Input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={transfer.amount}
                onChange={(event) =>
                  setTransfer({ ...transfer, amount: event.target.value })
                }
              />
            </label>
            <label>
              Date
              <Input
                required
                type="date"
                value={transfer.date}
                onChange={(event) =>
                  setTransfer({ ...transfer, date: event.target.value })
                }
              />
            </label>
          </div>
          <label>
            Status
            <select
              value={transfer.status}
              onChange={(event) =>
                setTransfer({ ...transfer, status: event.target.value })
              }
            >
              <option value="cleared">Cleared</option>
              <option value="pending">Pending</option>
            </select>
          </label>
          <Button disabled={busy || document.accounts.length < 2}>
            Record transfer
          </Button>
          {document.accounts.length < 2 && (
            <p className="fine-print">
              Add a second account to move money between accounts.
            </p>
          )}
        </form>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Import bank CSV</h2>
            <p>
              Review entries before adding them. Reimporting the same file skips
              its existing rows.
            </p>
          </div>
          <Landmark size={18} />
        </div>
        <div className="form-stack">
          <label>
            Import into
            <select
              value={csvAccountId}
              onChange={(event) => setCsvAccountId(event.target.value)}
            >
              {document.accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-choice">
            <input
              type="checkbox"
              checked={expensePositive}
              onChange={(event) => {
                setExpensePositive(event.target.checked);
                setCsv(null);
              }}
            />{" "}
            My bank shows spending as positive amounts
          </label>
          <label>
            CSV file
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void prepareCsv(file);
                event.target.value = "";
              }}
            />
          </label>
          {csvError && (
            <p className="inline-error" role="alert">
              {csvError}
            </p>
          )}
          {csv && (
            <div className="csv-preview">
              <strong>
                {csv.rows.length} entries from {csv.name}
              </strong>
              <span>
                Net change:{" "}
                {money(csv.rows.reduce((sum, row) => sum + row.amountCents, 0))}
              </span>
              {csv.rows.slice(0, 4).map((row) => (
                <div key={row.importKey}>
                  <span>
                    {shortDate(row.date)} · {row.name}
                  </span>
                  <strong>{money(row.amountCents)}</strong>
                </div>
              ))}
              <Button
                disabled={busy}
                onClick={async () => {
                  const ok = await mutate(
                    {
                      type: "import_csv",
                      rows: csv.rows.map((row) => ({
                        ...row,
                        accountId: csvAccountId,
                      })),
                    },
                    "CSV transactions imported",
                  );
                  if (ok) setCsv(null);
                }}
              >
                Import reviewed entries
              </Button>
            </div>
          )}
          <p className="fine-print">
            Accepted dates: YYYY-MM-DD or MM/DD/YYYY. Use signed Amount, or
            Debit and Credit columns. Check the preview against your bank before
            importing.
          </p>
        </div>
      </section>
    </div>
  );
}

export function BridgeInsights({
  document,
  today,
}: {
  document: BudgetDocument;
  today: string;
}) {
  const bridge = bridgeToPayday(document, today);
  const [mode, setMode] = useState<"income" | "delay">("income");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [billKey, setBillKey] = useState("");
  const [revisedDate, setRevisedDate] = useState(addDays(today, 7));
  const bills = bridge.occurrences.filter((item) => item.kind === "bill");
  const selectedBill =
    bills.find((item) => `${item.id}|${item.date}` === billKey) ?? bills[0];
  const simulated = useMemo(() => {
    if (mode === "income") {
      const value = cents(amount);
      if (
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        !date ||
        date < today ||
        date > addDays(today, 30)
      )
        return null;
      return bridgeToPayday(
        {
          ...document,
          plannedItems: [
            ...document.plannedItems,
            {
              id: "rescue-income",
              name: "Possible extra income",
              amountCents: value,
              kind: "income",
              firstDate: date,
              repeat: "none",
              settledDates: [],
            },
          ],
        },
        today,
      );
    }
    if (!selectedBill || revisedDate <= selectedBill.date) return null;
    return bridgeToPayday(
      {
        ...document,
        plannedItems: [
          ...document.plannedItems.map((item) =>
            item.id === selectedBill.id
              ? {
                  ...item,
                  settledDates: [...item.settledDates, selectedBill.date],
                }
              : item,
          ),
          {
            id: "rescue-deferred-bill",
            name: selectedBill.name,
            amountCents: selectedBill.amountCents,
            kind: "bill",
            firstDate: revisedDate,
            repeat: "none",
            settledDates: [],
          },
        ],
      },
      today,
    );
  }, [amount, date, document, mode, revisedDate, selectedBill, today]);
  const lowEvent = bridge.occurrences.find(
    (item) => item.date === bridge.lowDate && item.kind === "bill",
  );
  const cushionGap = document.cushionCents - bridge.lowCents;
  const spendingGap = Math.max(0, -bridge.safeCents);
  const needsAttention = cushionGap > 0 || spendingGap > 0;
  const originalCutoff = bridge.paydayDate ?? addDays(today, 30);
  const simulatedSafe = simulated
    ? mode === "income"
      ? bridge.safeCents + (date <= originalCutoff ? cents(amount) : 0)
      : bridge.safeCents +
        (selectedBill &&
        selectedBill.date <= originalCutoff &&
        revisedDate > originalCutoff
          ? selectedBill.amountCents
          : 0)
    : null;

  return (
    <div className="content-grid extra-grid">
      <section
        className={`panel insight-panel ${needsAttention ? "insight-alert" : ""}`}
      >
        <div className="panel-head">
          <div>
            <h2>
              {needsAttention
                ? "A tight spot ahead"
                : "Your forecast is above the cushion"}
            </h2>
            <p>
              Based on cleared and pending entries, planned bills, and income.
            </p>
          </div>
          <Bell size={18} />
        </div>
        {cushionGap > 0 ? (
          <>
            <p className="insight-value">
              {money(cushionGap)} below your cushion on{" "}
              {shortDate(bridge.lowDate)}
            </p>
            <p className="fine-print">
              {lowEvent
                ? `${lowEvent.name} is due that day. `
                : "Several planned items lead to this point. "}
              The lowest projected account total is {money(bridge.lowCents)}.
              Check pending charges and bill dates before relying on this
              forecast.
            </p>
          </>
        ) : spendingGap > 0 ? (
          <>
            <p className="insight-value">
              {money(spendingGap)} short after bills, cushion, and reserved
              funds
            </p>
            <p className="fine-print">
              The projected account balance stays above your cushion, but the
              money already assigned to bills and goals leaves no room for new
              spending before payday.
            </p>
          </>
        ) : (
          <p className="insight-value">
            Lowest projected balance: {money(bridge.lowCents)} on{" "}
            {shortDate(bridge.lowDate)}
          </p>
        )}
        {bridge.reservedCents > 0 && (
          <p className="fine-print">
            {money(bridge.reservedCents)} is reserved in sinking funds and
            excluded from safe to spend.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Payday rescue planner</h2>
            <p>Test a change before making a real commitment.</p>
          </div>
          <CalendarCheck size={18} />
        </div>
        <div className="form-stack">
          <label>
            What if…
            <select
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as "income" | "delay")
              }
            >
              <option value="income">Extra income arrives</option>
              <option value="delay">A bill moves later</option>
            </select>
          </label>
          {mode === "income" ? (
            <div className="form-two">
              <label>
                Amount
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label>
                Arrival date
                <Input
                  type="date"
                  min={today}
                  max={addDays(today, 30)}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <>
              <label>
                Bill
                <select
                  value={
                    billKey ||
                    (selectedBill
                      ? `${selectedBill.id}|${selectedBill.date}`
                      : "")
                  }
                  onChange={(event) => setBillKey(event.target.value)}
                >
                  {bills.map((item) => (
                    <option
                      key={`${item.id}|${item.date}`}
                      value={`${item.id}|${item.date}`}
                    >
                      {item.name} · {shortDate(item.date)} ·{" "}
                      {money(item.amountCents)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Revised date
                <Input
                  type="date"
                  min={selectedBill ? addDays(selectedBill.date, 1) : today}
                  value={revisedDate}
                  onChange={(event) => setRevisedDate(event.target.value)}
                />
              </label>
            </>
          )}
          {simulated ? (
            <div
              className={`scenario-answer ${simulated.lowCents < document.cushionCents ? "warning" : "good"}`}
            >
              <strong>Lowest balance: {money(simulated.lowCents)}</strong>
              <span>
                {money(simulated.lowCents - bridge.lowCents)} change to the low
                point · {money(simulatedSafe ?? bridge.safeCents)} safe to spend
                until the original payday
              </span>
            </div>
          ) : (
            <div className="scenario-placeholder">
              {mode === "delay" && !bills.length
                ? "Add a planned bill to test a new date."
                : "Choose a valid amount or later date to compare."}
            </div>
          )}
          <p className="fine-print">
            This is a scenario only. A bill date changes only when you arrange
            it with the biller and update your plan.
          </p>
        </div>
      </section>
    </div>
  );
}

export function FundsView({
  document,
  today,
  busy,
  mutate,
}: {
  document: BudgetDocument;
  today: string;
  busy: boolean;
  mutate: Mutate;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const funds = document.funds ?? [];
  const reserved = reservedBalance(document);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="kicker">PLAN FOR THE NOT-MONTHLY</div>
          <h1>Sinking funds</h1>
          <p>Set aside part of your actual account balance for future costs.</p>
        </div>
        <div className="heading-number">
          {money(reserved)} <span>reserved</span>
        </div>
      </div>
      <div className="content-grid extra-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Create a fund</h2>
              <p>Car repairs, holidays, annual insurance, or anything else.</p>
            </div>
            <Plus size={18} />
          </div>
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await mutate(
                  {
                    type: "add_fund",
                    name,
                    targetCents: cents(target),
                    targetDate: targetDate || undefined,
                  },
                  "Fund created",
                )
              ) {
                setName("");
                setTarget("");
                setTargetDate("");
              }
            }}
          >
            <label>
              Name
              <Input
                required
                maxLength={80}
                placeholder="Car repairs"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="form-two">
              <label>
                Target amount
                <Input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </label>
              <label>
                Target date (optional)
                <Input
                  type="date"
                  min={today}
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                />
              </label>
            </div>
            <Button disabled={busy}>Create fund</Button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>How reserved money works</h2>
              <p>The money stays in your account.</p>
            </div>
            <Landmark size={18} />
          </div>
          <div className="fund-summary">
            <div>
              <span>Account total</span>
              <strong>{money(householdBalance(document))}</strong>
            </div>
            <div>
              <span>Reserved for funds</span>
              <strong>{money(reserved)}</strong>
            </div>
            <div>
              <span>Not reserved</span>
              <strong>{money(householdBalance(document) - reserved)}</strong>
            </div>
          </div>
          <p className="fine-print">
            A contribution changes your plan, not your bank balance. Record a
            real transfer separately if you move cash to another account.
          </p>
        </section>
      </div>
      <section className="panel list-panel">
        <div className="panel-head">
          <div>
            <h2>Your funds</h2>
            <p>Contribute or release money as plans change.</p>
          </div>
        </div>
        {funds.length ? (
          funds.map((fund) => (
            <div className="fund-row" key={fund.id}>
              <div className="fund-row-top">
                <div>
                  <strong>{fund.name}</strong>
                  <small>
                    {fund.targetDate
                      ? `Target ${shortDate(fund.targetDate)}`
                      : "No target date"}
                  </small>
                </div>
                <strong>
                  {money(fund.savedCents)}{" "}
                  <span>of {money(fund.targetCents)}</span>
                </strong>
              </div>
              <div className="category-bar">
                <span
                  style={{
                    width: `${Math.min(100, fund.targetCents ? (fund.savedCents / fund.targetCents) * 100 : 0)}%`,
                  }}
                />
              </div>
              <div className="fund-actions">
                <Input
                  aria-label={`Amount for ${fund.name}`}
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={amounts[fund.id] ?? ""}
                  onChange={(event) =>
                    setAmounts({ ...amounts, [fund.id]: event.target.value })
                  }
                />
                <button
                  disabled={busy || !amounts[fund.id]}
                  onClick={async () => {
                    if (
                      await mutate(
                        {
                          type: "adjust_fund",
                          id: fund.id,
                          amountCents: cents(amounts[fund.id]),
                        },
                        "Money reserved",
                      )
                    )
                      setAmounts({ ...amounts, [fund.id]: "" });
                  }}
                >
                  Contribute
                </button>
                <button
                  disabled={busy || !amounts[fund.id]}
                  onClick={async () => {
                    if (
                      await mutate(
                        {
                          type: "adjust_fund",
                          id: fund.id,
                          amountCents: -cents(amounts[fund.id]),
                        },
                        "Money released",
                      )
                    )
                      setAmounts({ ...amounts, [fund.id]: "" });
                  }}
                >
                  Release
                </button>
                <button
                  className="quiet-remove"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${fund.name}? Reserved money will become available to spend.`,
                      )
                    )
                      void mutate(
                        { type: "remove_fund", id: fund.id },
                        "Fund removed",
                      );
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-line">No funds yet. Create one above.</div>
        )}
      </section>
    </>
  );
}

function monday(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  return addDays(date, -offset);
}

export function CheckInView({
  document,
  today,
  userEmail,
  members,
  busy,
  mutate,
}: {
  document: BudgetDocument;
  today: string;
  userEmail: string;
  members: { email: string; joined_at: string | null }[];
  busy: boolean;
  mutate: Mutate;
}) {
  const [note, setNote] = useState("");
  const weekStart = monday(today);
  const checkIns = [...(document.checkIns ?? [])].sort((a, b) =>
    b.weekStart.localeCompare(a.weekStart),
  );
  const current = checkIns.find((item) => item.weekStart === weekStart);
  const previous = checkIns.find((item) => item.weekStart < weekStart);
  const since = previous?.createdAt ?? `${weekStart}T00:00:00Z`;
  const newEntries = document.transactions.filter(
    (item) =>
      !item.voidedAt &&
      item.createdAt > since &&
      item.category !== "Transfer" &&
      item.category !== "Adjustment",
  );
  const spending = newEntries
    .filter((item) => item.amountCents < 0)
    .reduce((sum, item) => sum - item.amountCents, 0);
  const bridge = bridgeToPayday(document, today);
  const nextWeek = plannedOccurrences(document, today, addDays(today, 7));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="kicker">LOOK AT THE SAME NUMBERS</div>
          <h1>Weekly check-in</h1>
          <p>A short money conversation with a shared record.</p>
        </div>
        <div className="heading-date">Week of {shortDate(weekStart)}</div>
      </div>
      <div className="three-metrics">
        <div>
          <span>New spending since last check-in</span>
          <strong>{money(spending)}</strong>
        </div>
        <div>
          <span>Safe to spend now</span>
          <strong>{money(bridge.safeCents)}</strong>
        </div>
        <div>
          <span>Next 7 days</span>
          <strong>{nextWeek.length} planned items</strong>
        </div>
      </div>
      <div className="content-grid extra-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>This week’s conversation</h2>
              <p>
                {current
                  ? `Started by ${current.createdBy}`
                  : "Write down one decision or question for your partner."}
              </p>
            </div>
            <CalendarCheck size={18} />
          </div>
          {current ? (
            <>
              <blockquote className="checkin-note">{current.note}</blockquote>
              <div className="checkin-status">
                {members.map((member) => (
                  <span key={member.email}>
                    {current.acknowledgedBy.includes(member.email) ? "✓" : "○"}{" "}
                    {member.email.split("@")[0]}
                  </span>
                ))}
              </div>
              {!current.acknowledgedBy.includes(userEmail) && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    mutate(
                      { type: "acknowledge_checkin", id: current.id },
                      "Check-in acknowledged",
                    )
                  }
                >
                  I’ve reviewed this
                </Button>
              )}
            </>
          ) : (
            <form
              className="form-stack"
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  await mutate(
                    { type: "add_checkin", weekStart, note },
                    "Weekly check-in started",
                  )
                )
                  setNote("");
              }}
            >
              <label>
                What should you both know?
                <textarea
                  required
                  maxLength={500}
                  rows={5}
                  placeholder="We need to leave room for rent and revisit the car repair fund…"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <Button disabled={busy}>Start check-in</Button>
            </form>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>What changed</h2>
              <p>
                {previous
                  ? `Since the ${shortDate(previous.weekStart)} check-in.`
                  : "Recent entries and upcoming commitments."}
              </p>
            </div>
            <ArrowLeftRight size={18} />
          </div>
          {previous && (
            <p className="insight-value">
              {money(bridge.safeCents - previous.safeCents)} change in safe to
              spend
            </p>
          )}
          {newEntries
            .slice(-5)
            .reverse()
            .map((item) => (
              <div className="mini-entry" key={item.id}>
                <span>{item.name}</span>
                <strong>{money(item.amountCents)}</strong>
              </div>
            ))}
          {!newEntries.length && (
            <div className="empty-line">
              No new spending or income entries in this period.
            </div>
          )}
          <h3>Coming up this week</h3>
          {nextWeek.slice(0, 5).map((item) => (
            <div className="mini-entry" key={`${item.id}-${item.date}`}>
              <span>
                {shortDate(item.date)} · {item.name}
              </span>
              <strong>
                {item.kind === "bill" ? "−" : "+"}
                {money(item.amountCents)}
              </strong>
            </div>
          ))}
          {!nextWeek.length && (
            <div className="empty-line">No planned items this week.</div>
          )}
        </section>
      </div>
      {checkIns.length > 0 && (
        <section className="panel list-panel">
          <div className="panel-head">
            <div>
              <h2>Earlier check-ins</h2>
            </div>
          </div>
          {checkIns.slice(0, 8).map((item) => (
            <div className="ledger-row" key={item.id}>
              <div className="row-name">
                <strong>Week of {shortDate(item.weekStart)}</strong>
                <small>{item.note}</small>
              </div>
              <strong>{money(item.safeCents)} safe then</strong>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
