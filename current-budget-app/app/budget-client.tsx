"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Users,
  Wallet,
  PiggyBank,
  CalendarCheck,
  Pencil,
  Scissors,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  ActivityTools,
  BridgeInsights,
  CheckInView,
  FundsView,
} from "./budget-extras";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  accountBalance,
  addDays,
  bridgeToPayday,
  budgetCategories,
  categories,
  householdBalance,
  plannedOccurrences,
  type BudgetDocument,
  type Occurrence,
} from "@/lib/budget";

type Snapshot = {
  user: { email: string; displayName: string };
  household: {
    id: string;
    name: string;
    role: "owner" | "member";
    members: { email: string; role: string; joined_at: string | null }[];
  };
  households: { id: string; name: string; role: "owner" | "member" }[];
  invitations: { id: string; household_name: string }[];
  document: BudgetDocument;
  version: number;
};
type View = "bridge" | "activity" | "plan" | "funds" | "checkin" | "accounts";
type Action = Record<string, unknown> & { type: string };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
const shortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const fullDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
const asCents = (value: string) => Math.round(Number(value) * 100);
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const repeatLabel: Record<string, string> = {
  none: "One time",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

export default function BudgetClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>("bridge");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [today] = useState(localDate);
  const [transaction, setTransaction] = useState({
    name: "",
    amount: "",
    date: localDate(),
    kind: "expense",
    category: "Groceries",
    accountId: "",
    status: "cleared",
  });
  const [planned, setPlanned] = useState({
    name: "",
    amount: "",
    firstDate: localDate(),
    kind: "bill",
    repeat: "monthly",
  });
  const [scenario, setScenario] = useState({ amount: "", date: localDate() });
  const [accountName, setAccountName] = useState("");
  const [accountOpening, setAccountOpening] = useState("");
  const [reconcileAccountId, setReconcileAccountId] = useState("");
  const [observedBalance, setObservedBalance] = useState("");
  const [cushion, setCushion] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [settleAccountId, setSettleAccountId] = useState("");
  const [legacyPreview, setLegacyPreview] = useState<string | null>(null);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityCategory, setActivityCategory] = useState("all");
  const [activityAccount, setActivityAccount] = useState("all");
  const [activityStatus, setActivityStatus] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "",
    amount: "",
    date: localDate(),
    kind: "expense",
    category: "Groceries",
    accountId: "",
    status: "cleared",
  });
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [splitDrafts, setSplitDrafts] = useState([
    { category: "Groceries", amount: "" },
    { category: "Other", amount: "" },
  ]);
  const [newCategory, setNewCategory] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/budget", {
        cache: "no-store",
        headers: {
          "X-Current-Household":
            localStorage.getItem("current-household-id") ?? "",
        },
      });
      const value = (await response.json()) as Snapshot & { error?: string };
      if (response.status === 401) {
        window.location.assign("/auth/refresh?return_to=%2F");
        return;
      }
      if (!response.ok)
        throw new Error(value.error || "Could not load your budget");
      localStorage.setItem("current-household-id", value.household.id);
      setSnapshot(value);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load your budget",
      );
    }
  }, []);

  useEffect(() => {
    load();
    const preferred = localStorage.getItem("current-theme");
    if (preferred === "dark") setTheme("dark");
    setLegacyPreview(localStorage.getItem("current-budget-v1"));
  }, [load]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("current-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!snapshot) return;
    const first = snapshot.document.accounts[0]?.id ?? "";
    setTransaction((prior) => ({ ...prior, accountId: first }));
    setReconcileAccountId(first);
    setSettleAccountId(first);
    setCushion(String(snapshot.document.cushionCents / 100));
    setHouseholdName(snapshot.household.name);
  }, [snapshot?.household.id]);

  async function mutate(action: Action, success = "Saved") {
    if (!snapshot || busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/budget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Current-Household": snapshot.household.id,
        },
        body: JSON.stringify({ version: snapshot.version, action }),
      });
      const value = (await response.json()) as Snapshot & { error?: string };
      if (response.status === 401) {
        window.location.assign("/auth/refresh?return_to=%2F");
        return false;
      }
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(value.error || "Could not save your change");
      }
      localStorage.setItem("current-household-id", value.household.id);
      setSnapshot(value);
      setNotice(success);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save your change",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  const documentData = snapshot?.document;
  const householdCategories = useMemo(
    () => (documentData ? budgetCategories(documentData) : [...categories]),
    [documentData],
  );
  const bridge = useMemo(
    () => (documentData ? bridgeToPayday(documentData, today) : null),
    [documentData, today],
  );
  const currentBalance = documentData ? householdBalance(documentData) : 0;
  const month = today.slice(0, 7);
  const monthlySpent =
    documentData?.transactions
      .filter(
        (item) =>
          !item.voidedAt &&
          item.date.startsWith(month) &&
          item.amountCents < 0 &&
          item.category !== "Adjustment" &&
          item.category !== "Transfer",
      )
      .reduce((sum, item) => sum - item.amountCents, 0) ?? 0;
  const totalLimit = Object.values(documentData?.categoryLimits ?? {}).reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const upcoming = bridge?.occurrences ?? [];
  const forecast = useMemo(() => {
    if (!documentData) return [];
    let running = currentBalance;
    return upcoming.map((item) => {
      running += item.kind === "income" ? item.amountCents : -item.amountCents;
      return { ...item, balanceCents: running };
    });
  }, [documentData, currentBalance, upcoming]);
  const scenarioResult = useMemo(() => {
    if (
      !bridge ||
      !scenario.amount ||
      !scenario.date ||
      Number(scenario.amount) <= 0
    )
      return null;
    const amount = asCents(scenario.amount);
    if (scenario.date > addDays(today, 30)) return null;
    let low = bridge.currentCents - (scenario.date <= today ? amount : 0),
      lowDate = today;
    for (const item of forecast) {
      const adjusted =
        item.balanceCents - (item.date >= scenario.date ? amount : 0);
      if (adjusted < low) {
        low = adjusted;
        lowDate = item.date;
      }
    }
    const endBalance = forecast.at(-1)?.balanceCents ?? bridge.currentCents;
    if (endBalance - amount < low) {
      low = endBalance - amount;
      lowDate = addDays(today, 30);
    }
    return {
      low,
      lowDate,
      cushionGap: low - (documentData?.cushionCents ?? 0),
    };
  }, [bridge, scenario, forecast, today, documentData]);
  const selectedAccount = documentData?.accounts.find(
    (account) => account.id === reconcileAccountId,
  );
  const ledgerBalance =
    selectedAccount && documentData
      ? accountBalance(documentData, selectedAccount.id, false)
      : 0;
  const reconciliationDelta =
    observedBalance === "" ? null : asCents(observedBalance) - ledgerBalance;
  const filteredTransactions = useMemo(() => {
    if (!documentData) return [];
    const needle = activitySearch.trim().toLowerCase();
    return [...documentData.transactions]
      .filter(
        (item) =>
          !item.voidedAt &&
          (!needle ||
            item.name.toLowerCase().includes(needle) ||
            item.category.toLowerCase().includes(needle)) &&
          (activityCategory === "all" || item.category === activityCategory) &&
          (activityAccount === "all" || item.accountId === activityAccount) &&
          (activityStatus === "all" ||
            (activityStatus === "pending"
              ? item.status === "pending"
              : item.status !== "pending")),
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }, [
    documentData,
    activitySearch,
    activityCategory,
    activityAccount,
    activityStatus,
  ]);

  function navTo(next: View) {
    setView(next);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function switchHousehold(id: string) {
    localStorage.setItem("current-household-id", id);
    setSnapshot(null);
    setView("bridge");
    await load();
  }
  function themeToggle() {
    setTheme(theme === "light" ? "dark" : "light");
  }
  function downloadBackup() {
    if (!snapshot) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "current-budget-v2",
            exportedAt: new Date().toISOString(),
            householdName: snapshot.household.name,
            document: snapshot.document,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `current-budget-${today}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importOldBackup(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      if (
        !window.confirm(
          "Import this backup into the shared household? Check whether it contains sample figures.",
        )
      )
        return;
      if (parsed?.format === "current-budget-v2") {
        await mutate(
          { type: "restore_backup", backup: parsed.document },
          "Backup restored",
        );
      } else if (
        await mutate(
          { type: "import_preview", preview: parsed },
          "Earlier backup imported",
        )
      ) {
        setLegacyPreview(null);
      }
    } catch {
      setError("That backup file could not be read");
    }
  }
  async function addTransaction(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate(
      {
        type: "add_transaction",
        accountId: transaction.accountId,
        name: transaction.name,
        amountCents: asCents(transaction.amount),
        date: transaction.date,
        kind: transaction.kind,
        category: transaction.category,
        status: transaction.status,
      },
      "Transaction recorded",
    );
    if (ok) setTransaction((prior) => ({ ...prior, name: "", amount: "" }));
  }
  function beginEdit(id: string) {
    const item = documentData?.transactions.find((entry) => entry.id === id);
    if (!item) return;
    setSplittingId(null);
    setEditingId(id);
    setEditDraft({
      name: item.name,
      amount: String(Math.abs(item.amountCents) / 100),
      date: item.date,
      kind: item.amountCents >= 0 ? "income" : "expense",
      category: item.amountCents >= 0 ? householdCategories[0] : item.category,
      accountId: item.accountId,
      status: item.status === "pending" ? "pending" : "cleared",
    });
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    if (
      await mutate(
        {
          type: "edit_transaction",
          id: editingId,
          ...editDraft,
          amountCents: asCents(editDraft.amount),
        },
        "Transaction updated",
      )
    )
      setEditingId(null);
  }
  function beginSplit(id: string) {
    const item = documentData?.transactions.find((entry) => entry.id === id);
    if (!item) return;
    const half = Math.floor(Math.abs(item.amountCents) / 2);
    setEditingId(null);
    setSplittingId(id);
    setSplitDrafts([
      { category: item.category, amount: String(half / 100) },
      {
        category:
          householdCategories.find((name) => name !== item.category) ?? "Other",
        amount: String((Math.abs(item.amountCents) - half) / 100),
      },
    ]);
  }
  async function saveSplit(event: FormEvent) {
    event.preventDefault();
    if (!splittingId) return;
    if (
      await mutate(
        {
          type: "split_transaction",
          id: splittingId,
          splits: splitDrafts.map((split) => ({
            category: split.category,
            amountCents: asCents(split.amount),
          })),
        },
        "Transaction split",
      )
    )
      setSplittingId(null);
  }
  async function addPlanned(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate(
      {
        type: "add_planned_item",
        name: planned.name,
        amountCents: asCents(planned.amount),
        firstDate: planned.firstDate,
        kind: planned.kind,
        repeat: planned.repeat,
      },
      "Added to your plan",
    );
    if (ok) setPlanned((prior) => ({ ...prior, name: "", amount: "" }));
  }

  const nav: { id: View; label: string; icon: typeof Activity }[] = [
    { id: "bridge", label: "Bridge to payday", icon: Wallet },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "plan", label: "Bills & income", icon: CalendarDays },
    { id: "funds", label: "Sinking funds", icon: PiggyBank },
    { id: "checkin", label: "Weekly check-in", icon: CalendarCheck },
    { id: "accounts", label: "Accounts & household", icon: Users },
  ];

  return (
    <div className="app-shell">
      <aside className={`side-rail ${mobileMenu ? "open" : ""}`}>
        <div className="wordmark">
          <span className="brand-sign">∿</span>
          <span>Current</span>
        </div>
        <div className="rail-label">HOUSEHOLD</div>
        <div className="household-chip">
          <span>{snapshot?.household.name ?? "Your budget"}</span>
          <ChevronRight size={16} />
        </div>
        {(snapshot?.households.length ?? 0) > 1 && (
          <label className="household-switcher">
            Switch household
            <select
              value={snapshot?.household.id ?? ""}
              onChange={(event) => void switchHousehold(event.target.value)}
            >
              {snapshot?.households.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <nav aria-label="Main navigation" className="rail-nav">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "selected" : ""}
              onClick={() => navTo(id)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button className="rail-theme" onClick={themeToggle}>
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}{" "}
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
          <div className="rail-account">
            <span className="avatar">
              {snapshot?.user.displayName.slice(0, 1).toUpperCase() ?? "?"}
            </span>
            <span>
              <strong>
                {snapshot?.user.displayName.split("@")[0] ?? "Account"}
              </strong>
              <small>{snapshot?.user.email ?? "Signed in"}</small>
            </span>
          </div>
          <a className="rail-signout" href="/auth/logout">
            Sign out
          </a>
        </div>
      </aside>
      <div className="main-pane">
        <header className="app-header">
          <button
            className="mobile-menu"
            aria-label="Open menu"
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu size={22} />
          </button>
          <div className="header-crumb">
            Current <ChevronRight size={14} />{" "}
            <strong>{nav.find((item) => item.id === view)?.label}</strong>
          </div>
          <div className="header-actions">
            <button className="backup-link" onClick={downloadBackup}>
              Export backup
            </button>
            <span className="private-pill">
              <span /> Private household
            </span>
            <button
              className="header-theme"
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              onClick={themeToggle}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>
        <main className="workspace">
          {!!snapshot?.invitations.length && (
            <div className="invitation-list">
              {snapshot.invitations.map((invite) => (
                <div className="invitation-card" key={invite.id}>
                  <div>
                    <strong>Invitation to {invite.household_name}</strong>
                    <span>
                      Your current household stays available if you join.
                    </span>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        { type: "accept_invite", id: invite.id },
                        "You joined the household",
                      )
                    }
                  >
                    Join
                  </button>
                  <button
                    className="quiet-remove"
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        { type: "decline_invite", id: invite.id },
                        "Invitation declined",
                      )
                    }
                  >
                    Decline
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={load}>Reload</button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={16} /> {notice}
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {!snapshot ? (
            <div className="loading-state">
              <div className="loading-mark">∿</div>
              <h1>Opening your household</h1>
              <p>{error || "Loading your budget…"}</p>
              <Button onClick={load} variant="outline">
                Try again
              </Button>
            </div>
          ) : (
            <>
              {view === "bridge" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="kicker">YOUR MONEY THIS PAY CYCLE</div>
                      <h1>Bridge to payday</h1>
                      <p>Know what clears before the next deposit.</p>
                    </div>
                    <div className="heading-date">
                      {new Date(`${today}T12:00:00`).toLocaleDateString(
                        "en-US",
                        { month: "long", day: "numeric", year: "numeric" },
                      )}
                    </div>
                  </div>
                  <section className="bridge-board" aria-label="Payday outlook">
                    <div className="bridge-main">
                      <span className="bridge-eyebrow">
                        AVAILABLE AFTER BILLS & CUSHION
                      </span>
                      <strong
                        className={
                          bridge!.safeCents < 0 ? "amount-negative" : ""
                        }
                      >
                        {money(bridge!.safeCents)}
                      </strong>
                      <p>
                        {bridge!.paydayDate
                          ? `Until ${fullDate(bridge!.paydayDate)} · ${bridge!.daysToPayday} days`
                          : "No payday scheduled in the next 30 days"}
                      </p>
                      <div className="bridge-meter">
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, currentBalance ? (bridge!.safeCents / currentBalance) * 100 : 0))}%`,
                          }}
                        />
                      </div>
                      <small>
                        Based on your recorded balance and planned bills. New
                        everyday spending will reduce this amount.
                      </small>
                    </div>
                    <div className="bridge-side">
                      <div>
                        <span>DAILY ROOM</span>
                        <strong>{money(bridge!.dailyCents)}</strong>
                        <small>per day until payday</small>
                      </div>
                      <div>
                        <span>LOWEST POINT</span>
                        <strong
                          className={
                            bridge!.lowCents < documentData!.cushionCents
                              ? "amount-negative"
                              : ""
                          }
                        >
                          {money(bridge!.lowCents)}
                        </strong>
                        <small>
                          {shortDate(bridge!.lowDate)} in the 30-day forecast
                        </small>
                      </div>
                    </div>
                  </section>
                  <div className="three-metrics">
                    <div>
                      <span>Current balance</span>
                      <strong>{money(bridge!.currentCents)}</strong>
                    </div>
                    <div>
                      <span>Bills before payday</span>
                      <strong>{money(bridge!.billsBeforePaydayCents)}</strong>
                    </div>
                    <div>
                      <span>Cushion held aside</span>
                      <strong>{money(documentData!.cushionCents)}</strong>
                    </div>
                  </div>
                  <BridgeInsights document={documentData!} today={today} />
                  <div className="content-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>Before payday</h2>
                          <p>Planned moves that affect your balance.</p>
                        </div>
                        <button
                          className="text-action"
                          onClick={() => navTo("plan")}
                        >
                          View plan <ChevronRight size={16} />
                        </button>
                      </div>
                      {upcoming
                        .filter(
                          (item) =>
                            !bridge!.paydayDate ||
                            item.date <= bridge!.paydayDate,
                        )
                        .slice(0, 6).length ? (
                        upcoming
                          .filter(
                            (item) =>
                              !bridge!.paydayDate ||
                              item.date <= bridge!.paydayDate,
                          )
                          .slice(0, 6)
                          .map((item) => (
                            <div
                              className="ledger-row"
                              key={`${item.id}-${item.date}`}
                            >
                              <div className={`item-icon ${item.kind}`}>
                                <span>
                                  {item.kind === "income" ? (
                                    <ArrowDownLeft size={17} />
                                  ) : (
                                    <ArrowUpRight size={17} />
                                  )}
                                </span>
                              </div>
                              <div className="row-name">
                                <strong>{item.name}</strong>
                                <small>
                                  {shortDate(item.date)} ·{" "}
                                  {item.kind === "income"
                                    ? "Expected income"
                                    : "Bill"}
                                </small>
                              </div>
                              <strong
                                className={
                                  item.kind === "income" ? "positive" : ""
                                }
                              >
                                {item.kind === "income" ? "+" : "−"}
                                {money(item.amountCents)}
                              </strong>
                            </div>
                          ))
                      ) : (
                        <div className="empty-line">
                          Add a bill or paycheck to see the bridge.
                        </div>
                      )}
                    </section>
                    <section className="panel scenario-panel">
                      <div className="panel-head">
                        <div>
                          <h2>Can this wait?</h2>
                          <p>Try a purchase against your next 30 days.</p>
                        </div>
                        <CircleHelp size={18} />
                      </div>
                      <div className="scenario-inputs">
                        <label>
                          Amount
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="0.00"
                            value={scenario.amount}
                            onChange={(event) =>
                              setScenario({
                                ...scenario,
                                amount: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Date
                          <Input
                            type="date"
                            value={scenario.date}
                            onChange={(event) =>
                              setScenario({
                                ...scenario,
                                date: event.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                      {scenarioResult ? (
                        <div
                          className={`scenario-answer ${scenarioResult.cushionGap < 0 ? "warning" : "good"}`}
                        >
                          <strong>
                            {scenarioResult.cushionGap < 0
                              ? `${money(-scenarioResult.cushionGap)} below your cushion`
                              : "Your cushion still holds"}
                          </strong>
                          <span>
                            Lowest balance: {money(scenarioResult.low)} around{" "}
                            {shortDate(scenarioResult.lowDate)}.
                          </span>
                        </div>
                      ) : (
                        <div className="scenario-placeholder">
                          Enter an amount to see how it affects your low point.
                        </div>
                      )}
                    </section>
                  </div>
                  <section className="panel forecast-panel">
                    <div className="panel-head">
                      <div>
                        <h2>30-day balance</h2>
                        <p>Projected from planned bills and income.</p>
                      </div>
                      <button
                        className="text-action"
                        onClick={() => navTo("plan")}
                      >
                        Edit planned items <ChevronRight size={16} />
                      </button>
                    </div>
                    <div className="forecast-strip">
                      <div className="forecast-point">
                        <small>Today</small>
                        <strong>{money(currentBalance)}</strong>
                      </div>
                      {forecast.slice(0, 7).map((item) => (
                        <div
                          className="forecast-point"
                          key={`${item.id}-${item.date}`}
                        >
                          <small>{shortDate(item.date)}</small>
                          <strong
                            className={
                              item.balanceCents < documentData!.cushionCents
                                ? "amount-negative"
                                : ""
                            }
                          >
                            {money(item.balanceCents)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
              {view === "activity" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="kicker">MONEY IN & OUT</div>
                      <h1>Activity</h1>
                      <p>Each entry updates your account balance.</p>
                    </div>
                    <div className="heading-number">
                      {money(monthlySpent)} <span>spent this month</span>
                    </div>
                  </div>
                  <div className="content-grid activity-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>Record a transaction</h2>
                          <p>Manual entry for now.</p>
                        </div>
                        <Plus size={18} />
                      </div>
                      <form className="form-stack" onSubmit={addTransaction}>
                        <label>
                          Description
                          <Input
                            required
                            maxLength={80}
                            placeholder="Groceries, paycheck…"
                            value={transaction.name}
                            onChange={(event) =>
                              setTransaction({
                                ...transaction,
                                name: event.target.value,
                              })
                            }
                          />
                        </label>
                        <div className="form-two">
                          <label>
                            Amount
                            <Input
                              required
                              type="number"
                              min="0.01"
                              step="0.01"
                              placeholder="0.00"
                              value={transaction.amount}
                              onChange={(event) =>
                                setTransaction({
                                  ...transaction,
                                  amount: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Date
                            <Input
                              required
                              type="date"
                              value={transaction.date}
                              onChange={(event) =>
                                setTransaction({
                                  ...transaction,
                                  date: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="form-two">
                          <label>
                            Type
                            <select
                              value={transaction.kind}
                              onChange={(event) =>
                                setTransaction({
                                  ...transaction,
                                  kind: event.target.value,
                                })
                              }
                            >
                              <option value="expense">Expense</option>
                              <option value="income">Income</option>
                            </select>
                          </label>
                          <label>
                            Account
                            <select
                              value={transaction.accountId}
                              onChange={(event) =>
                                setTransaction({
                                  ...transaction,
                                  accountId: event.target.value,
                                })
                              }
                            >
                              {documentData!.accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {transaction.kind === "expense" && (
                          <label>
                            Category
                            <select
                              value={transaction.category}
                              onChange={(event) =>
                                setTransaction({
                                  ...transaction,
                                  category: event.target.value,
                                })
                              }
                            >
                              {householdCategories.map((category) => (
                                <option key={category}>{category}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label>
                          Bank status
                          <select
                            value={transaction.status}
                            onChange={(event) =>
                              setTransaction({
                                ...transaction,
                                status: event.target.value,
                              })
                            }
                          >
                            <option value="cleared">Cleared</option>
                            <option value="pending">Pending</option>
                          </select>
                        </label>
                        <Button disabled={busy} className="form-submit">
                          Record transaction
                        </Button>
                      </form>
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>Spending plan</h2>
                          <p>
                            {money(monthlySpent)} of {money(totalLimit)} planned
                            this month.
                          </p>
                        </div>
                      </div>
                      {householdCategories.map((category) => {
                        const amount = documentData!.transactions
                          .filter(
                            (item) =>
                              !item.voidedAt &&
                              item.date.startsWith(month) &&
                              item.category === category &&
                              item.amountCents < 0,
                          )
                          .reduce((sum, item) => sum - item.amountCents, 0);
                        const limit =
                          documentData!.categoryLimits[category] ?? 0;
                        return (
                          <div className="category-row" key={category}>
                            <div>
                              <strong>{category}</strong>
                              <span>
                                {money(amount)} / {money(limit)}
                              </span>
                            </div>
                            <div className="category-bar">
                              <span
                                className={
                                  amount > limit && limit > 0 ? "over" : ""
                                }
                                style={{
                                  width: `${limit ? Math.min(100, (amount / limit) * 100) : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  </div>
                  <ActivityTools
                    document={documentData!}
                    today={today}
                    busy={busy}
                    mutate={mutate}
                  />
                  <section className="panel list-panel">
                    <div className="panel-head">
                      <div>
                        <h2>Transactions</h2>
                        <p>{filteredTransactions.length} matching entries.</p>
                      </div>
                    </div>
                    <div className="transaction-filters">
                      <label className="search-field">
                        <Search size={16} />
                        <Input
                          aria-label="Search transactions"
                          placeholder="Search name or category"
                          value={activitySearch}
                          onChange={(event) =>
                            setActivitySearch(event.target.value)
                          }
                        />
                      </label>
                      <select
                        aria-label="Filter by category"
                        value={activityCategory}
                        onChange={(event) =>
                          setActivityCategory(event.target.value)
                        }
                      >
                        <option value="all">All categories</option>
                        {[
                          ...new Set(
                            documentData!.transactions.map(
                              (item) => item.category,
                            ),
                          ),
                        ]
                          .sort()
                          .map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                      </select>
                      <select
                        aria-label="Filter by account"
                        value={activityAccount}
                        onChange={(event) =>
                          setActivityAccount(event.target.value)
                        }
                      >
                        <option value="all">All accounts</option>
                        {documentData!.accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Filter by bank status"
                        value={activityStatus}
                        onChange={(event) =>
                          setActivityStatus(event.target.value)
                        }
                      >
                        <option value="all">Any status</option>
                        <option value="cleared">Cleared</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>
                    {editingId && (
                      <form className="transaction-editor" onSubmit={saveEdit}>
                        <div className="editor-heading">
                          <strong>Edit transaction</strong>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            aria-label="Close editor"
                          >
                            <X size={17} />
                          </button>
                        </div>
                        <Input
                          required
                          maxLength={80}
                          value={editDraft.name}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              name: event.target.value,
                            })
                          }
                        />
                        <Input
                          required
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={editDraft.amount}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              amount: event.target.value,
                            })
                          }
                        />
                        <Input
                          required
                          type="date"
                          value={editDraft.date}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              date: event.target.value,
                            })
                          }
                        />
                        <select
                          value={editDraft.kind}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              kind: event.target.value,
                            })
                          }
                        >
                          <option value="expense">Expense</option>
                          <option value="income">Income</option>
                        </select>
                        <select
                          value={editDraft.accountId}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              accountId: event.target.value,
                            })
                          }
                        >
                          {documentData!.accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                        {editDraft.kind === "expense" && (
                          <select
                            value={editDraft.category}
                            onChange={(event) =>
                              setEditDraft({
                                ...editDraft,
                                category: event.target.value,
                              })
                            }
                          >
                            {householdCategories.map((category) => (
                              <option key={category}>{category}</option>
                            ))}
                          </select>
                        )}
                        <select
                          value={editDraft.status}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              status: event.target.value,
                            })
                          }
                        >
                          <option value="cleared">Cleared</option>
                          <option value="pending">Pending</option>
                        </select>
                        <Button disabled={busy}>Save changes</Button>
                      </form>
                    )}
                    {splittingId && (
                      <form className="split-editor" onSubmit={saveSplit}>
                        <div className="editor-heading">
                          <div>
                            <strong>Split expense</strong>
                            <small>
                              Amounts must equal the original purchase.
                            </small>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSplittingId(null)}
                            aria-label="Close split"
                          >
                            <X size={17} />
                          </button>
                        </div>
                        {splitDrafts.map((split, index) => (
                          <div className="split-row" key={index}>
                            <select
                              value={split.category}
                              onChange={(event) =>
                                setSplitDrafts((items) =>
                                  items.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          category: event.target.value,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {householdCategories.map((category) => (
                                <option key={category}>{category}</option>
                              ))}
                            </select>
                            <Input
                              required
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={split.amount}
                              onChange={(event) =>
                                setSplitDrafts((items) =>
                                  items.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, amount: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                            {splitDrafts.length > 2 && (
                              <button
                                type="button"
                                className="icon-button"
                                onClick={() =>
                                  setSplitDrafts((items) =>
                                    items.filter(
                                      (_, itemIndex) => itemIndex !== index,
                                    ),
                                  )
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="editor-actions">
                          {splitDrafts.length < 10 && (
                            <button
                              type="button"
                              className="text-action"
                              onClick={() =>
                                setSplitDrafts((items) => [
                                  ...items,
                                  {
                                    category: householdCategories[0],
                                    amount: "",
                                  },
                                ])
                              }
                            >
                              <Plus size={15} /> Add split
                            </button>
                          )}
                          <Button disabled={busy}>Save split</Button>
                        </div>
                      </form>
                    )}
                    {filteredTransactions.length ? (
                      filteredTransactions.slice(0, 100).map((item) => (
                        <div className="ledger-row" key={item.id}>
                          <div
                            className={`item-icon ${item.amountCents >= 0 ? "income" : "bill"}`}
                          >
                            {item.category === "Adjustment" ? (
                              <RefreshCw size={17} />
                            ) : item.amountCents >= 0 ? (
                              <ArrowDownLeft size={17} />
                            ) : (
                              <ArrowUpRight size={17} />
                            )}
                          </div>
                          <div className="row-name">
                            <strong>{item.name}</strong>
                            <small>
                              {shortDate(item.date)} · {item.category} ·{" "}
                              {item.status === "pending" ? "Pending · " : ""}
                              {
                                documentData!.accounts.find(
                                  (account) => account.id === item.accountId,
                                )?.name
                              }
                            </small>
                          </div>
                          <strong
                            className={item.amountCents >= 0 ? "positive" : ""}
                          >
                            {item.amountCents >= 0 ? "+" : "−"}
                            {money(Math.abs(item.amountCents))}
                          </strong>
                          {!["Adjustment", "Transfer"].includes(
                            item.category,
                          ) && (
                            <button
                              className="quiet-remove icon-label"
                              disabled={busy}
                              onClick={() => beginEdit(item.id)}
                            >
                              <Pencil size={14} /> Edit
                            </button>
                          )}
                          {item.amountCents < 0 &&
                            !item.plannedItemId &&
                            !["Adjustment", "Transfer"].includes(
                              item.category,
                            ) && (
                              <button
                                className="quiet-remove icon-label"
                                disabled={busy}
                                onClick={() => beginSplit(item.id)}
                              >
                                <Scissors size={14} /> Split
                              </button>
                            )}
                          {item.category !== "Adjustment" && (
                            <button
                              className="quiet-remove"
                              disabled={busy}
                              onClick={() =>
                                mutate(
                                  {
                                    type: "set_transaction_status",
                                    id: item.id,
                                    status:
                                      item.status === "pending"
                                        ? "cleared"
                                        : "pending",
                                  },
                                  item.status === "pending"
                                    ? "Marked cleared"
                                    : "Marked pending",
                                )
                              }
                            >
                              {item.status === "pending"
                                ? "Clear"
                                : "Mark pending"}
                            </button>
                          )}
                          {item.category !== "Adjustment" && (
                            <button
                              className="quiet-remove"
                              disabled={busy}
                              title="Void transaction"
                              onClick={() =>
                                mutate(
                                  { type: "void_transaction", id: item.id },
                                  "Transaction voided",
                                )
                              }
                            >
                              Void
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="empty-line">
                        No transactions match these filters.
                      </div>
                    )}
                  </section>
                </>
              )}
              {view === "plan" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="kicker">WHAT'S COMING</div>
                      <h1>Bills & income</h1>
                      <p>
                        Plan once, then record each occurrence when it clears.
                      </p>
                    </div>
                  </div>
                  <div className="content-grid plan-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>Add to the plan</h2>
                          <p>Recurring items appear in the forecast.</p>
                        </div>
                        <Plus size={18} />
                      </div>
                      <form className="form-stack" onSubmit={addPlanned}>
                        <label>
                          Name
                          <Input
                            required
                            maxLength={80}
                            placeholder="Rent, salary, electric…"
                            value={planned.name}
                            onChange={(event) =>
                              setPlanned({
                                ...planned,
                                name: event.target.value,
                              })
                            }
                          />
                        </label>
                        <div className="form-two">
                          <label>
                            Amount
                            <Input
                              required
                              type="number"
                              min="0.01"
                              step="0.01"
                              placeholder="0.00"
                              value={planned.amount}
                              onChange={(event) =>
                                setPlanned({
                                  ...planned,
                                  amount: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Next date
                            <Input
                              required
                              type="date"
                              value={planned.firstDate}
                              onChange={(event) =>
                                setPlanned({
                                  ...planned,
                                  firstDate: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="form-two">
                          <label>
                            Type
                            <select
                              value={planned.kind}
                              onChange={(event) =>
                                setPlanned({
                                  ...planned,
                                  kind: event.target.value,
                                })
                              }
                            >
                              <option value="bill">Bill</option>
                              <option value="income">Income</option>
                            </select>
                          </label>
                          <label>
                            Repeats
                            <select
                              value={planned.repeat}
                              onChange={(event) =>
                                setPlanned({
                                  ...planned,
                                  repeat: event.target.value,
                                })
                              }
                            >
                              <option value="none">One time</option>
                              <option value="weekly">Weekly</option>
                              <option value="biweekly">Every 2 weeks</option>
                              <option value="monthly">Monthly</option>
                            </select>
                          </label>
                        </div>
                        <Button disabled={busy} className="form-submit">
                          Add planned item
                        </Button>
                      </form>
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>Next 30 days</h2>
                          <p>Record an item when money actually moves.</p>
                        </div>
                      </div>
                      <div className="settle-account">
                        <label>
                          Record into{" "}
                          <select
                            value={settleAccountId}
                            onChange={(event) =>
                              setSettleAccountId(event.target.value)
                            }
                          >
                            {documentData!.accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {upcoming.slice(0, 15).length ? (
                        upcoming.slice(0, 15).map((item) => (
                          <div
                            className="ledger-row planned-row"
                            key={`${item.id}-${item.date}`}
                          >
                            <div className={`item-icon ${item.kind}`}>
                              {item.kind === "income" ? (
                                <ArrowDownLeft size={17} />
                              ) : (
                                <ArrowUpRight size={17} />
                              )}
                            </div>
                            <div className="row-name">
                              <strong>{item.name}</strong>
                              <small>
                                {shortDate(item.date)} ·{" "}
                                {repeatLabel[item.repeat]}
                              </small>
                            </div>
                            <strong
                              className={
                                item.kind === "income" ? "positive" : ""
                              }
                            >
                              {item.kind === "income" ? "+" : "−"}
                              {money(item.amountCents)}
                            </strong>
                            <button
                              className="record-button"
                              disabled={busy}
                              onClick={() =>
                                mutate(
                                  {
                                    type: "settle_planned_item",
                                    id: item.id,
                                    occurrenceDate: item.date,
                                    accountId: settleAccountId,
                                  },
                                  item.kind === "income"
                                    ? "Income recorded"
                                    : "Bill recorded",
                                )
                              }
                            >
                              Record
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="empty-line">
                          No upcoming items. Add a bill or paycheck.
                        </div>
                      )}
                    </section>
                  </div>
                  <section className="panel list-panel">
                    <div className="panel-head">
                      <div>
                        <h2>Planned series</h2>
                        <p>
                          Editing a series will come in a later update; you can
                          remove and recreate it now.
                        </p>
                      </div>
                    </div>
                    {documentData!.plannedItems.length ? (
                      documentData!.plannedItems.map((item) => (
                        <div className="ledger-row" key={item.id}>
                          <div className={`item-icon ${item.kind}`}>
                            {item.kind === "income" ? (
                              <ArrowDownLeft size={17} />
                            ) : (
                              <ArrowUpRight size={17} />
                            )}
                          </div>
                          <div className="row-name">
                            <strong>{item.name}</strong>
                            <small>
                              From {shortDate(item.firstDate)} ·{" "}
                              {repeatLabel[item.repeat]}
                            </small>
                          </div>
                          <strong
                            className={item.kind === "income" ? "positive" : ""}
                          >
                            {money(item.amountCents)}
                          </strong>
                          <button
                            className="quiet-remove"
                            disabled={busy}
                            onClick={() =>
                              mutate(
                                { type: "remove_planned_item", id: item.id },
                                "Removed from plan",
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="empty-line">No planned series yet.</div>
                    )}
                  </section>
                </>
              )}
              {view === "funds" && (
                <FundsView
                  document={documentData!}
                  today={today}
                  busy={busy}
                  mutate={mutate}
                />
              )}
              {view === "checkin" && (
                <CheckInView
                  document={documentData!}
                  today={today}
                  userEmail={snapshot.user.email}
                  members={snapshot.household.members}
                  busy={busy}
                  mutate={mutate}
                />
              )}
              {view === "accounts" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="kicker">THE SHARED FOUNDATION</div>
                      <h1>Accounts & household</h1>
                      <p>
                        Balances, reconciliation, and who can see this plan.
                      </p>
                    </div>
                    <div className="heading-number">
                      {money(currentBalance)} <span>across accounts</span>
                    </div>
                  </div>
                  {legacyPreview &&
                    documentData!.accounts.length === 1 &&
                    documentData!.accounts[0].openingBalanceCents === 0 &&
                    !documentData!.transactions.length &&
                    !documentData!.plannedItems.length && (
                      <section className="panel legacy-panel">
                        <div>
                          <h2>Bring in your earlier preview</h2>
                          <p>
                            Your browser still has the figures from the first
                            version. Importing may include sample entries, so
                            check them before using the plan.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                "Import the earlier browser data into this shared household? This may include sample figures.",
                              )
                            )
                              return;
                            try {
                              if (
                                await mutate(
                                  {
                                    type: "import_preview",
                                    preview: JSON.parse(legacyPreview),
                                  },
                                  "Earlier preview imported",
                                )
                              )
                                setLegacyPreview(null);
                            } catch {
                              setError("The earlier preview could not be read");
                            }
                          }}
                        >
                          Import earlier preview
                        </Button>
                      </section>
                    )}
                  {documentData!.accounts.length === 1 &&
                    documentData!.accounts[0].openingBalanceCents === 0 &&
                    !documentData!.transactions.length &&
                    !documentData!.plannedItems.length && (
                      <div className="backup-import">
                        <label>
                          Have an earlier backup?{" "}
                          <input
                            type="file"
                            accept=".json,application/json"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) importOldBackup(file);
                              event.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    )}
                  <div className="content-grid account-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>Accounts</h2>
                          <p>
                            Start with the balance at your bank, then record
                            changes here.
                          </p>
                        </div>
                        <CreditCard size={18} />
                      </div>
                      {documentData!.accounts.map((account) => {
                        const latest = [...documentData!.reconciliations]
                          .reverse()
                          .find((item) => item.accountId === account.id);
                        return (
                          <button
                            key={account.id}
                            className={`account-row ${reconcileAccountId === account.id ? "active" : ""}`}
                            onClick={() => {
                              setReconcileAccountId(account.id);
                              setObservedBalance("");
                            }}
                          >
                            <span>
                              <strong>{account.name}</strong>
                              <small>
                                {latest
                                  ? `Checked ${shortDate(latest.date)}`
                                  : "Not checked against bank yet"}
                              </small>
                            </span>
                            <strong>
                              {money(accountBalance(documentData!, account.id))}
                            </strong>
                          </button>
                        );
                      })}
                      <form
                        className="form-stack compact-form"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const ok = await mutate(
                            {
                              type: "add_account",
                              name: accountName,
                              openingBalanceCents: asCents(accountOpening),
                            },
                            "Account added",
                          );
                          if (ok) {
                            setAccountName("");
                            setAccountOpening("");
                          }
                        }}
                      >
                        <h3>Add another account</h3>
                        <div className="form-two">
                          <label>
                            Name
                            <Input
                              required
                              placeholder="Savings"
                              value={accountName}
                              onChange={(event) =>
                                setAccountName(event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Current starting balance
                            <Input
                              required
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={accountOpening}
                              onChange={(event) =>
                                setAccountOpening(event.target.value)
                              }
                            />
                          </label>
                        </div>
                        <Button disabled={busy} variant="outline">
                          Add account
                        </Button>
                      </form>
                    </section>
                    <section className="panel reconcile-panel">
                      <div className="panel-head">
                        <div>
                          <h2>Match your bank balance</h2>
                          <p>
                            Match the bank’s posted balance; pending entries
                            stay separate.
                          </p>
                        </div>
                        <RefreshCw size={18} />
                      </div>
                      <div className="reconcile-current">
                        <span>
                          Cleared ledger balance · {selectedAccount?.name}
                        </span>
                        <strong>{money(ledgerBalance)}</strong>
                      </div>
                      <form
                        className="form-stack"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          if (
                            await mutate(
                              {
                                type: "reconcile",
                                accountId: reconcileAccountId,
                                observedBalanceCents: asCents(observedBalance),
                              },
                              "Balance reconciled",
                            )
                          )
                            setObservedBalance("");
                        }}
                      >
                        <label>
                          Posted balance shown by your bank
                          <Input
                            required
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={observedBalance}
                            onChange={(event) =>
                              setObservedBalance(event.target.value)
                            }
                          />
                        </label>
                        {reconciliationDelta !== null && (
                          <div className="reconcile-preview">
                            <span>Adjustment to record</span>
                            <strong
                              className={
                                reconciliationDelta < 0 ? "amount-negative" : ""
                              }
                            >
                              {reconciliationDelta >= 0 ? "+" : "−"}
                              {money(Math.abs(reconciliationDelta))}
                            </strong>
                          </div>
                        )}
                        <Button
                          disabled={busy || !selectedAccount}
                          className="form-submit"
                        >
                          Reconcile balance
                        </Button>
                      </form>
                      <p className="fine-print">
                        This adds a separate adjustment entry. It does not
                        rewrite or erase earlier transactions.
                      </p>
                      {documentData!.reconciliations.length > 0 && (
                        <div className="history-block">
                          <h3>Recent checks</h3>
                          {[...documentData!.reconciliations]
                            .reverse()
                            .slice(0, 3)
                            .map((item) => (
                              <div key={item.id}>
                                <span>
                                  {shortDate(item.date)} ·{" "}
                                  {
                                    documentData!.accounts.find(
                                      (account) =>
                                        account.id === item.accountId,
                                    )?.name
                                  }
                                </span>
                                <strong>
                                  {item.adjustmentCents === 0
                                    ? "Matched"
                                    : `${item.adjustmentCents > 0 ? "+" : "−"}${money(Math.abs(item.adjustmentCents))}`}
                                </strong>
                              </div>
                            ))}
                        </div>
                      )}
                    </section>
                  </div>
                  <div className="content-grid account-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>Household</h2>
                          <p>Two people, one shared plan, separate sign-ins.</p>
                        </div>
                        <Users size={18} />
                      </div>
                      <div className="members-list">
                        {snapshot.household.members.map((member) => (
                          <div key={member.email}>
                            <span className="member-avatar">
                              {member.email[0].toUpperCase()}
                            </span>
                            <span>
                              <strong>{member.email}</strong>
                              <small>
                                {member.role === "owner"
                                  ? "Owner"
                                  : member.joined_at
                                    ? "Member"
                                    : "Invited · waiting for sign-in"}
                              </small>
                            </span>
                          </div>
                        ))}
                      </div>
                      {snapshot.household.role === "owner" && (
                        <>
                          <form
                            className="form-stack compact-form"
                            onSubmit={async (event) => {
                              event.preventDefault();
                              if (
                                await mutate(
                                  {
                                    type: "rename_household",
                                    name: householdName,
                                  },
                                  "Household renamed",
                                )
                              )
                                setHouseholdName(householdName.trim());
                            }}
                          >
                            <label>
                              Household name
                              <Input
                                required
                                maxLength={60}
                                value={householdName}
                                onChange={(event) =>
                                  setHouseholdName(event.target.value)
                                }
                              />
                            </label>
                            <Button disabled={busy} variant="outline">
                              Save name
                            </Button>
                          </form>
                          {snapshot.household.members.length < 2 && (
                            <form
                              className="form-stack compact-form"
                              onSubmit={async (event) => {
                                event.preventDefault();
                                if (
                                  await mutate(
                                    {
                                      type: "invite_member",
                                      email: inviteEmail,
                                    },
                                    "Partner added to this household",
                                  )
                                )
                                  setInviteEmail("");
                              }}
                            >
                              <label>
                                Partner's sign-in email
                                <Input
                                  required
                                  type="email"
                                  placeholder="partner@example.com"
                                  value={inviteEmail}
                                  onChange={(event) =>
                                    setInviteEmail(event.target.value)
                                  }
                                />
                              </label>
                              <Button disabled={busy} variant="outline">
                                Add partner
                              </Button>
                              <p className="fine-print">
                                The partner also needs access to this private
                                site before they can sign in.
                              </p>
                            </form>
                          )}
                        </>
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>Spending guardrails</h2>
                          <p>
                            Set aside a minimum cushion and plan category
                            limits.
                          </p>
                        </div>
                      </div>
                      <form
                        className="form-stack compact-form"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          await mutate(
                            {
                              type: "set_cushion",
                              cushionCents: asCents(cushion),
                            },
                            "Cushion updated",
                          );
                        }}
                      >
                        <label>
                          Minimum cash cushion
                          <Input
                            required
                            type="number"
                            min="0"
                            step="0.01"
                            value={cushion}
                            onChange={(event) => setCushion(event.target.value)}
                          />
                        </label>
                        <Button disabled={busy} variant="outline">
                          Save cushion
                        </Button>
                      </form>
                      <form
                        className="add-category-form"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          if (
                            await mutate(
                              { type: "add_category", name: newCategory },
                              "Category added",
                            )
                          )
                            setNewCategory("");
                        }}
                      >
                        <Input
                          required
                          maxLength={30}
                          placeholder="New category"
                          value={newCategory}
                          onChange={(event) =>
                            setNewCategory(event.target.value)
                          }
                        />
                        <Button disabled={busy} variant="outline">
                          <Plus size={15} /> Add
                        </Button>
                      </form>
                      <div className="limits-list">
                        {householdCategories.map((category) => (
                          <CategoryLimit
                            key={category}
                            category={category}
                            value={documentData!.categoryLimits[category] ?? 0}
                            busy={busy}
                            remove={
                              (documentData!.customCategories ?? []).includes(
                                category,
                              )
                                ? () =>
                                    mutate(
                                      {
                                        type: "remove_category",
                                        name: category,
                                      },
                                      "Category removed",
                                    )
                                : undefined
                            }
                            save={(value) =>
                              mutate(
                                {
                                  type: "set_category_limit",
                                  category,
                                  limitCents: value,
                                },
                                `${category} plan updated`,
                              )
                            }
                          />
                        ))}
                      </div>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function CategoryLimit({
  category,
  value,
  busy,
  save,
  remove,
}: {
  category: string;
  value: number;
  busy: boolean;
  save: (value: number) => Promise<boolean>;
  remove?: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(String(value / 100));
  useEffect(() => setDraft(String(value / 100)), [value]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(asCents(draft));
      }}
    >
      <label htmlFor={`limit-${category}`}>{category}</label>
      <Input
        id={`limit-${category}`}
        type="number"
        min="0"
        step="0.01"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        disabled={busy || asCents(draft) === value}
        aria-label={`Save ${category} limit`}
      >
        <Check size={16} />
      </button>
      {remove && (
        <button
          type="button"
          disabled={busy}
          aria-label={`Remove ${category}`}
          onClick={remove}
        >
          <Trash2 size={15} />
        </button>
      )}
    </form>
  );
}
