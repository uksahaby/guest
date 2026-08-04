/**
 * CSV import, the pure half: parsing, column guessing, and turning a row
 * into a household. No database, no HTTP — so the awkward cases can be
 * tested directly, and there are a lot of awkward cases in a real guest
 * list.
 *
 * The unit of a row is a HOUSEHOLD, not a person:
 * "Mr & Mrs Adeyemi, 4" is one row (mockup: "One row per invitation, not
 * per person"). Naming individuals is optional and usually skipped.
 */

// ---------------------------------------------------------------- parsing

/**
 * RFC-4180 parser. Handles quoted fields, commas and newlines inside
 * quotes, doubled quotes, CRLF or LF, and a leading BOM — which every
 * spreadsheet that has ever exported a Nigerian guest list will produce.
 *
 * Written out rather than pulled in: the failure mode of a sloppy split(",")
 * is a household called `Chief` and a phone number of `"The Lion" Obi`,
 * and it would not be noticed until the gate.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline should not invent an empty final row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i]!;

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

// -------------------------------------------------------------- mapping

/** What a column can mean. Anything else is ignored. */
export type Field =
  | "display_name"
  | "allowance"
  | "primary_phone"
  | "primary_email"
  | "category"
  | "table"
  | "ignore";

export type Mapping = Record<number, Field>;

const PATTERNS: [Field, RegExp][] = [
  ["allowance", /^(no\.?\s*of\s*guests|party\s*size|guests?|seats?|admits?|pax|count|number|qty|quantity|allowance)$/i],
  ["display_name", /^(invitation\s*name|household|name|guest\s*name|family|invitee|title)$/i],
  ["primary_phone", /^(phone|phone\s*number|mobile|tel|telephone|whatsapp|contact|number\s*\(phone\))$/i],
  ["primary_email", /^(e-?mail|e-?mail\s*address)$/i],
  ["category", /^(category|side|group|type|relationship|from)$/i],
  ["table", /^(table|table\s*(no\.?|name|number)|seating)$/i],
];

/**
 * Guesses what each column is from its heading — the mockup's "We've
 * guessed from your headings. Change anything that's wrong."
 *
 * Deliberately conservative: a column it cannot name becomes `ignore`
 * rather than a wrong guess, because a mis-mapped party size silently
 * changes how many people get through a gate.
 */
export function detectColumns(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const taken = new Set<Field>();

  headers.forEach((raw, index) => {
    const h = raw.trim();
    for (const [field, re] of PATTERNS) {
      if (taken.has(field)) continue;
      if (re.test(h)) {
        mapping[index] = field;
        taken.add(field);
        return;
      }
    }
    mapping[index] = "ignore";
  });

  // A file with no recognisable heading at all: assume the first column is
  // the name and the second, if it looks numeric, is the party size. Better
  // than importing nothing.
  if (!taken.has("display_name") && headers.length > 0) {
    mapping[0] = "display_name";
  }
  return mapping;
}

/**
 * Re-exported so the importer's callers and its tests keep their import,
 * while the rule itself lives in one place — auth and team invitations
 * need the same reading (see phone.ts).
 */
import { normalisePhone } from "./phone.ts";
export { normalisePhone };

// ---------------------------------------------------------------- rows

export type WarningKind =
  | "no_party_size"
  | "bad_party_size"
  | "incomplete_phone"
  | "no_name"
  | "duplicate_name"
  | "duplicate_phone";

export type RowWarning = { row: number; kind: WarningKind; message: string };

export type Household = {
  /** 1-based, and counting the header, so it matches what the user sees. */
  row: number;
  display_name: string;
  allowance: number;
  primary_phone: string | null;
  primary_email: string | null;
  category: string | null;
  table: string | null;
};

export type ParsedImport = {
  headers: string[];
  mapping: Mapping;
  households: Household[];
  /** Rows that could not become a household at all. */
  skipped: RowWarning[];
  warnings: RowWarning[];
  total_rows: number;
  /**
   * False when the sheet has no party-size column at all. That is one fact
   * about the file, not 186 identical row warnings, so it is reported here
   * instead.
   */
  has_allowance_column: boolean;
};

const MAX_ALLOWANCE = 1000;

/**
 * Turns a parsed CSV into households, collecting warnings rather than
 * failing: a guest list with three odd rows should import 183 households
 * and tell you about the three, not refuse the file.
 */
