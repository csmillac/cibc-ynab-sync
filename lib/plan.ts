import type { ExistingTransaction } from "./ynab";

export type PlanRow = { rowIndex: number; date: string; payee: string; amount: number; importId: string; valid: boolean };
export type PlanFile = { id: string; accountId: string; rows: PlanRow[] };
// skip: leave the row unticked by default. transferAccountId: import it as a YNAB transfer to that account.
export type RowPlan = { skip: boolean; note?: string; tone?: "info" | "warn"; transferAccountId?: string };
export type BatchPlan = Map<string, Map<number, RowPlan>>;

const CARD_PAYMENT_RECEIVED = /^payment received/i;
const CHEQUING_CARD_PAYMENT = /credit\s*card/i;
const ACCOUNT_TRANSFER = /transfer\s+(?:to|from)\s+acct\s+(\d+)/i;
const PAIR_WINDOW_DAYS = 4;
const DUPLICATE_WINDOW_DAYS = 3;

export const transferAccountNumber = (payee: string): string | null => payee.match(ACCOUNT_TRANSFER)?.[1] ?? null;

const dayNumber = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

type Ref = { fileId: string; accountId: string; row: PlanRow };

/**
 * Decides, for every row in the batch, whether it should be skipped by default and/or sent to YNAB as a transfer.
 *
 * 1. A chequing "CIBC FCIB Credit Card ..." payment is paired with the card file's "PAYMENT RECEIVED" row
 *    (same amount, dates within a few days). The chequing row is imported once as a transfer to that card and the
 *    card row is skipped, so the payment is not created from both sides.
 * 2. "Transfer To/From Acct <number>" rows become transfers when that number is mapped to a YNAB account.
 * 3. Rows that already exist in YNAB (same import ID, or same amount within a few days) are skipped.
 */
export function planBatch(files: PlanFile[], existing: ExistingTransaction[], transferMap: Record<string, string>, accountName: (id: string) => string): BatchPlan {
  const plan: BatchPlan = new Map(files.map((file) => [file.id, new Map<number, RowPlan>()]));
  const setPlan = (fileId: string, rowIndex: number, value: RowPlan) => plan.get(fileId)?.set(rowIndex, value);

  // 1. Pair chequing card payments with card-file payments.
  const cardPayments: Ref[] = [];
  const chequingPayments: Ref[] = [];
  for (const file of files) for (const row of file.rows) {
    if (!row.valid) continue;
    if (row.amount > 0 && CARD_PAYMENT_RECEIVED.test(row.payee)) cardPayments.push({ fileId: file.id, accountId: file.accountId, row });
    else if (row.amount < 0 && CHEQUING_CARD_PAYMENT.test(row.payee)) chequingPayments.push({ fileId: file.id, accountId: file.accountId, row });
  }
  const paired = new Set<Ref>();
  for (const cheque of chequingPayments.sort((a, b) => dayNumber(a.row.date) - dayNumber(b.row.date))) {
    let best: Ref | undefined; let bestGap = Infinity;
    if (cheque.accountId) for (const card of cardPayments) {
      if (paired.has(card) || card.fileId === cheque.fileId || !card.accountId || card.accountId === cheque.accountId || card.row.amount !== -cheque.row.amount) continue;
      const gap = Math.abs(dayNumber(card.row.date) - dayNumber(cheque.row.date));
      if (gap <= PAIR_WINDOW_DAYS && gap < bestGap) { best = card; bestGap = gap; }
    }
    if (best) {
      paired.add(best);
      setPlan(cheque.fileId, cheque.row.rowIndex, { skip: false, tone: "info", transferAccountId: best.accountId, note: `Imported once as a transfer to ${accountName(best.accountId)}` });
      setPlan(best.fileId, best.row.rowIndex, { skip: true, tone: "info", note: `Counted once, from the ${accountName(cheque.accountId)} transfer` });
    } else {
      setPlan(cheque.fileId, cheque.row.rowIndex, { skip: false, tone: "warn", note: "No matching card payment found — imported as a normal payee" });
    }
  }

  // 2. Mapped "Transfer To/From Acct ..." rows.
  for (const file of files) for (const row of file.rows) {
    if (!row.valid || plan.get(file.id)?.has(row.rowIndex)) continue;
    const number = transferAccountNumber(row.payee);
    const target = number ? transferMap[number] : undefined;
    if (target && target !== file.accountId) setPlan(file.id, row.rowIndex, { skip: false, tone: "info", transferAccountId: target, note: `Imported as a transfer ${row.amount < 0 ? "to" : "from"} ${accountName(target)}` });
  }

  // 3. Rows that already exist in YNAB. Each existing transaction can account for only one row.
  const claimed = new Set<string>();
  for (const file of files) {
    if (!file.accountId) continue;
    for (const row of file.rows) {
      const current = plan.get(file.id)?.get(row.rowIndex);
      if (!row.valid || current?.skip) continue;
      const rowDay = dayNumber(row.date);
      const imported = existing.find((item) => !claimed.has(item.id) && item.account_id === file.accountId && item.import_id === row.importId);
      const similar = imported ? undefined : existing
        .filter((item) => !claimed.has(item.id) && Math.abs(dayNumber(item.date) - rowDay) <= DUPLICATE_WINDOW_DAYS
          && ((item.account_id === file.accountId && item.amount === row.amount) || (current?.transferAccountId !== undefined && item.account_id === current.transferAccountId && item.amount === -row.amount)))
        .sort((a, b) => Math.abs(dayNumber(a.date) - rowDay) - Math.abs(dayNumber(b.date) - rowDay))[0];
      const match = imported ?? similar;
      if (!match) continue;
      claimed.add(match.id);
      setPlan(file.id, row.rowIndex, { ...current, skip: true, tone: "warn", note: imported ? "Already in YNAB (imported earlier)" : `Possible duplicate of “${match.payee_name ?? "transaction"}” on ${match.date} in ${accountName(match.account_id)}` });
    }
  }
  return plan;
}
