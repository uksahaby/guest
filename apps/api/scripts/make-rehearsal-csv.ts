// Builds a guest list worth rehearsing against.
//
//   npx tsx scripts/make-rehearsal-csv.ts 400 > rehearsal.csv
//
// Everything until now has been proven on three households, which tells
// you nothing about the things that only appear at size: how long an
// import takes, whether the scanner's bootstrap payload is still sane to
// send to a phone, whether search is usable when the list is long enough
// that scrolling is not.
//
// So this is deliberately not `Guest 1..400`. It reproduces the shapes a
// real Nigerian wedding list has, because those are what break things:
//
//   * Households, not people. "Chief & Mrs Adeyemi, 6" is one row.
//   * Yoruba, Igbo and Hausa names with the diacritics people actually
//     type, plus the apostrophes and hyphens that break naive quoting.
//   * Titles — Alhaji, Chief, Dr, Otunba, Barr. — which make display names
//     long, and long names are what overflow a phone screen at a gate.
//   * Party sizes that skew small but have a tail: most couples, some
//     families of eight.
//   * Missing phone numbers, because a third of any real list has none.
//   * Duplicate surnames in quantity, so search has to be more than a
//     first-match.
//   * A few names with commas and quotes in them, since the whole reason
//     the CSV parser was written by hand is that split(",") loses them.
import { randomInt } from "node:crypto";

const YORUBA = [
  "Adeyemi", "Adebayo", "Ogunlade", "Balogun", "Oyelaran", "Adigun",
  "Fashola", "Ajayi", "Soyinka", "Obasanjo", "Akinwande", "Onabanjo",
  "Ademola", "Olusegun", "Adeleke", "Bankole", "Oyewole", "Sanusi",
];
const IGBO = [
  "Okonkwo", "Nwosu", "Chukwu", "Okafor", "Eze", "Obi", "Nnamdi",
  "Uche", "Anyanwu", "Ikenna", "Madu", "Onyeka", "Ezeani", "Okoro",
];
const HAUSA = [
  "Abubakar", "Danjuma", "Sanusi", "Bello", "Yakubu", "Musa", "Aliyu",
  "Ibrahim", "Suleiman", "Garba", "Lawal", "Usman",
];
const SURNAMES = [...YORUBA, ...IGBO, ...HAUSA];

const TITLES = [
  "Mr & Mrs", "Mr & Mrs", "Mr & Mrs", "Mr & Mrs", // by far the commonest
  "Chief & Mrs", "Alhaji & Alhaja", "Dr & Mrs", "Engr & Mrs",
  "Otunba", "Barr.", "Pastor & Mrs", "Prof.", "Mrs", "Mr", "Miss",
];

const CATEGORIES = [
  "Bride's family", "Groom's family", "Bride's friends", "Groom's friends",
  "Church", "Work", "Neighbours", "Bride's family", "Groom's family",
];

/** Skewed small with a long tail — the shape of every real list. */
function partySize(): number {
  const r = Math.random();
  if (r < 0.42) return 2;
  if (r < 0.60) return 1;
  if (r < 0.76) return 4;
  if (r < 0.87) return 3;
  if (r < 0.94) return 5;
  if (r < 0.98) return 6;
  return randomInt(7, 11);
}

function phone(): string {
  const prefix = ["0803", "0806", "0703", "0810", "0813", "0902", "0705"][
    randomInt(0, 7)
  ];
  return `${prefix}${String(randomInt(1000000, 9999999))}`;
}

function pick<T>(xs: T[]): T {
  return xs[randomInt(0, xs.length)]!;
}

export function makeCsv(wanted = 400): string {
const rows: string[] = ['Name,No. of guests,Phone,Side,Table'];

// A handful of awkward rows first, so they are never lost in the middle
// and forgotten. These are the ones a naive parser mangles.
const awkward = [
  ['Chief (Mrs) Adenike Ogunlade, MFR', 4, phone(), "Bride's family", 'Table 1'],
  ['Mr & Mrs O’Brien-Adeyemi', 2, phone(), 'Work', 'Table 2'],
  ['Alhaji Musa "Baba" Danjuma', 6, '', "Groom's family", 'Table 2'],
  ['Dr & Dr Chukwu', 2, phone(), 'Work', ''],
  ['Mrs Ọlá Adébáyọ̀', 3, phone(), 'Church', 'Table 3'],
];

const seen = new Set<string>();
function quote(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

for (const a of awkward) rows.push(a.map(quote).join(','));

let guard = 0;
while (rows.length - 1 < wanted && guard++ < wanted * 20) {
  const title = pick(TITLES);
  const surname = pick(SURNAMES);
  const name = `${title} ${surname}`;

  // Duplicates are realistic, but not so many that the list is a handful
  // of names repeated — search needs something to actually discriminate.
  const key = name;
  if (seen.has(key) && Math.random() < 0.75) continue;
  seen.add(key);

  rows.push([
    quote(name),
    partySize(),
    // A third of a real list has no number for the household at all.
    Math.random() < 0.34 ? '' : phone(),
    quote(pick(CATEGORIES)),
    Math.random() < 0.25 ? '' : `Table ${randomInt(1, 41)}`,
  ].join(','));
}

  return rows.join('\n') + '\n';
}

// Also usable as a CLI:
//   npx tsx scripts/make-rehearsal-csv.ts 400 > rehearsal.csv
if (process.argv[1]?.endsWith('make-rehearsal-csv.ts')) {
  process.stdout.write(makeCsv(Number(process.argv[2] ?? 400)));
}
