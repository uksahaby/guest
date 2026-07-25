import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import { commitImport, previewImport, type Preview } from "./actions";

/**
 * "Import guests — a spreadsheet of households. One row per invitation,
 * not per person." Per mockups/organiser-setup-flow.html: upload, then
 * "Match your columns" with the guesses shown, the grouped warnings, and
 * "First few rows".
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
  expected_multipart: "Something went wrong sending the file. Try again.",
  no_legs: "That event has no parts to invite people to.",
  failed: "That import didn't run. Nothing was added.",
};

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; preview?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  let preview: Preview | null = null;
  if (sp.preview) {
    try {
      preview = JSON.parse(sp.preview) as Preview;
    } catch {
      preview = null;
    }
  }

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}/guests`} style={{ color: "inherit" }}>
          {event.name} · Guests
        </Link>
      </p>
      <h1 className="page">Import guests</h1>
      <p className="sub">
        A spreadsheet of households. One row per invitation, not per person —
        &ldquo;Mr &amp; Mrs Adeyemi, 4&rdquo; is one row. Building a list is
        free on every plan, whatever its size.
      </p>

      {sp.error && <p className="form-error">{ERRORS[sp.error] ?? ERRORS.failed}</p>}

      {!preview ? (
        <div className="card">
          <h2>Choose a file</h2>
          <form action={previewImport}>
            <input type="hidden" name="event_id" value={id} />
            <div className="form-row">
              <input
                className="field"
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
              />
              <button className="primary" type="submit">
                Read the file
              </button>
            </div>
          </form>
          <p className="sub">
            Nothing is added until you&rsquo;ve seen what we found. Headings
            like <b>Name</b>, <b>No. of guests</b>, <b>Phone</b> and{" "}
            <b>Side</b> are recognised automatically.
          </p>
        </div>
      ) : (
        <Matched eventId={id} preview={preview} />
      )}
    </>
  );
}

function Matched({ eventId, preview }: { eventId: string; preview: Preview }) {
  const warnings = preview.warning_summary ?? [];

  return (
    <>
      <div className="plan-line">
        <b>{preview.file ?? "Your file"}</b> — {preview.total_rows}{" "}
        {preview.total_rows === 1 ? "row" : "rows"} found ·{" "}
        {preview.would_import} to add ({preview.people} people)
        {preview.already_on_list > 0
          ? ` · ${preview.already_on_list} already on the list`
          : ""}
      </div>

      {/* One form so the mapping corrections and the file are submitted
          together — the file input must be re-picked because a browser will
          not let us prefill it. */}
      <form action={commitImport}>
        <input type="hidden" name="event_id" value={eventId} />

        <div className="card">
          <h2>Match your columns</h2>
          <p className="t-sub" style={{ marginBottom: 14 }}>
            We&rsquo;ve guessed from your headings. Change anything that&rsquo;s
            wrong.
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
                      name={`mapping.${i}`}
                      defaultValue={preview.mapping[String(i)] ?? "ignore"}
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
          {!preview.has_allowance_column && (
            <p className="sub">
              No party-size column was found, so every household will admit
              one person. Point a column at <b>Party size</b> above if the
              sheet has one.
            </p>
          )}
        </div>

        {warnings.length > 0 && (
          <div className="card" style={{ borderColor: "var(--warn)" }}>
            <h2 style={{ color: "var(--warn)" }}>
              {warnings.reduce((n, w) => n + w.count, 0)} rows need a second look
            </h2>
            <ul style={{ paddingLeft: 18 }}>
              {warnings.map((w) => (
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
          <h2>Confirm the file again</h2>
          <p className="sub" style={{ marginTop: 0, marginBottom: 12 }}>
            Browsers won&rsquo;t let a page hold on to a chosen file, so pick
            the same one once more and we&rsquo;ll add the{" "}
            {preview.would_import} new{" "}
            {preview.would_import === 1 ? "household" : "households"}.
          </p>
          <div className="form-row">
            <input
              className="field"
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
            />
            <button className="primary" type="submit">
              Import {preview.would_import}{" "}
              {preview.would_import === 1 ? "household" : "households"}
            </button>
            <Link className="ghost" href={`/events/${eventId}/guests/import`}>
              Start again
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
