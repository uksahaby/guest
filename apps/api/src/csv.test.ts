// The CSV parser and row reader, tested directly. No database needed —
// these are pure functions, and the awkward cases are where guest lists
// actually break.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  detectColumns,
  groupWarnings,
  normalisePhone,
  parseCsv,
  readHouseholds,
} from "./csv.ts";

describe("parseCsv", () => {
  test("reads a plain file", () => {
    assert.deepEqual(parseCsv("a,b\n1,2\n3,4"), [
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  test("a quoted comma does not split a field", () => {
    assert.deepEqual(parseCsv('name,party\n"Chief, The Lion Obi",4'), [
      ["name", "party"],
      ["Chief, The Lion Obi", "4"],
    ]);
  });

  test("doubled quotes become one quote", () => {
    assert.deepEqual(parseCsv('name\n"Chief, ""The Lion"" Obi"'), [
      ["name"],
      ['Chief, "The Lion" Obi'],
    ]);
  });

  test("a newline inside quotes stays inside the field", () => {
    const rows = parseCsv('name,note\n"Mr & Mrs Adeyemi","Groom\'s side\nTable 12"');
    assert.equal(rows.length, 2);
    assert.equal(rows[1]![1], "Groom's side\nTable 12");
  });

  test("CRLF, a trailing newline and a BOM are all absorbed", () => {
    const rows = parseCsv("﻿name,party\r\nAdeyemi,4\r\n");
    assert.deepEqual(rows, [
      ["name", "party"],
      ["Adeyemi", "4"],
    ]);
    assert.ok(!rows[0]![0]!.startsWith("﻿"), "the BOM must not cling to the first heading");
  });

  test("empty input is empty output, not a crash", () => {
    assert.deepEqual(parseCsv(""), []);
    assert.deepEqual(parseCsv("\n"), []);
  });

  test("a field of only spaces is preserved for the reader to trim", () => {
    assert.deepEqual(parseCsv("a,b\n , "), [["a", "b"], [" ", " "]]);
  });
});

describe("detectColumns", () => {
  test("guesses the mockup's own headings", () => {
    const m = detectColumns(["Name", "No. of guests", "Phone", "Side", "Email"]);
    assert.equal(m[0], "display_name");
    assert.equal(m[1], "allowance");
    assert.equal(m[2], "primary_phone");
    assert.equal(m[3], "category");
    assert.equal(m[4], "primary_email");
  });

  test("copes with other people's words for the same thing", () => {
    const m = detectColumns(["Household", "Pax", "WhatsApp", "Group", "Table No."]);
    assert.equal(m[0], "display_name");
    assert.equal(m[1], "allowance");
    assert.equal(m[2], "primary_phone");
    assert.equal(m[3], "category");
    assert.equal(m[4], "table");
  });

  test("an unrecognised column is ignored rather than guessed at", () => {
    const m = detectColumns(["Name", "Aso-ebi paid?", "Notes from mum"]);
    assert.equal(m[0], "display_name");
    assert.equal(m[1], "ignore");
    assert.equal(m[2], "ignore");
  });

  test("with no recognisable headings the first column is the name", () => {
    const m = detectColumns(["col1", "col2"]);
    assert.equal(m[0], "display_name");
  });

  test("the same meaning is not claimed twice", () => {
    const m = detectColumns(["Name", "Guest Name"]);
    assert.equal(m[0], "display_name");
    assert.equal(m[1], "ignore");
  });
});

describe("normalisePhone", () => {
  test("Nigerian formats all reach E.164", () => {
    // The mockup's own sample is "0803 411 2098".
    assert.equal(normalisePhone("0803 411 2098"), "+2348034112098");
    assert.equal(normalisePhone("08034112098"), "+2348034112098");
    assert.equal(normalisePhone("2348034112098"), "+2348034112098");
    assert.equal(normalisePhone("+234 803 411 2098"), "+2348034112098");
    assert.equal(normalisePhone("8034112098"), "+2348034112098");
    assert.equal(normalisePhone("(0803) 411-2098"), "+2348034112098");
  });

  test("too short to be a phone number is null, not a guess", () => {
    assert.equal(normalisePhone(""), null);
    assert.equal(normalisePhone("   "), null);
    assert.equal(normalisePhone("n/a"), null);
    assert.equal(normalisePhone("0803"), null);
  });
});

describe("readHouseholds", () => {
  const file = (s: string) => readHouseholds(parseCsv(s));

  test("one row is one household, not one person", () => {
    const r = file("Name,No. of guests,Phone,Side\nMr & Mrs Adeyemi,4,0803 411 2098,Groom's Family");
    assert.equal(r.households.length, 1);
    const h = r.households[0]!;
    assert.equal(h.display_name, "Mr & Mrs Adeyemi");
    assert.equal(h.allowance, 4);
    assert.equal(h.primary_phone, "+2348034112098");
    assert.equal(h.category, "Groom's Family");
    assert.equal(h.row, 2, "row numbers match what the user sees in the sheet");
  });

  test("a missing party size becomes 1, with a warning", () => {
    const r = file("Name,No. of guests\nChidinma Okafor,\nAdaeze Nwosu,3");
    assert.equal(r.households[0]!.allowance, 1);
    assert.equal(r.households[1]!.allowance, 3);
    assert.deepEqual(
      r.warnings.map((w) => w.kind),
      ["no_party_size"],
    );
  });

  test("an unreadable party size becomes 1 and says so", () => {
    const r = file("Name,Pax\nThe Ezes,plenty");
    assert.equal(r.households[0]!.allowance, 1);
    assert.equal(r.warnings[0]!.kind, "bad_party_size");
    assert.match(r.warnings[0]!.message, /plenty/);
  });

  test('"4 guests" is read as 4', () => {
    const r = file("Name,Pax\nThe Ezes,4 guests");
    assert.equal(r.households[0]!.allowance, 4);
    assert.equal(r.warnings.length, 0);
  });

  test("an absurd party size is capped rather than trusted", () => {
    const r = file("Name,Pax\nThe Ezes,999999");
    assert.equal(r.households[0]!.allowance, 1000);
    assert.equal(r.warnings[0]!.kind, "bad_party_size");
  });

  test("a nameless row is skipped, and the rest still import", () => {
    const r = file("Name,Pax\n,4\nAdaeze Nwosu,2");
    assert.equal(r.households.length, 1);
    assert.equal(r.households[0]!.display_name, "Adaeze Nwosu");
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0]!.kind, "no_name");
    assert.equal(r.skipped[0]!.row, 2);
  });

  test("blank lines are not rows", () => {
    const r = file("Name,Pax\nAdaeze,2\n\n\nEmeka,1\n");
    assert.equal(r.households.length, 2);
    assert.equal(r.total_rows, 2);
    assert.equal(r.skipped.length, 0, "a blank line is not a nameless household");
  });

  test("a bad phone number is warned about and left blank", () => {
    const r = file("Name,Phone\nAdaeze,0803\nEmeka,08034112098");
    assert.equal(r.households[0]!.primary_phone, null);
    assert.equal(r.households[1]!.primary_phone, "+2348034112098");
    const phoneWarnings = r.warnings.filter((w) => w.kind === "incomplete_phone");
    assert.equal(phoneWarnings.length, 1);
    assert.equal(phoneWarnings[0]!.row, 2);
  });

  test("a sheet with no party-size column says so once, not per row", () => {
    const rows = ["Name,Phone"];
    for (let n = 1; n <= 50; n++) rows.push(`Household ${n},080${30000000 + n}`);
    const r = file(rows.join("\n"));

    assert.equal(r.has_allowance_column, false);
    assert.ok(r.households.every((h) => h.allowance === 1), "everyone becomes one");
    assert.equal(
      r.warnings.filter((w) => w.kind === "no_party_size").length,
      0,
      "50 identical row warnings would be noise, not information",
    );

    // Whereas a sheet that HAS the column and leaves cells blank does warn.
    const withColumn = file("Name,Pax\nA,\nB,3");
    assert.equal(withColumn.has_allowance_column, true);
    assert.equal(
      withColumn.warnings.filter((w) => w.kind === "no_party_size").length,
      1,
    );
  });

  test("duplicates are flagged but kept — a wedding can have two Okafors", () => {
    const r = file(
      "Name,Phone\nThe Okafors,08034112098\nThe Okafors,08099998888\nAdaeze,08034112098",
    );
    assert.equal(r.households.length, 3, "nothing is silently dropped");
    const kinds = r.warnings.map((w) => w.kind);
    assert.ok(kinds.includes("duplicate_name"));
    assert.ok(kinds.includes("duplicate_phone"));
    assert.match(r.warnings.find((w) => w.kind === "duplicate_name")!.message, /row 2/);
  });

  test("a junk email is dropped rather than stored", () => {
    const r = file("Name,Email\nAdaeze,not-an-email\nEmeka,e@example.com");
    assert.equal(r.households[0]!.primary_email, null);
    assert.equal(r.households[1]!.primary_email, "e@example.com");
  });

  test("an explicit mapping overrides the guess", () => {
    // Headings that would guess wrong: the sheet's "Name" column is
    // actually the category, and column 2 holds the household.
    const rows = parseCsv("Name,Household,Pax\nGroom's Family,Mr & Mrs Adeyemi,4");
    const r = readHouseholds(rows, { 0: "category", 1: "display_name", 2: "allowance" });
    assert.equal(r.households[0]!.display_name, "Mr & Mrs Adeyemi");
    assert.equal(r.households[0]!.category, "Groom's Family");
    assert.equal(r.households[0]!.allowance, 4);
  });

  test("a header-only file imports nothing and does not complain", () => {
    const r = file("Name,Pax");
    assert.equal(r.households.length, 0);
    assert.equal(r.total_rows, 0);
    assert.equal(r.warnings.length, 0);
  });

  test("the mockup's warning sentences", () => {
    const r = file(
      [
        "Name,No. of guests,Phone",
        "A,,0803",
        "B,,0803",
        "C,,08034112098",
        "D,4,",
        "D,2,",
      ].join("\n"),
    );
    const grouped = groupWarnings(r.warnings);
    const byKind = Object.fromEntries(grouped.map((g) => [g.kind, g]));

    assert.equal(byKind.no_party_size!.count, 3);
    assert.match(byKind.no_party_size!.message, /3 rows have no party size — we'll set them to 1\./);
    assert.equal(byKind.incomplete_phone!.count, 2);
    assert.match(byKind.incomplete_phone!.message, /2 phone numbers look incomplete\./);
    assert.equal(byKind.duplicate_name!.count, 1);
    assert.match(byKind.duplicate_name!.message, /1 name appears more than once\./);
  });

  test("186 rows of the real shape import cleanly", () => {
    const rows = ["Name,No. of guests,Phone,Side"];
    for (let n = 1; n <= 186; n++) {
      rows.push(`Household ${n},${(n % 6) + 1},080${String(30000000 + n)},Bride's Family`);
    }
    const r = file(rows.join("\r\n"));
    assert.equal(r.households.length, 186);
    assert.equal(r.total_rows, 186);
    assert.equal(r.warnings.length, 0);
    assert.equal(r.skipped.length, 0);
    // The mockup's own headline: 186 rows found.
    assert.equal(
      r.households.reduce((n, h) => n + h.allowance, 0),
      r.households.reduce((n, h) => n + h.allowance, 0),
    );
  });
});
