"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, Eye, EyeOff, FileSpreadsheet, KeyRound, Loader2, LockKeyhole, RefreshCw, RotateCcw, ShieldCheck, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import { parseCsv, parseDate, parseMoney, type CsvData, type DateFormat } from "@/lib/csv";

type Plan = { id: string; name: string };
type Account = { id: string; name: string; closed?: boolean; deleted?: boolean };
type Mapping = { date: string; payee: string; amount: string; debit: string; credit: string; memo: string };
type AmountMode = "signed" | "expenses-positive";
type SyncResult = { imported: number; duplicates: number; transactionIds: string[] };
type ImportFile = { id: string; csv: CsvData; fileName: string; accountId: string; mapping: Mapping; dateFormat: DateFormat; amountMode: AmountMode; selectedRows: Set<number>; result: SyncResult | null; error?: string };
type Prepared = { rowIndex: number; date: string; payee: string; memo: string; amount: number; importId: string; selected: boolean; valid: boolean; error?: string };

const EMPTY_MAPPING: Mapping = { date: "", payee: "", amount: "", debit: "", credit: "", memo: "" };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const matchHeader = (headers: string[], candidates: string[]) => headers.find((header) => candidates.some((candidate) => normalize(header).includes(candidate))) ?? "";
const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function detectMapping(headers: string[]): Mapping {
  return {
    date: headers.find((header) => normalize(header) === "postdate") || matchHeader(headers, ["transactiondate", "postingdate", "date"]),
    payee: matchHeader(headers, ["transactiondescription", "description", "details", "merchant", "payee", "narrative"]),
    amount: headers.find((header) => normalize(header) === "amountbbd") || headers.find((header) => ["transactionamount", "amount"].includes(normalize(header))) || "",
    debit: matchHeader(headers, ["withdrawal", "debit", "moneyout", "outflow"]),
    credit: matchHeader(headers, ["deposit", "credit", "moneyin", "inflow"]),
    memo: matchHeader(headers, ["memo", "reference", "transactionid"]),
  };
}

function formatCurrency(milliunits: number) {
  return new Intl.NumberFormat("en-BB", { style: "currency", currency: "BBD" }).format(milliunits / 1000);
}

async function ynabRequest<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/ynab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({ error: "YNAB returned an unreadable response." })) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "The YNAB request failed.");
  return result as T;
}

