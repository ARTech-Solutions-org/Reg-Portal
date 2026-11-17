import type { Attendee } from "./index.js";

type FilenameAttendee = Pick<Attendee, "id" | "name" | "email" | "ticketType" | "customFields">;
const encoder = new TextEncoder();

function safeFilenameStem(value: string): string {
  const cleaned = value.normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  let bytes = 0;
  let stem = "";
  for (const char of cleaned) {
    bytes += encoder.encode(char).length;
    if (bytes > 220) break;
    stem += char;
  }
  return stem.replace(/[.\s]+$/g, "").replace(/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?=\s*\.|$)/i, "_$&");
}

function fieldValue(attendee: FilenameAttendee, field: string): string {
  switch (field) {
    case "id":
    case "name":
    case "email":
    case "ticketType":
      return attendee[field] ?? "";
    default: {
      const key = field.slice("custom:".length);
      return Object.hasOwn(attendee.customFields, key) ? attendee.customFields[key] ?? "" : "";
    }
  }
}

export function badgeArchiveFilenames(attendees: FilenameAttendee[], fields: string[]): string[] {
  const used = new Set<string>();
  return attendees.map((attendee) => {
    const stem = safeFilenameStem(fields.map((field) => fieldValue(attendee, field).trim()).filter(Boolean).join(" - ")) || attendee.id;
    let filename = `${stem}.pdf`;
    for (let number = 2; used.has(filename.toLowerCase()); number += 1) {
      filename = `${stem} (${number}).pdf`;
    }
    used.add(filename.toLowerCase());
    return filename;
  });
}
