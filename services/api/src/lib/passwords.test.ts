import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";

describe("local password hashing", () => {
  it("stores a salted scrypt hash and verifies only the original password", async () => {
    const password = "correct horse battery staple 2026";
    const encoded = await hashPassword(password);
    expect(encoded).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(encoded).not.toContain(password);
    expect(await verifyPassword(password, encoded)).toBe(true);
    expect(await verifyPassword("a different password", encoded)).toBe(false);
  });

  it("rejects malformed or unsupported password hashes", async () => {
    expect(await verifyPassword("anything", "bcrypt$10$invalid")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$32768$8$1$bad$bad$extra")).toBe(false);
  });
});
