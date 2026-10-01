import { describe, expect, it } from "vitest";
import { eventTableNames, projectSchemaName, quoteIdentifier } from "./tenant-identifiers.js";
import { decryptScannerLinkToken, decryptToken, encryptScannerLinkToken, encryptToken } from "../lib/tokens.js";

describe("tenant identifiers", () => {
  const projectId = "2d63b1ca-19e1-4a2f-9587-5d574bc91234";
  const eventId = "06ae1e46-78c5-4db4-b090-e36112ca7311";

  it("produces stable event-isolated schema and table names", () => {
    expect(projectSchemaName(projectId)).toBe("project_2d63b1ca19e14a2f95875d574bc91234");
    expect(eventTableNames(eventId)).toEqual({ attendees: "attendees_06ae1e4678c54db4b090e36112ca7311", checkins: "checkins_06ae1e4678c54db4b090e36112ca7311" });
  });
  it("rejects untrusted IDs and unsafe SQL identifiers", () => {
    expect(() => projectSchemaName("project_x; DROP SCHEMA public")).toThrow();
    expect(() => eventTableNames("../../public.organizers")).toThrow();
    expect(() => quoteIdentifier("public.events; DROP TABLE organizers")).toThrow("Unsafe PostgreSQL identifier.");
  });
  it("quotes a generated identifier for dynamic PostgreSQL DDL", () => {
    expect(quoteIdentifier("project_abc123")).toBe('\"project_abc123\"');
  });
  it("encrypts bearer QR credentials for reprint without storing plaintext", () => {
    process.env.SESSION_SECRET = "test-only-session-key-with-enough-entropy-to-exercise-qr-cipher";
    const token = "eventdesk-test-qr-token-1234567890";
    const ciphertext = encryptToken(token);
    expect(ciphertext).not.toContain(token);
    expect(decryptToken(ciphertext)).toBe(token);
    const pieces = ciphertext.split(".");
    expect(() => decryptToken(`${pieces[0]}.${pieces[1]}.${pieces[2]}.AAAA`)).toThrow();
  });

  it("encrypts scanner-link copy credentials with a separate authenticated key purpose", () => {
    process.env.SESSION_SECRET = "test-only-session-key-with-enough-entropy-to-exercise-qr-cipher";
    const token = "eventdesk-test-scanner-token-1234567890";
    const ciphertext = encryptScannerLinkToken(token);
    expect(ciphertext).not.toContain(token);
    expect(ciphertext.startsWith("sc1.")).toBe(true);
    expect(decryptScannerLinkToken(ciphertext)).toBe(token);
    expect(() => decryptToken(ciphertext)).toThrow();
    const pieces = ciphertext.split(".");
    expect(() => decryptScannerLinkToken(`${pieces[0]}.${pieces[1]}.${pieces[2]}.AAAA`)).toThrow();
  });
});
