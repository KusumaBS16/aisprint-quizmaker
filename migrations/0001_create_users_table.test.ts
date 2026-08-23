import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Asserts what the migration file declares, not that D1 accepted it. Applying the
// migration is the only thing that proves the latter.
//
// Resolved from the Vitest root rather than `import.meta.url`, which is not a file:
// URL once Vite has transformed this module.
const sql = readFileSync(
  resolve(process.cwd(), "migrations/0001_create_users_table.sql"),
  "utf8",
);

function createTableBody(): string {
  const body = sql.match(/CREATE TABLE users \(([\s\S]*?)\n\);/)?.[1];
  if (!body) {
    throw new Error("No `CREATE TABLE users (...)` statement found");
  }
  return body;
}

function columnLines(): string[] {
  return createTableBody()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function columnDefinition(name: string): string {
  const line = columnLines().find((candidate) =>
    candidate.startsWith(`${name} `),
  );
  if (!line) {
    throw new Error(`No column definition found for "${name}"`);
  }
  return line;
}

describe("0001_create_users_table.sql", () => {
  it("declares exactly the eight columns in the PRD schema", () => {
    const names = columnLines().map((line) => line.split(/\s+/)[0]);

    expect(names).toEqual([
      "id",
      "first_name",
      "last_name",
      "username",
      "email",
      "password_hash",
      "created_at",
      "updated_at",
    ]);
  });

  it("generates the id in SQLite rather than in the application", () => {
    expect(columnDefinition("id")).toContain("PRIMARY KEY");
    expect(columnDefinition("id")).toContain(
      "DEFAULT (lower(hex(randomblob(16))))",
    );
  });

  it("requires every non-generated column", () => {
    for (const column of [
      "first_name",
      "last_name",
      "username",
      "email",
      "password_hash",
    ]) {
      expect(columnDefinition(column)).toContain("NOT NULL");
    }
  });

  it("constrains username and email to be unique", () => {
    expect(columnDefinition("username")).toContain("UNIQUE");
    expect(columnDefinition("email")).toContain("UNIQUE");
  });

  it("makes both timestamps NOT NULL and defaulted", () => {
    for (const column of ["created_at", "updated_at"]) {
      expect(columnDefinition(column)).toContain("NOT NULL");
      expect(columnDefinition(column)).toContain("DEFAULT CURRENT_TIMESTAMP");
    }
  });

  it("stores no password salt column, since the salt lives inside password_hash", () => {
    expect(sql).not.toContain("password_salt");
  });

  it("creates both named indexes on users", () => {
    expect(sql).toContain("CREATE INDEX idx_users_username ON users (username)");
    expect(sql).toContain("CREATE INDEX idx_users_email ON users (email)");
  });

  it("declares those indexes non-unique, leaving enforcement to the UNIQUE constraints", () => {
    expect(sql).not.toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
  });
});
