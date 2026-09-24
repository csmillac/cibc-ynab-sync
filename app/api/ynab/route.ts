import { NextRequest, NextResponse } from "next/server";

const YNAB_API = "https://api.ynab.com/v1";
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;

type Body = {
  action?: "plans" | "accounts" | "transactions" | "deleteTransactions";
  token?: string;
  planId?: string;
  transactions?: Array<Record<string, unknown>>;
  transactionIds?: string[];
};

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function callYnab(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${YNAB_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => null) as { error?: { detail?: string }; data?: { plans?: unknown[]; budgets?: unknown[]; accounts?: unknown[]; transaction_ids?: string[]; duplicate_import_ids?: string[] } } | null;
  if (!response.ok) {
    const detail = data?.error?.detail;
    if (response.status === 401) throw new Error("That YNAB token is invalid or has been revoked.");
    if (response.status === 429) throw new Error("YNAB’s request limit was reached. Wait a minute and try again.");
    throw new Error(typeof detail === "string" ? detail : "YNAB could not complete the request.");
  }
  return data?.data;
}

export async function POST(request: NextRequest) {
  let body: Body;
  try { body = await request.json(); } catch { return fail("The request body is invalid."); }
  const token = body.token?.trim();
  if (!token || token.length > 512) return fail("A valid YNAB access token is required.", 401);

  try {
    if (body.action === "plans") {
      const data = await callYnab("/plans", token);
      return NextResponse.json({ plans: data?.plans ?? data?.budgets ?? [] }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!body.planId || !SAFE_ID.test(body.planId)) return fail("Choose a valid YNAB plan.");
    if (body.action === "accounts") {
      const data = await callYnab(`/plans/${encodeURIComponent(body.planId)}/accounts`, token);
      return NextResponse.json({ accounts: data?.accounts ?? [] }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "transactions") {
      if (!Array.isArray(body.transactions) || body.transactions.length < 1) return fail("No transactions were provided.");
      if (body.transactions.length > 500) return fail("Import a maximum of 500 transactions at a time.");
      const data = await callYnab(`/plans/${encodeURIComponent(body.planId)}/transactions`, token, { method: "POST", body: JSON.stringify({ transactions: body.transactions }) });
      return NextResponse.json({ transaction_ids: data?.transaction_ids ?? [], duplicate_import_ids: data?.duplicate_import_ids ?? [] }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "deleteTransactions") {
      const ids = body.transactionIds;
      if (!Array.isArray(ids) || ids.length < 1) return fail("No transactions were provided.");
      if (ids.length > 500) return fail("Undo a maximum of 500 transactions at a time.");
      if (!ids.every((id) => typeof id === "string" && SAFE_ID.test(id))) return fail("One or more transaction IDs are invalid.");
      const results = await Promise.allSettled(
        ids.map((id) => callYnab(`/plans/${encodeURIComponent(body.planId!)}/transactions/${encodeURIComponent(id)}`, token, { method: "DELETE" })),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      return NextResponse.json({ deleted: results.length - failed, failed }, { headers: { "Cache-Control": "no-store" } });
    }
    return fail("Unknown YNAB action.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The YNAB request failed.", 502);
  }
}