function prepareFile({csv, mapping, dateFormat, amountMode, selectedRows}: ImportFile): Prepared[] {
    if (!csv) return [];
    const occurrences = new Map<string, number>();
    return csv.rows.map((row, rowIndex) => {
      const pending = Object.entries(row).some(([header, value]) => ["postdate", "postingdate"].includes(normalize(header)) && value.trim().toLowerCase() === "pending");
      const date = mapping.date ? parseDate(row[mapping.date] ?? "", dateFormat) : null;
      let amountValue: number | null = null;
      if (mapping.amount) {
        amountValue = parseMoney(row[mapping.amount] ?? "");
        if (amountValue !== null && amountMode === "expenses-positive") amountValue *= -1;
      } else {
        const debit = mapping.debit ? parseMoney(row[mapping.debit] ?? "") : null;
        const credit = mapping.credit ? parseMoney(row[mapping.credit] ?? "") : null;
        if (debit !== null || credit !== null) amountValue = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
      }
      const amount = amountValue === null ? 0 : Math.round(amountValue * 1000);
      const payeeRaw = mapping.payee ? row[mapping.payee] ?? "" : "";
      const payee = decodeHtmlEntities(payeeRaw).replace(/\s+/g, " ").trim().slice(0, 200) || "CIBC Caribbean transaction";
      const memo = mapping.memo ? decodeHtmlEntities((row[mapping.memo] ?? "").trim()).slice(0, 500) : "Imported from CIBC Caribbean";
      const occurrenceKey = `${amount}:${date ?? "invalid"}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      if (!pending) occurrences.set(occurrenceKey, occurrence);
      const errors = [pending ? "Pending — excluded" : "", !date && !pending ? "Invalid date" : "", amountValue === null || amount === 0 ? "Invalid amount" : ""].filter(Boolean);
      return { rowIndex, date: date ?? "—", payee, memo, amount, importId: date ? `YNAB:${amount}:${date}:${occurrence}` : "", selected: selectedRows.has(rowIndex), valid: errors.length === 0, error: errors.join(" · ") || undefined };
    });
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [savedToken, setSavedToken] = useState(false);
  const connectionVersion = useRef(0);
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [planId, setPlanId] = useState("");

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const activeFile = files.find(file => file.id === activeId) ?? files[0];
  const csv = activeFile?.csv ?? null;
  const fileName = activeFile?.fileName ?? "";
  const accountId = activeFile?.accountId ?? "";
  const mapping = activeFile?.mapping ?? EMPTY_MAPPING;
  const dateFormat = activeFile?.dateFormat ?? "dd/mm/yyyy";
  const amountMode = activeFile?.amountMode ?? "signed";
  const selectedRows = activeFile?.selectedRows ?? new Set<number>();
  const syncResult = activeFile?.result ?? null;
  function updateActive<K extends keyof ImportFile>(key: K, value: ImportFile[K] | ((current: ImportFile[K]) => ImportFile[K])) {
    setFiles(current => current.map(file => file.id === activeFile?.id ? { ...file, [key]: typeof value === "function" ? (value as (v: ImportFile[K]) => ImportFile[K])(file[key]) : value, ...(key !== "result" ? {result: null, error: undefined} : {}) } : file));
  }
  const setAccountId = (value: string) => updateActive("accountId", value);
  const setMapping = (value: Mapping | ((current: Mapping) => Mapping)) => updateActive("mapping", value);
  const setDateFormat = (value: DateFormat) => updateActive("dateFormat", value);
  const setAmountMode = (value: AmountMode) => updateActive("amountMode", value);
  const setSelectedRows = (value: Set<number> | ((current: Set<number>) => Set<number>)) => updateActive("selectedRows", value);
  const setSyncResult = (value: ImportFile["result"]) => updateActive("result", value);

  const connected = plans.length > 0;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cibc-ynab-token");
      if (saved) { setToken(saved); setSavedToken(true); }
    } catch { toast.error("Browser storage is unavailable. You can still connect for this session."); }
  }, []);

  const removeToken = () => {
    try { localStorage.removeItem("cibc-ynab-token"); }
    catch { toast.error("Could not remove the saved token. Check your browser storage settings."); return; }
    connectionVersion.current += 1;
    setToken(""); setSessionToken(""); setSavedToken(false); setShowToken(false);
    setPlans([]); setAccounts([]); setPlanId(""); setAccountId("");
    setConnecting(false); setLoadingAccounts(false); setSyncResult(null);
    toast.success("Saved token removed. YNAB disconnected.");
  };

  const connect = useCallback(async () => {
    if (!token.trim()) return toast.error("Paste your YNAB personal access token first.");
    const version = ++connectionVersion.current;
    setConnecting(true);
    setSyncResult(null);
    try {
      const result = await ynabRequest<{ plans: Plan[] }>({ action: "plans", token: token.trim() });
      if (version !== connectionVersion.current) return;
      if (!result.plans?.length) throw new Error("No YNAB plans were found for this token.");
      setPlans(result.plans);
      setSessionToken(token.trim());
      setPlanId(result.plans[0].id);
      try {
        localStorage.setItem("cibc-ynab-token", token.trim());
        setSavedToken(true);
        toast.success("Connected. Token saved on this browser.");
      } catch { toast.warning("Connected for this session, but your browser could not save the token."); }
    } catch (error) {
      if (version !== connectionVersion.current) return;
      setPlans([]); setAccounts([]); setPlanId(""); setAccountId(""); setSessionToken("");
      toast.error(error instanceof Error ? error.message : "Could not connect to YNAB.");
    } finally { if (version === connectionVersion.current) setConnecting(false); }
  }, [token]);

  useEffect(() => {
    if (!planId || !sessionToken) return;
    let cancelled = false;
    setLoadingAccounts(true); setAccounts([]);
    setFiles(current => current.map(file => ({...file, accountId: "", result: null, error: undefined})));
    ynabRequest<{ accounts: Account[] }>({ action: "accounts", token: sessionToken, planId })
      .then((result) => {
        if (cancelled) return;
        const active = (result.accounts ?? []).filter((account) => !account.closed && !account.deleted);
        setAccounts(active);
      })
      .catch((error) => !cancelled && toast.error(error instanceof Error ? error.message : "Could not load accounts."))
      .finally(() => !cancelled && setLoadingAccounts(false));
    return () => { cancelled = true; };
  }, [planId, sessionToken]);

  const loadFiles = async (incoming: File[]) => {
    const additions: ImportFile[] = [];
    for (const file of incoming) {
      try {
        if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Choose a CSV file.");
        if (file.size > 5_000_000) throw new Error("The limit is 5 MB per file.");
        const csv = parseCsv(await file.text());
        if (!csv.rows.length || csv.headers.length < 2) throw new Error("No transaction rows found.");
        additions.push({id: crypto.randomUUID(), csv, fileName: file.name, accountId: "", mapping: detectMapping(csv.headers), dateFormat: "dd/mm/yyyy", amountMode: csv.headers.some(h => normalize(h) === "amountbbd") && csv.headers.some(h => normalize(h) === "cardno") ? "expenses-positive" : "signed", selectedRows: new Set(csv.rows.map((_, index) => index)), result: null});
      } catch (error) { toast.error(`${file.name}: ${error instanceof Error ? error.message : "Could not read file"}`); }
    }
    setFiles(current => [...current, ...additions]);
    if (additions.length) { setActiveId(additions[0].id); toast.success(`${additions.length} CSV files added`); }
  };

  const prepared = useMemo(() => activeFile ? prepareFile(activeFile) : [], [activeFile]);

  const selectedValid = prepared.filter((row) => row.selected && row.valid);
  const invalidCount = prepared.filter((row) => !row.valid).length;
  const outflow = selectedValid.filter((row) => row.amount < 0).reduce((sum, row) => sum + row.amount, 0);
  const inflow = selectedValid.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const mappingReady = Boolean(mapping.date && mapping.payee && (mapping.amount || mapping.debit || mapping.credit));

  const batchReady = files.length > 0 && !loadingAccounts && files.every(file => accounts.some(account => account.id === file.accountId) && file.mapping.date && file.mapping.payee && (file.mapping.amount || file.mapping.debit || file.mapping.credit) && prepareFile(file).some(row => row.valid && row.selected));
  const sync = async () => {
    if (!batchReady || !sessionToken || !planId || syncing) return;
    setSyncing(true);
    let failed = false;
    for (const file of files) {
      let imported = 0; let duplicates = 0; const transactionIds: string[] = [];
      const rows = prepareFile(file).filter(row => row.selected && row.valid);
      try {
        for (let offset = 0; offset < rows.length; offset += 500) {
          const result = await ynabRequest<{transaction_ids: string[]; duplicate_import_ids: string[]}>({action: "transactions", token: sessionToken, planId, transactions: rows.slice(offset, offset + 500).map(row => ({account_id: file.accountId, date: row.date, amount: row.amount, payee_name: row.payee, memo: row.memo, cleared: "cleared", approved: false, import_id: row.importId}))});
          imported += result.transaction_ids.length; duplicates += result.duplicate_import_ids.length; transactionIds.push(...result.transaction_ids);
        }
        setFiles(current => current.map(item => item.id === file.id ? {...item, result: {imported, duplicates, transactionIds}, error: undefined} : item));
      } catch (error) {
        failed = true;
        setFiles(current => current.map(item => item.id === file.id ? {...item, result: {imported, duplicates, transactionIds}, error: `${error instanceof Error ? error.message : "Sync failed"} Retry checks import IDs to avoid repeats.`} : item));
      }
    }
    setSyncing(false);
    if (failed) toast.error("Some files could not finish. Review the results and retry.");
    else toast.success("Batch sync complete");
  };

  const undoSync = async (file: ImportFile) => {
    const transactionIds = file.result?.transactionIds ?? [];
    if (!transactionIds.length || !sessionToken || !planId || undoingId || syncing) return;
    setUndoingId(file.id);
    try {
      let removed = 0;
      for (let offset = 0; offset < transactionIds.length; offset += 500) {
        const result = await ynabRequest<{ deleted: number; failed: number }>({ action: "deleteTransactions", token: sessionToken, planId, transactionIds: transactionIds.slice(offset, offset + 500) });
        removed += result.deleted;
      }
      setFiles(current => current.map(item => item.id === file.id ? { ...item, result: null, error: undefined } : item));
      toast.success(`${removed} transaction${removed === 1 ? "" : "s"} removed from YNAB`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not undo the sync. Some transactions may remain in YNAB.");
    } finally {
      setUndoingId(null);
    }
  };

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool?: (tool: unknown, options?: unknown) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({ name: "get_cibc_import_summary", title: "Review CIBC Caribbean import", description: "Summarize the loaded CIBC Caribbean CSV before it is synced to YNAB.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => ({ fileName: fileName || null, rows: prepared.length, selected: selectedValid.length, invalid: invalidCount, ready: mappingReady && Boolean(accountId) }) }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* Optional in browsers without WebMCP. */ }
    return () => lifecycle.abort();
  }, [accountId, fileName, invalidCount, mappingReady, prepared.length, selectedValid.length]);

  const allSelected = prepared.length > 0 && prepared.every((row) => selectedRows.has(row.rowIndex));
  const toggleAll = (checked: boolean) => setSelectedRows(checked ? new Set(prepared.map((row) => row.rowIndex)) : new Set());
  const toggleRow = (rowIndex: number, checked: boolean) => setSelectedRows((current) => { const next = new Set(current); if (checked) next.add(rowIndex); else next.delete(rowIndex); return next; });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <fieldset disabled={syncing || Boolean(undoingId)} className="min-w-0 border-0 p-0 m-0">
      <Toaster richColors position="top-center" />
      <header className="border-b border-white/10 bg-[#071a2b] text-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#c61d35] shadow-lg shadow-black/15"><RefreshCw className="h-5 w-5" aria-hidden="true" /></div>
            <div><p className="text-[0.72rem] font-bold uppercase tracking-[0.18em] text-[#92a8ba]">Private importer</p><h1 className="text-lg font-semibold tracking-tight">CIBC Caribbean <span className="text-[#6ee7b7]">→</span> YNAB Sync</h1></div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#c7d4df] sm:flex"><ShieldCheck className="h-4 w-4 text-[#6ee7b7]" /> Owner-only access</div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[320px_minmax(0,1fr)] lg:py-8">
        <aside className="space-y-5">
          <section className="panel overflow-hidden">
            <StepHeader step="1" title="Connect YNAB" subtitle="Use your personal access token" complete={connected} active />
            <div className="space-y-4 p-5">
              <div className="space-y-2"><Label htmlFor="token">Personal access token</Label><div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="token" value={token} onChange={(event) => setToken(event.target.value)} type={showToken ? "text" : "password"} placeholder="Paste token" className="h-11 pl-10 pr-11 font-mono text-sm" autoComplete="off" /><button type="button" onClick={() => setShowToken((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showToken ? "Hide token" : "Show token"}>{showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
              <Button className="h-11 w-full" onClick={connect} disabled={connecting || !token.trim()}>{connecting ? <Loader2 className="animate-spin" /> : connected ? <RefreshCw /> : <LockKeyhole />}{connecting ? "Connecting…" : connected ? "Reconnect" : "Save & connect"}</Button>
              <p className="text-xs leading-5 text-muted-foreground">Your token is saved on this browser after a successful connection. Use Remove token to forget it here. <a className="font-medium text-primary underline-offset-2 hover:underline" href="https://app.ynab.com/settings/developer" target="_blank" rel="noreferrer">Create one in YNAB</a>.</p>
              {(savedToken || connected) && <Button variant="outline" className="w-full" onClick={removeToken} disabled={syncing}><X /> Remove token</Button>}
              {savedToken && <p className="text-xs text-muted-foreground">Token saved on this browser. Removing it here does not revoke it in YNAB.</p>}
            </div>
          </section>

          <section className={`panel overflow-hidden ${!connected ? "opacity-60" : ""}`}>
            <StepHeader step="2" title="Choose your plan" subtitle="Assign accounts beside each CSV" complete={Boolean(planId)} active={connected} />
            <div className="space-y-4 p-5">
              <SelectField label="YNAB plan" value={planId} onChange={setPlanId} disabled={!connected || syncing} placeholder="Select a plan" items={plans} />
            </div>
          </section>

          <div className="rounded-2xl border border-[#b8d8cc] bg-[#edf9f4] p-4 text-sm text-[#164e3d]"><div className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Safe by design</div><p className="leading-5 text-[#35695a]">The app never asks for your CIBC Caribbean password. You export the CSV yourself, and duplicate-safe IDs prevent the same rows from being added twice.</p></div>
        </aside>

        <section className="min-w-0 space-y-6">
          <div className="panel p-5 sm:p-6">
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><StepDot step="3" complete={Boolean(csv)} active={Boolean(accountId)} /><div><h2 className="text-lg font-semibold">Upload CIBC Caribbean transactions</h2><p className="text-sm text-muted-foreground">Export a CSV from CIBC Caribbean Online Banking</p></div></div>{csv && <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><RefreshCw /> Add CSV files</Button>}</div>
            <input ref={fileInputRef} type="file" multiple accept=".csv,text/csv" className="sr-only" onChange={(event) => { if (event.target.files) void loadFiles(Array.from(event.target.files)); event.target.value = ""; }} />
            {!csv ? <button type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void loadFiles(Array.from(event.dataTransfer.files)); }} className="group flex min-h-60 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#b9c7d2] bg-[#f7fafc] px-6 text-center transition hover:border-primary hover:bg-[#f3f8fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white text-primary shadow-sm ring-1 ring-border transition group-hover:-translate-y-0.5"><UploadCloud className="h-6 w-6" /></span><span className="font-semibold">Drop your CIBC Caribbean CSV files here</span><span className="mt-1 text-sm text-muted-foreground">or choose multiple files · up to 5 MB each</span></button>
              : <div className="flex flex-col gap-4 rounded-2xl border border-[#b8d8cc] bg-[#f3fbf7] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-[#087a55] ring-1 ring-[#c9e6db]"><FileSpreadsheet className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate font-semibold">{fileName}</p><p className="text-sm text-muted-foreground">{csv.rows.length} rows · {csv.headers.length} columns detected</p></div></div><Badge className="w-fit bg-[#d7f5e8] text-[#075c41] hover:bg-[#d7f5e8]"><CheckCircle2 /> Ready to map</Badge></div>}
          </div>

          {files.length > 0 && <div className="panel p-5 space-y-4">
            <h2 className="text-lg font-semibold">Files to sync ({files.length})</h2>
            <p className="text-sm text-muted-foreground">Assign each file to an account in this plan. Select Review to adjust its mapping and transactions.</p>
            {files.map(file => <div key={file.id} className={`rounded-xl border p-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,1fr)_auto] ${file.id === activeFile?.id ? "border-primary bg-muted/40" : ""}`}>
              <div className="min-w-0"><p className="font-semibold break-all">{file.fileName}</p><p className="text-sm text-muted-foreground">{prepareFile(file).filter(row => row.valid && row.selected).length} selected · {file.csv.rows.length} rows</p>{file.result && <p className="text-sm">{file.result.imported} imported · {file.result.duplicates} duplicates skipped</p>}{file.error && <p className="text-sm text-destructive" role="alert">{file.error}</p>}</div>
              <SelectField label="Destination account" value={file.accountId} onChange={value => setFiles(current => current.map(item => item.id === file.id ? {...item, accountId: value, result: null, error: undefined} : item))} disabled={!planId || loadingAccounts || syncing} placeholder="Assign an account" items={accounts} />
              <div className="flex gap-2 items-center">{file.result && file.result.transactionIds.length > 0 && <Button variant="outline" onClick={() => undoSync(file)} disabled={undoingId === file.id}>{undoingId === file.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}{undoingId === file.id ? "Undoing…" : "Undo"}</Button>}<Button variant="outline" onClick={() => setActiveId(file.id)}>Review</Button><Button variant="ghost" aria-label={`Remove ${file.fileName}`} onClick={() => setFiles(current => current.filter(item => item.id !== file.id))}><X /></Button></div>
            </div>)}
            <Button onClick={sync} disabled={!batchReady || syncing}>{syncing ? "Syncing files…" : `Sync all ${files.length} files to YNAB`}</Button>
            {!batchReady && <p className="text-sm text-muted-foreground">Each file needs an account, valid mapping, and at least one valid selected transaction. Remove files you do not want to import.</p>}
          </div>}
          {csv && <>
            <div className="panel p-5 sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Check the column mapping</h2><p className="text-sm text-muted-foreground">Check the mapping before syncing. For CIBC Caribbean cards, use Amount (BBD) with a BBD YNAB plan; Post Date skips pending items.</p></div><Badge variant={mappingReady ? "secondary" : "destructive"}>{mappingReady ? "Mapping complete" : "Needs attention"}</Badge></div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MappingSelect label="Date" value={mapping.date} headers={csv.headers} onChange={(value) => setMapping((current) => ({ ...current, date: value }))} required />
                <MappingSelect label="Description / payee" value={mapping.payee} headers={csv.headers} onChange={(value) => setMapping((current) => ({ ...current, payee: value }))} required />
                <MappingSelect label="Amount" value={mapping.amount} headers={csv.headers} onChange={(value) => setMapping((current) => ({ ...current, amount: value === "none" ? "" : value, debit: value !== "none" ? "" : current.debit, credit: value !== "none" ? "" : current.credit }))} allowNone />
                <MappingSelect label="Memo (optional)" value={mapping.memo} headers={csv.headers} onChange={(value) => setMapping((current) => ({ ...current, memo: value === "none" ? "" : value }))} allowNone />
              </div>
              {!mapping.amount && <div className="mt-4 grid gap-4 rounded-xl border border-border bg-muted/40 p-4 sm:grid-cols-2"><MappingSelect label="Debit / withdrawal" value={mapping.debit} headers={csv.headers} onChange={(value) => setMapping((current) => ({ ...current, debit: value === "none" ? "" : value }))} allowNone /><MappingSelect label="Credit / deposit" value={mapping.credit} headers={csv.headers} onChange={(value) => setMapping((current) => ({ ...current, credit: value === "none" ? "" : value }))} allowNone /></div>}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Date format</Label><Select value={dateFormat} onValueChange={(value) => setDateFormat(value as DateFormat)}><SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dd/mm/yyyy">DD/MM/YYYY</SelectItem><SelectItem value="mm/dd/yyyy">MM/DD/YYYY</SelectItem><SelectItem value="yyyy-mm-dd">YYYY-MM-DD</SelectItem></SelectContent></Select></div>
                {mapping.amount && <div className="space-y-2"><Label>How expenses appear</Label><Select value={amountMode} onValueChange={(value) => setAmountMode(value as AmountMode)}><SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="signed">Expenses are negative</SelectItem><SelectItem value="expenses-positive">Purchases positive; payments negative</SelectItem></SelectContent></Select></div>}
              </div>
            </div>

            <div className="panel overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><h2 className="text-lg font-semibold">Review transactions</h2><p className="text-sm text-muted-foreground">Uncheck anything you don’t want to send.</p></div><div className="grid grid-cols-3 gap-2 text-center"><Stat label="Selected" value={String(selectedValid.length)} /><Stat label="Outflow" value={formatCurrency(Math.abs(outflow))} /><Stat label="Inflow" value={formatCurrency(inflow)} /></div></div>
              {invalidCount > 0 && <Alert variant="destructive" className="m-5 mb-0 sm:mx-6"><X /><AlertTitle>{invalidCount} row{invalidCount === 1 ? "" : "s"} need attention</AlertTitle><AlertDescription>Check the date format and amount mapping. Pending transactions are excluded until posted. Invalid rows will not be synced.</AlertDescription></Alert>}
              <div className="max-h-[520px] overflow-auto"><Table><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-12"><Checkbox checked={allSelected} onCheckedChange={(value) => toggleAll(Boolean(value))} aria-label="Select all transactions" /></TableHead><TableHead>Date</TableHead><TableHead>Payee</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{prepared.map((row) => <TableRow key={row.rowIndex} className={!row.valid ? "bg-destructive/5" : ""}><TableCell><Checkbox checked={row.selected} onCheckedChange={(value) => toggleRow(row.rowIndex, Boolean(value))} aria-label={`Select row ${row.rowIndex + 1}`} /></TableCell><TableCell className="whitespace-nowrap font-medium">{row.date}</TableCell><TableCell><div className="max-w-[360px] truncate">{row.payee}</div>{row.memo && <div className="max-w-[360px] truncate text-xs text-muted-foreground">{row.memo}</div>}</TableCell><TableCell>{row.valid ? <Badge variant="outline" className="border-[#b8d8cc] text-[#087a55]">Ready</Badge> : <span className="text-sm font-medium text-destructive">{row.error}</span>}</TableCell><TableCell className={`whitespace-nowrap text-right font-semibold tabular-nums ${row.amount > 0 ? "text-[#087a55]" : ""}`}>{formatCurrency(row.amount)}</TableCell></TableRow>)}</TableBody></Table></div>
              <div className="border-t border-border bg-[#fafcfd] p-5 sm:p-6">
                {syncResult && <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[#b8d8cc] bg-[#edf9f4] p-4 text-[#164e3d] sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">Sync complete</p><p className="text-sm text-[#35695a]">{syncResult.imported} added to YNAB{syncResult.duplicates ? ` · ${syncResult.duplicates} duplicate${syncResult.duplicates === 1 ? "" : "s"} safely skipped` : ""}.</p>{syncResult.transactionIds.length > 0 && <p className="text-xs text-[#35695a]">You can undo this until you leave or reload the page.</p>}</div></div>{syncResult.transactionIds.length > 0 && activeFile && <Button variant="outline" size="sm" className="shrink-0" onClick={() => undoSync(activeFile)} disabled={undoingId === activeFile.id}>{undoingId === activeFile.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}{undoingId === activeFile.id ? "Undoing…" : "Undo sync"}</Button>}</div>}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 text-[#087a55]" /> Duplicate-safe import IDs are added automatically</div><Button size="lg" className="h-12 min-w-56" onClick={sync} disabled={syncing || !batchReady}>{syncing ? <Loader2 className="animate-spin" /> : <ArrowRight />}{syncing ? "Syncing…" : `Sync all ${files.length} files to YNAB`}</Button></div>
                {syncing && <Progress className="mt-4" value={70} />}
              </div>
            </div>
          </>}
        </section>
      </div>
      </fieldset>
    </main>
  );
}

function StepDot({ step, complete, active }: { step: string; complete: boolean; active: boolean }) {
  return <span className={`step-dot ${complete ? "step-complete" : active ? "step-active" : ""}`}>{complete ? <Check className="h-4 w-4" /> : step}</span>;
}

function StepHeader({ step, title, subtitle, complete, active }: { step: string; title: string; subtitle: string; complete: boolean; active: boolean }) {
  return <div className="flex items-center gap-3 border-b border-border px-5 py-4"><StepDot step={step} complete={complete} active={active} /><div><h2 className="font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{subtitle}</p></div></div>;
}

function SelectField({ label, value, onChange, disabled, placeholder, items }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; placeholder: string; items: { id: string; name: string }[] }) {
  return <div className="space-y-2"><Label>{label}</Label><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className="h-11 w-full"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>;
}

function MappingSelect({ label, value, headers, onChange, required = false, allowNone = false }: { label: string; value: string; headers: string[]; onChange: (value: string) => void; required?: boolean; allowNone?: boolean }) {
  return <div className="space-y-2"><Label>{label}{required && <span className="ml-1 text-destructive">*</span>}</Label><Select value={value || (allowNone ? "none" : undefined)} onValueChange={onChange}><SelectTrigger className="h-11 w-full"><SelectValue placeholder="Choose column" /></SelectTrigger><SelectContent>{allowNone && <SelectItem value="none">Not used</SelectItem>}{headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}</SelectContent></Select></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-20 rounded-xl bg-muted px-3 py-2"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-0.5 text-sm font-bold tabular-nums">{value}</div></div>;
}
