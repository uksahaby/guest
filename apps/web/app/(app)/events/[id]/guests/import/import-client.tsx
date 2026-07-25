"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * "Import guests", per mockups/organiser-setup-flow.html: upload, then
 * "Match your columns" with the guesses shown, the grouped warnings, and
 * "First few rows".
 *
 * A client component so the chosen File stays in memory between the
 * preview and the commit — a browser will not let a page prefill a file
 * input, so a server-rendered two-step flow would make the organiser pick
 * the same file twice. Client JS is fine on this surface; the no-JS rule
 * is for the guest pages, which load on a mid-range Android over Nigerian
 * mobile data.
 */

const FIELD_LABELS: [string, string][] = [
  ["display_name", "Invitation name"],
  ["allowance", "Party size"],
  ["primary_phone", "Phone number"],
  ["primary_email", "Email address"],
  ["category", "Category"],
  ["table", "Table"],
  ["ignore", "Ignore"],
];

const ERRORS: Record<string, string> = {
  no_file: "Choose a .csv file to import.",
  too_many_rows: "That file has more rows than the import handles (5,000).",
  file_too_large: "That file is over 5 MB — a guest list should be far smaller.",
  no_legs: "That event has no parts to invite people to.",
  unauthenticated: "Your session has expired — sign in again.",
  forbidden: "That isn't your event.",
};

type Preview = {
  file: string | null;
  total_rows: number;
  headers: string[];
  mapping: Record<string, string>;
  has_allowance_column: boolean;
  would_import: number;
  already_on_list: number;
  people: number;
  warning_summary: { kind: string; count: number; message: string }[];
  preview: {
    row: number;
    display_name: string;
    allowance: number;
    primary_phone: string | null;
    category: string | null;
    table: string | null;
  }[];
};

export default function ImportClient({ eventId }: { eventId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  // The File itself lives here, which is the whole point of this component.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"reading" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(body: FormData) {
    const res = await fetch(`/events/${eventId}/guests/import/upload`, {
      method: "POST",
      body,
    });
    return { status: res.status, data: await res.json() };
  }

  function fail(data: unknown) {
    const code = (data as { code?: string }).code ?? "";
    const message = (data as { message?: string }).message;
    setError(ERRORS[code] ?? message ?? "That didn't work. Nothing was added.");
  }

  async function readFile() {
    if (!file) return setError(ERRORS.no_file!);
    setBusy("reading");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("dry_run", "true");
      const { status, data } = await post(form);
      if (status !== 200) return fail(data);
      const p = data as Preview;
      setPreview(p);
      setMapping(p.mapping);
    } catch {
      setError("Couldn't reach the server. Nothing was added.");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!file) return setError(ERRORS.no_file!);
    setBusy("importing");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("mapping", JSON.stringify(mapping));
      const { status, data } = await post(form);
      if (status !== 202) return fail(data);
      const done = data as { imported: number; already_on_list: number };
      router.push(
        `/events/${eventId}/guests?imported=${done.imported}&skipped=${done.already_on_list}`,
      );
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Nothing was added.");
    } finally {
      setBusy(null);
    }
  }

  function startOver() {
    setPreview(null);
    setFile(null);
    setMapping({});
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      {error && <p className="form-error">{error}</p>}

      {!preview ? (
        <div className="card">
          <h2>Choose a file</h2>
          <div className="form-row">
            <input
              ref={fileRef}
              className="field"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <button
              className="primary"
              type="button"
              onClick={readFile}
              disabled={!file || busy !== null}
            >
              {busy === "reading" ? "Reading…" : "Read the file"}
            </button>
          </div>
          <p className="sub">
            Nothing is added until you&rsquo;ve seen what we found. Headings
            like <b>Name</b>, <b>No. of guests</b>, <b>Phone</b> and{" "}
            <b>Side</b> are recognised automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="plan-line">
            <b>{preview.file ?? file?.name}</b> — {preview.total_rows}{" "}
            {preview.total_rows === 1 ? "row" : "rows"} found ·{" "}
            {preview.would_import} to add ({preview.people}{" "}
            {preview.people === 1 ? "person" : "people"})
            {preview.already_on_list > 0
              ? ` · ${preview.already_on_list} already on the list`
              : ""}
          </div>

          <div className="card">
            <h2>Match your columns</h2>
            <p className="t-sub" style={{ marginBottom: 14 }}>
              We&rsquo;ve guessed from your headings. Change anything
              that&rsquo;s wrong.
            </p>
            <table className="list">
              <thead>
                <tr>
                  <th>Your heading</th>
                  <th>Means</th>
                </tr>
              </thead>
              <tbody>
                {preview.headers.map((h, i) => (
                  <tr key={`${h}-${i}`}>
                    <td className="t-name">{h || <em>(no heading)</em>}</td>
                    <td>
                      <select
                        className="field"
                        value={mapping[String(i)] ?? "ignore"}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [String(i)]: e.target.value }))
                        }
                      >
                        {FIELD_LABELS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!Object.values(mapping).includes("allowance") && (
              <p className="sub">
                No party-size column, so every household will admit one
                person. Point a column at <b>Party size</b> above if the sheet
                has one.
              </p>
            )}
            <div style={{ marginTop: 14 }}>
              <button
                className="ghost"
                type="button"
                onClick={readFile}
                disabled={busy !== null}
              >
                {busy === "reading" ? "Re-reading…" : "Re-read with these columns"}
              </button>
            </div>
          </div>

          {preview.warning_summary.length > 0 && (
            <div className="card" style={{ borderColor: "var(--warn)" }}>
              <h2 style={{ color: "var(--warn)" }}>
                {preview.warning_summary.reduce((n, w) => n + w.count, 0)} rows
                need a second look
              </h2>
              <ul style={{ paddingLeft: 18 }}>
                {preview.warning_summary.map((w) => (
                  <li key={w.kind} className="sub" style={{ marginTop: 4 }}>
                    {w.message}
                  </li>
                ))}
              </ul>
              <p className="sub">
                None of these stop the import — the rows come in as described,
                and you can fix any of them afterwards.
              </p>
            </div>
          )}

          <div className="card">
            <h2>First few rows</h2>
            <table className="list">
              <thead>
                <tr>
                  <th>Invitation</th>
                  <th>Party</th>
                  <th>Phone</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((r) => (
                  <tr key={r.row}>
                    <td className="t-name">{r.display_name}</td>
                    <td>{r.allowance}</td>
                    <td>{r.primary_phone ?? "—"}</td>
                    <td>{r.category ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="primary"
                type="button"
                onClick={commit}
                disabled={busy !== null || preview.would_import === 0}
              >
                {busy === "importing"
                  ? "Importing…"
                  : preview.would_import === 0
                    ? "Nothing new to import"
                    : `Import ${preview.would_import} ${
                        preview.would_import === 1 ? "household" : "households"
                      }`}
              </button>
              <button
                className="ghost"
                type="button"
                onClick={startOver}
                disabled={busy !== null}
              >
                Choose a different file
              </button>
            </div>
            {preview.already_on_list > 0 && (
              <p className="sub">
                {preview.already_on_list}{" "}
                {preview.already_on_list === 1 ? "household is" : "households are"}{" "}
                already on the list and will be left alone — importing the same
                file twice is safe.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
