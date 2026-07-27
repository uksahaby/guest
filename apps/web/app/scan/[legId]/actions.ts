"use server";

import { api } from "@/lib/org-api";

/**
 * The browser's only route to the API. Same rule as every other surface:
 * the JWT lives in an httpOnly cookie and never reaches client JavaScript,
 * so the scanner posts to these and renders what comes back.
 */

export type Decision = {
  outcome: string;
  tone: "admit" | "hold" | "deny" | "ask";
  admittedCount: number;
  headline: string;
  detail?: string;
  invitation?: { displayName: string; tableName: string | null; allowance: number };
  remaining?: number;
  choices?: number[];
  actions: string[];
};

export type ScanResult =
  | { ok: true; decision: Decision; recorded: string | null }
  | { ok: false; message: string };

export async function submitScan(
  legId: string,
  body: {
    raw?: string;
    pass_id?: string;
    client_uuid: string;
    requested_count?: number;
    entrance_id?: string | null;
  },
): Promise<ScanResult> {
  const { status, data } = await api<{ decision: Decision; recorded: string | null }>(
    `/scanner/legs/${legId}/scan`,
    { method: "POST", body },
  );
  if (status !== 200) {
    return {
      ok: false,
      message:
        status === 403
          ? "You are not on this gate."
          : "Couldn't reach the server. Check the connection and try again.",
    };
  }
  return { ok: true, decision: data.decision, recorded: data.recorded };
}

export type Guest = {
  pass_id: string;
  display_name: string;
  category: string | null;
  table_name: string | null;
  allowance: number;
  admitted: number;
};

export async function searchGuests(legId: string, q: string): Promise<Guest[]> {
  if (q.trim().length < 3) return [];
  const { status, data } = await api<{ guests: Guest[] }>(
    `/scanner/legs/${legId}/guests?q=${encodeURIComponent(q.trim())}`,
  );
  return status === 200 ? data.guests : [];
}