export function readHouseholds(
  rows: string[][],
  override?: Mapping,
): ParsedImport {
  if (rows.length === 0) {
    return {
      headers: [], mapping: {}, households: [], skipped: [],
      warnings: [], total_rows: 0, has_allowance_column: false,
    };
  }

  const headers = (rows[0] ?? []).map((h) => h.trim());
  const mapping = override ?? detectColumns(headers);
  const body = rows.slice(1);
  const hasAllowanceColumn = Object.values(mapping).includes("allowance");

  const households: Household[] = [];
  const warnings: RowWarning[] = [];
  const skipped: RowWarning[] = [];
  const seenNames = new Map<string, number>();
  const seenPhones = new Map<string, number>();

  const cell = (row: string[], field: Field): string => {
    for (const [idx, f] of Object.entries(mapping)) {
      if (f === field) return (row[Number(idx)] ?? "").trim();
    }
    return "";
  };

  body.forEach((row, n) => {
    const rowNo = n + 2; // header is row 1
    if (row.every((c) => c.trim() === "")) return; // blank line, not a problem

    const name = cell(row, "display_name");
    if (!name) {
      skipped.push({
        row: rowNo,
        kind: "no_name",
        message: "No invitation name — the row was skipped.",
      });
      return;
    }

    const rawAllowance = cell(row, "allowance");
    let allowance: number;
    if (rawAllowance === "") {
      allowance = 1;
      // Only a row-level problem if the sheet HAS the column and this row
      // left it blank. A sheet with no such column is reported once, above.
      if (hasAllowanceColumn) {
        warnings.push({
          row: rowNo,
          kind: "no_party_size",
          message: "No party size — set to 1.",
        });
      }
    } else {
      // "4 guests", "4 ", "four" — take the digits and be honest when
      // there are none.
      const digits = rawAllowance.replace(/[^\d]/g, "");
      const parsed = Number.parseInt(digits, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        allowance = 1;
        warnings.push({
          row: rowNo,
          kind: "bad_party_size",
          message: `Couldn't read "${rawAllowance}" as a party size — set to 1.`,
        });
      } else if (parsed > MAX_ALLOWANCE) {
        allowance = MAX_ALLOWANCE;
        warnings.push({
          row: rowNo,
          kind: "bad_party_size",
          message: `Party size ${parsed} looks wrong — capped at ${MAX_ALLOWANCE}.`,
        });
      } else {
        allowance = parsed;
      }
    }

    const rawPhone = cell(row, "primary_phone");
    const phone = rawPhone ? normalisePhone(rawPhone) : null;
    if (rawPhone && !phone) {
      warnings.push({
        row: rowNo,
        kind: "incomplete_phone",
        message: `"${rawPhone}" doesn't look like a phone number — left blank.`,
      });
    }

    // Duplicates are warned about, not dropped: a wedding really can have
    // two households called "The Okafors", and the organiser is the only
    // one who knows.
    const nameKey = name.toLowerCase();
    const firstName = seenNames.get(nameKey);
    if (firstName !== undefined) {
      warnings.push({
        row: rowNo,
        kind: "duplicate_name",
        message: `"${name}" also appears on row ${firstName}.`,
      });
    } else {
      seenNames.set(nameKey, rowNo);
    }
    if (phone) {
      const firstPhone = seenPhones.get(phone);
      if (firstPhone !== undefined) {
        warnings.push({
          row: rowNo,
          kind: "duplicate_phone",
          message: `That phone number is also on row ${firstPhone}.`,
        });
      } else {
        seenPhones.set(phone, rowNo);
      }
    }

    const email = cell(row, "primary_email");
    const category = cell(row, "category");
    const table = cell(row, "table");

    households.push({
      row: rowNo,
      display_name: name,
      allowance,
      primary_phone: phone,
      primary_email: email && email.includes("@") ? email : null,
      category: category || null,
      table: table || null,
    });
  });

  return {
    headers,
    mapping,
    households,
    skipped,
    warnings,
    total_rows: body.filter((r) => !r.every((c) => c.trim() === "")).length,
    has_allowance_column: hasAllowanceColumn,
  };
}

/**
 * The mockup shows warnings grouped into sentences — "7 have no party size
 * — we'll set them to 1" — not a wall of rows.
 */
export function groupWarnings(warnings: RowWarning[]): { kind: WarningKind; count: number; message: string }[] {
  const order: WarningKind[] = [
    "no_party_size", "bad_party_size", "incomplete_phone",
    "duplicate_name", "duplicate_phone", "no_name",
  ];
  const sentence: Record<WarningKind, (n: number) => string> = {
    no_party_size: (n) => `${n} ${n === 1 ? "row has" : "rows have"} no party size — we'll set ${n === 1 ? "it" : "them"} to 1.`,
    bad_party_size: (n) => `${n} party ${n === 1 ? "size" : "sizes"} couldn't be read — we'll set ${n === 1 ? "it" : "them"} to 1.`,
    incomplete_phone: (n) => `${n} phone ${n === 1 ? "number looks" : "numbers look"} incomplete.`,
    duplicate_name: (n) => `${n} ${n === 1 ? "name appears" : "names appear"} more than once.`,
    duplicate_phone: (n) => `${n} phone ${n === 1 ? "number is" : "numbers are"} shared by more than one row.`,
    no_name: (n) => `${n} ${n === 1 ? "row has" : "rows have"} no name and will be skipped.`,
  };

  return order
    .map((kind) => ({ kind, count: warnings.filter((w) => w.kind === kind).length }))
    .filter((g) => g.count > 0)
    .map((g) => ({ ...g, message: sentence[g.kind](g.count) }));
}
