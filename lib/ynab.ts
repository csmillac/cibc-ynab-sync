const YNAB_API = "https://api.ynab.com/v1";

export type Plan = { id: string; name: string };
export type Account = { id: string; name: string; closed?: boolean; deleted?: boolean };

type YnabData = {
  plans?: unknown[];
  budgets?: unknown[];
  accounts?: unknown[];
  transaction_ids?: string[];
  duplicate_import_ids?: string[];
};

async function callYnab(path: string, token: string, init?: RequestInit): Promise<YnabData | undefined> {
  const response = await fetch(`${YNAB_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => null) as { error?: { detail?: string }; data?: YnabData } | null;
  if (!response.ok) {
    const detail = data?.error?.detail;
    if (response.status === 401) throw new Error("That YNAB token is invalid or has been revoked.");
    if (response.status === 429) throw new Error("YNAB’s request limit was reached. Wait a minute and try again.");
    throw new Error(typeof detail === "string" ? detail : "YNAB could not complete the request.");
  }
  return data?.data;
}

function requireToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 512) throw new Error("A valid YNAB access token is required.");
  return trimmed;
}

export async function fetchPlans(token: string): Promise<Plan[]> {
  const data = await callYnab("/plans", requireToken(token));
  return (data?.plans ?? data?.budgets ?? []) as Plan[];
}

export async function fetchAccounts(token: string, planId: string): Promise<Account[]> {
  const data = await callYnab(`/plans/${encodeURIComponent(planId)}/accounts`, requireToken(token));
  return (data?.accounts ?? []) as Account[];
}

export async function postTransactions(token: string, planId: string, transactions: Array<Record<string, unknown>>): Promise<{ transaction_ids: string[]; duplicate_import_ids: string[] }> {
  if (!Array.isArray(transactions) || transactions.length < 1) throw new Error("No transactions were provided.");
  if (transactions.length > 500) throw new Error("Import a maximum of 500 transactions at a time.");
  const data = await callYnab(`/plans/${encodeURIComponent(planId)}/transactions`, requireToken(token), { method: "POST", body: JSON.stringify({ transactions }) });
  return { transaction_ids: (data?.transaction_ids ?? []) as string[], duplicate_import_ids: (data?.duplicate_import_ids ?? []) as string[] };
}

export async function deleteTransactions(token: string, planId: string, transactionIds: string[]): Promise<{ deleted: number; failed: number }> {
  if (!Array.isArray(transactionIds) || transactionIds.length < 1) throw new Error("No transactions were provided.");
  if (transactionIds.length > 500) throw new Error("Undo a maximum of 500 transactions at a time.");
  const validToken = requireToken(token);
  const results = await Promise.allSettled(
    transactionIds.map((id) => callYnab(`/plans/${encodeURIComponent(planId)}/transactions/${encodeURIComponent(id)}`, validToken, { method: "DELETE" })),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  return { deleted: results.length - failed, failed };
}
