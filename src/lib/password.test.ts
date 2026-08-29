import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/password";

const PASSWORD = "correct-horse-battery";

describe("hashPassword", () => {
  it("produces the four-part self-describing format", async () => {
    const hash = await hashPassword(PASSWORD);
    const parts = hash.split("$");

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2-sha256");
  });

  it("records the configured iteration count as a parseable number", async () => {
    const [, iterations] = (await hashPassword(PASSWORD)).split("$");

    expect(Number(iterations)).toBe(100000);
    expect(Number.isInteger(Number(iterations))).toBe(true);
  });

  it("uses a 16-byte salt and derives 256 bits", async () => {
    const [, , salt, key] = (await hashPassword(PASSWORD)).split("$");

    expect(Buffer.from(salt, "base64")).toHaveLength(16);
    expect(Buffer.from(key, "base64")).toHaveLength(32);
  });

  it("uses only base64 characters, so splitting on $ is unambiguous", async () => {
    const [, , salt, key] = (await hashPassword(PASSWORD)).split("$");

    expect(salt).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("never stores the plaintext anywhere in the output", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).not.toContain(PASSWORD);
    expect(Buffer.from(hash, "utf8").toString("utf8")).not.toContain(PASSWORD);
    expect(hash.toLowerCase()).not.toContain("horse");
  });

  it("gives the same password two different hashes, because the salt is per-call", async () => {
    const [first, second] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);

    expect(first).not.toBe(second);
    expect(first.split("$")[2]).not.toBe(second.split("$")[2]);
    expect(first.split("$")[3]).not.toBe(second.split("$")[3]);
  });

  it("still verifies both of those independently hashed copies", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    await expect(verifyPassword(PASSWORD, first)).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, second)).resolves.toBe(true);
  });

  it("handles a password with spaces, punctuation, and non-ASCII characters", async () => {
    const awkward = "  pässwörd with spaces & symbols: $100%  ";
    const hash = await hashPassword(awkward);

    expect(hash.split("$")).toHaveLength(4);
    await expect(verifyPassword(awkward, hash)).resolves.toBe(true);
  });

  it("does not truncate long passwords the way bcrypt would", async () => {
    const long = "a".repeat(100);
    const hash = await hashPassword(long);

    await expect(verifyPassword(long, hash)).resolves.toBe(true);
    await expect(verifyPassword("a".repeat(99), hash)).resolves.toBe(false);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects a password differing by one character", async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword("correct-horse-batterY", hash)).resolves.toBe(
      false,
    );
  });

  it("rejects an empty password against a real hash", async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("is case-sensitive about the password", async () => {
    const hash = await hashPassword("Secret123");

    await expect(verifyPassword("secret123", hash)).resolves.toBe(false);
    await expect(verifyPassword("Secret123", hash)).resolves.toBe(true);
  });

  it("verifies against the iteration count stored in the hash, not a constant", async () => {
    // Re-deriving at 1,000 iterations must not match a hash written at 100,000, which is
    // what makes future re-tuning safe for rows written under the old count.
    const hash = await hashPassword(PASSWORD);
    const retuned = hash.replace("$100000$", "$1000$");

    await expect(verifyPassword(PASSWORD, retuned)).resolves.toBe(false);
  });
});

describe("verifyPassword on a malformed stored value", () => {
  it("rejects a string with too few parts", async () => {
    await expect(verifyPassword(PASSWORD, "pbkdf2-sha256$100000")).rejects.toThrow();
  });

  it("rejects a string with too many parts", async () => {
    await expect(
      verifyPassword(PASSWORD, "pbkdf2-sha256$100000$c2FsdA==$a2V5$extra"),
    ).rejects.toThrow();
  });

  it("rejects an unknown algorithm prefix rather than guessing", async () => {
    await expect(
      verifyPassword(PASSWORD, "pbkdf2-sha512$100000$c2FsdA==$a2V5"),
    ).rejects.toThrow(/algorithm/i);
  });

  it("rejects a bcrypt hash, which this database will never contain", async () => {
    await expect(
      verifyPassword(PASSWORD, "$2b$10$abcdefghijklmnopqrstuv"),
    ).rejects.toThrow();
  });

  it("rejects a non-numeric iteration count", async () => {
    await expect(
      verifyPassword(PASSWORD, "pbkdf2-sha256$lots$c2FsdA==$a2V5"),
    ).rejects.toThrow(/iteration/i);
  });

  it("rejects a zero or negative iteration count", async () => {
    await expect(
      verifyPassword(PASSWORD, "pbkdf2-sha256$0$c2FsdA==$a2V5"),
    ).rejects.toThrow(/iteration/i);
    await expect(
      verifyPassword(PASSWORD, "pbkdf2-sha256$-5$c2FsdA==$a2V5"),
    ).rejects.toThrow(/iteration/i);
  });

  it("rejects an empty string and a plaintext-looking value", async () => {
    await expect(verifyPassword(PASSWORD, "")).rejects.toThrow();
    await expect(verifyPassword(PASSWORD, PASSWORD)).rejects.toThrow();
  });

  it("returns false rather than throwing for a truncated key of the wrong length", async () => {
    const hash = await hashPassword(PASSWORD);
    const [algorithm, iterations, salt, key] = hash.split("$");
    const truncated = [algorithm, iterations, salt, key.slice(0, 20)].join("$");

    await expect(verifyPassword(PASSWORD, truncated)).resolves.toBe(false);
  });

  it("returns false for a well-formed hash whose salt is wrong", async () => {
    const hash = await hashPassword(PASSWORD);
    const [algorithm, iterations, , key] = hash.split("$");
    const otherSalt = Buffer.from(new Uint8Array(16).fill(7)).toString("base64");

    await expect(
      verifyPassword(PASSWORD, [algorithm, iterations, otherSalt, key].join("$")),
    ).resolves.toBe(false);
  });
});
