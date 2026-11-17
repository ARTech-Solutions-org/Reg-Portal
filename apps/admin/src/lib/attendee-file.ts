import { attendeeImportSchema, customFieldKeySchema, type ImportedAttendee } from "@eventdesk/contracts";

type StandardColumn = "name" | "email" | "ticketType";

const standardColumns = new Map<string, StandardColumn>([
  ["name", "name"],
  ["email", "email"],
  ["tickettype", "ticketType"],
]);

export interface AttendeeFile {
  name: string;
  columns: string[];
  preview: string[][];
  attendees: ImportedAttendee[];
}

export async function readAttendeeFile(file: File): Promise<AttendeeFile> {
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error("Choose a CSV, XLSX or XLS file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose a file smaller than 10 MB.");

  const { read, utils } = await import("xlsx");
  const workbook = read(await file.arrayBuffer(), { raw: true, sheets: 0 });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName === undefined ? undefined : workbook.Sheets[sheetName];
  if (!sheet?.["!ref"]) throw new Error("The file is empty.");
  const range = utils.decode_range(sheet["!ref"]);
  if (range.e.c - range.s.c >= 33 || range.e.r - range.s.r > 5000) {
    throw new Error("Keep the first sheet within 500 attendees and 33 columns.");
  }

  const rows = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  const [header = [], ...records] = rows;
  const columns = header.map((cell) => cell.trim());
  if (!records.length) throw new Error("Add at least one attendee below the column names.");

  const seen = new Set<string>();
  const mappings = columns.map((label, index) => {
    if (!label) {
      if (records.some((row) => (row[index] ?? "").trim())) {
        throw new Error(`Column ${index + 1} needs a name in the header row.`);
      }
      return null;
    }
    const field = standardColumns.get(label.toLowerCase().replace(/[\s_-]+/g, ""));
    const key = field ?? customFieldKeySchema.parse(label);
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) throw new Error(`Column “${label}” appears more than once.`);
    seen.add(normalized);
    return { label, index, key, field };
  }).filter((column) => column !== null);

  if (records.length > 500) throw new Error("Import up to 500 attendees at a time.");
  const attendees = records.map((row) => {
    const standard: Partial<Record<StandardColumn, string>> = {};
    const custom: Array<[string, string]> = [];
    for (const { index, key, field } of mappings) {
      const value = row[index] ?? "";
      if (value.includes("\u0000")) throw new Error("The file contains an unsupported null character.");
      if (field) standard[field] = value.trim();
      else custom.push([key, value]);
    }
    return { ...standard, customFields: Object.fromEntries(custom) };
  });
  const validated = attendeeImportSchema.safeParse({ attendees });
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const row = issue?.path[1];
    throw new Error(`${typeof row === "number" ? `Attendee ${row + 1}: ` : ""}${issue?.message ?? "Check the spreadsheet values."}`);
  }
  if (new Blob([JSON.stringify(validated.data)]).size > 4 * 1024 * 1024) {
    throw new Error("The attendee data is too large. Split the file into smaller imports.");
  }

  return {
    name: file.name,
    columns: mappings.map(({ label }) => label),
    preview: records.slice(0, 5).map((row) => mappings.map(({ index }) => row[index] ?? "")),
    attendees: validated.data.attendees,
  };
}
