import { beforeEach, describe, expect, it, vi } from "vitest";

const { context } = vi.hoisted(() => ({
  context: { db: undefined as unknown },
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { DB: context.db } })),
}));

import {
  createUser,
  deleteUser,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  toPublicUser,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
  type UserRow,
} from "@/lib/services/user-service";

type Query = { sql: string; params: unknown[] };

// A statement that offers only bind() and all(). first() is deliberately absent, so a
// service that reached for it would fail with a TypeError rather than pass quietly.
function createFakeDb() {
  const queries: Query[] = [];
  const queue: Array<{ results: unknown[] } | Error> = [];

  const db = {
    prepare(sql: string) {
      const query: Query = { sql, params: [] };
      queries.push(query);

      const statement = {
        bind(...params: unknown[]) {
          query.params = params;
          return statement;
        },
        async all() {
          const next = queue.shift();
          if (next === undefined) {
            return { results: [] };
          }
          if (next instanceof Error) {
            throw next;
          }
          return next;
        },
      };

      return statement;
    },
  };

  return {
    db,
    queries,
    willReturn(rows: unknown[]) {
      queue.push({ results: rows });
    },
    willThrow(error: Error) {
      queue.push(error);
    },
    lastQuery(): Query {
      const query = queries[queries.length - 1];
      if (!query) {
        throw new Error("No statement was prepared");
      }
      return query;
    },
  };
}

let fake: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  context.db = fake.db;
});

function expectNumberedPlaceholdersOnly(sql: string) {
  expect(sql).toMatch(/\?\d/);
  expect(sql).not.toMatch(/\?(?!\d)/);
}

function setClauseOf(sql: string): string {
  const clause = sql.match(/SET([\s\S]*?)WHERE/)?.[1];
  if (!clause) {
    throw new Error(`No SET ... WHERE clause in: ${sql}`);
  }
  return clause;
}

const row: UserRow = {
  id: "3f7fd8dcf39b789bc0180d39bd9ab94e",
  first_name: "Kusuma",
  last_name: "Reddy",
  username: "Kusuma",
  email: "kusuma@example.com",
  password_hash: "pbkdf2-sha256$100000$c2FsdHNhbHQ=$a2V5a2V5a2V5",
  created_at: "2026-08-23 12:04:11",
  updated_at: "2026-08-23 12:04:11",
};

const input: CreateUserInput = {
  firstName: "Kusuma",
  lastName: "Reddy",
  username: "Kusuma",
  email: "kusuma@example.com",
  passwordHash: "pbkdf2-sha256$100000$c2FsdHNhbHQ=$a2V5a2V5a2V5",
};

function uniqueConstraintError(column: "username" | "email") {
  return new Error(
    `D1_ERROR: UNIQUE constraint failed: users.${column}: SQLITE_CONSTRAINT`,
  );
}

describe("createUser", () => {
  it("inserts the five mapped columns and returns the created row", async () => {
    fake.willReturn([row]);

    const result = await createUser(input);

    expect(result).toEqual({ ok: true, user: row });
  });

  it("binds the five values in column order", async () => {
    fake.willReturn([row]);

    await createUser(input);

    expect(fake.lastQuery().params).toEqual([
      "Kusuma",
      "Reddy",
      "Kusuma",
      "kusuma@example.com",
      "pbkdf2-sha256$100000$c2FsdHNhbHQ=$a2V5a2V5a2V5",
    ]);
  });

  it("translates camelCase input into snake_case columns", async () => {
    fake.willReturn([row]);

    await createUser(input);

    const { sql } = fake.lastQuery();
    expect(sql).toContain("INSERT INTO users");
    expect(sql).toContain("first_name");
    expect(sql).toContain("last_name");
    expect(sql).toContain("password_hash");
    expect(sql).not.toContain("firstName");
    expect(sql).not.toContain("passwordHash");
  });

  it("uses numbered placeholders and no anonymous ones", async () => {
    fake.willReturn([row]);

    await createUser(input);

    expectNumberedPlaceholdersOnly(fake.lastQuery().sql);
  });

  it("lets SQLite generate id and both timestamps", async () => {
    fake.willReturn([row]);

    await createUser(input);

    const insertColumns = fake.lastQuery().sql.match(/\(([^)]*)\)/)?.[1] ?? "";
    expect(insertColumns).not.toContain("id");
    expect(insertColumns).not.toContain("created_at");
    expect(insertColumns).not.toContain("updated_at");
  });

  it("stores the username with its original casing", async () => {
    fake.willReturn([row]);

    await createUser({ ...input, username: "Kusuma" });

    expect(fake.lastQuery().params[2]).toBe("Kusuma");
  });

  it("stores the email exactly as given, leaving lowercasing to validation", async () => {
    fake.willReturn([row]);

    await createUser({ ...input, email: "Kusuma@Example.COM" });

    expect(fake.lastQuery().params[3]).toBe("Kusuma@Example.COM");
  });

  it("binds exactly five values, so a stray plaintext password cannot reach SQL", async () => {
    fake.willReturn([row]);

    await createUser({
      ...input,
      password: "correct-horse-battery",
    } as CreateUserInput);

    const { params } = fake.lastQuery();
    expect(params).toHaveLength(5);
    expect(params).not.toContain("correct-horse-battery");
  });

  it("reports a username collision instead of throwing", async () => {
    fake.willThrow(uniqueConstraintError("username"));

    await expect(createUser(input)).resolves.toEqual({
      ok: false,
      conflict: "username",
    });
  });

  it("reports an email collision instead of throwing", async () => {
    fake.willThrow(uniqueConstraintError("email"));

    await expect(createUser(input)).resolves.toEqual({
      ok: false,
      conflict: "email",
    });
  });

  it("rethrows a unique failure on a column it does not know about", async () => {
    const error = new Error(
      "D1_ERROR: UNIQUE constraint failed: users.phone_number",
    );
    fake.willThrow(error);

    await expect(createUser(input)).rejects.toBe(error);
  });

  it("rethrows a non-unique constraint failure rather than calling it a duplicate", async () => {
    const error = new Error(
      "D1_ERROR: NOT NULL constraint failed: users.password_hash",
    );
    fake.willThrow(error);

    await expect(createUser(input)).rejects.toBe(error);
  });

  it("rethrows an unrecognised database error untouched", async () => {
    const error = new Error("D1_ERROR: database is locked");
    fake.willThrow(error);

    await expect(createUser(input)).rejects.toBe(error);
  });
});

describe("findUserByUsername", () => {
  it("returns the matching row", async () => {
    fake.willReturn([row]);

    await expect(findUserByUsername("Kusuma")).resolves.toEqual(row);
  });

  it("selects password_hash, which login needs to verify against", async () => {
    fake.willReturn([row]);

    await findUserByUsername("Kusuma");

    const { sql } = fake.lastQuery();
    expect(sql).toContain("password_hash");
    expect(sql).toContain("WHERE username = ?1");
    expectNumberedPlaceholdersOnly(sql);
  });

  it("returns undefined for an unknown username rather than throwing", async () => {
    fake.willReturn([]);

    await expect(findUserByUsername("nobody")).resolves.toBeUndefined();
  });

  it("looks up the username as given, without lowercasing it", async () => {
    fake.willReturn([]);

    await findUserByUsername("Kusuma");

    expect(fake.lastQuery().params).toEqual(["Kusuma"]);
  });
});

describe("findUserById", () => {
  it("returns the matching row", async () => {
    fake.willReturn([row]);

    await expect(findUserById(row.id)).resolves.toEqual(row);
  });

  it("queries on the primary key", async () => {
    fake.willReturn([row]);

    await findUserById(row.id);

    const { sql, params } = fake.lastQuery();
    expect(sql).toContain("WHERE id = ?1");
    expect(params).toEqual([row.id]);
    expectNumberedPlaceholdersOnly(sql);
  });

  it("returns undefined for an unknown id", async () => {
    fake.willReturn([]);

    await expect(findUserById("no-such-id")).resolves.toBeUndefined();
  });
});

describe("findUserByEmail", () => {
  it("returns the matching row", async () => {
    fake.willReturn([row]);

    await expect(findUserByEmail("kusuma@example.com")).resolves.toEqual(row);
  });

  it("queries on the email column", async () => {
    fake.willReturn([row]);

    await findUserByEmail("kusuma@example.com");

    const { sql, params } = fake.lastQuery();
    expect(sql).toContain("WHERE email = ?1");
    expect(params).toEqual(["kusuma@example.com"]);
    expectNumberedPlaceholdersOnly(sql);
  });

  it("returns undefined for an unknown email", async () => {
    fake.willReturn([]);

    await expect(findUserByEmail("nobody@example.com")).resolves.toBeUndefined();
  });

  it("passes the email through unchanged, since normalising it is validation's job", async () => {
    fake.willReturn([]);

    await findUserByEmail("Kusuma@Example.COM");

    expect(fake.lastQuery().params).toEqual(["Kusuma@Example.COM"]);
  });
});

describe("updateUser", () => {
  it("returns the updated row", async () => {
    fake.willReturn([{ ...row, first_name: "Kusuma Devi" }]);

    await expect(
      updateUser(row.id, { firstName: "Kusuma Devi" }),
    ).resolves.toEqual({ ...row, first_name: "Kusuma Devi" });
  });

  it("sets only the columns it was given and leaves the rest alone", async () => {
    fake.willReturn([row]);

    await updateUser(row.id, { firstName: "Kusuma Devi" });

    const clause = setClauseOf(fake.lastQuery().sql);
    expect(clause).toContain("first_name = ?1");
    expect(clause).not.toContain("last_name");
    expect(clause).not.toContain("username");
    expect(clause).not.toContain("email");
    expect(clause).not.toContain("password_hash");
  });

  it("always stamps updated_at, from the database clock rather than a bound value", async () => {
    fake.willReturn([row]);

    await updateUser(row.id, { firstName: "Kusuma Devi" });

    const { sql, params } = fake.lastQuery();
    expect(setClauseOf(sql)).toContain("updated_at = CURRENT_TIMESTAMP");
    expect(params).toEqual(["Kusuma Devi", row.id]);
  });

  it("numbers placeholders across several fields plus the id", async () => {
    fake.willReturn([row]);

    await updateUser(row.id, {
      firstName: "Kusuma Devi",
      email: "new@example.com",
    });

    const { sql, params } = fake.lastQuery();
    expect(setClauseOf(sql)).toContain("first_name = ?1");
    expect(setClauseOf(sql)).toContain("email = ?2");
    expect(sql).toContain("WHERE id = ?3");
    expect(params).toEqual(["Kusuma Devi", "new@example.com", row.id]);
    expectNumberedPlaceholdersOnly(sql);
  });

  it("keeps the username's casing on update too", async () => {
    fake.willReturn([row]);

    await updateUser(row.id, { username: "KusumaBS" });

    expect(fake.lastQuery().params).toEqual(["KusumaBS", row.id]);
  });

  it("ignores fields that are not updatable columns", async () => {
    fake.willReturn([row]);

    await updateUser(row.id, {
      firstName: "Kusuma Devi",
      id: "hijacked",
      createdAt: "1999-01-01 00:00:00",
    } as UpdateUserInput);

    const { sql, params } = fake.lastQuery();
    expect(setClauseOf(sql)).not.toContain("created_at");
    expect(params).toEqual(["Kusuma Devi", row.id]);
  });

  it("returns undefined for an id that matches nothing, rather than inventing a row", async () => {
    fake.willReturn([]);

    await expect(
      updateUser("no-such-id", { firstName: "Ghost" }),
    ).resolves.toBeUndefined();
  });

  it("refuses an empty update instead of quietly touching updated_at", async () => {
    await expect(updateUser(row.id, {})).rejects.toThrow(
      /at least one field/i,
    );
    expect(fake.queries).toHaveLength(0);
  });
});

describe("deleteUser", () => {
  it("deletes by id and reports that a row went", async () => {
    fake.willReturn([{ id: row.id }]);

    await expect(deleteUser(row.id)).resolves.toBe(true);

    const { sql, params } = fake.lastQuery();
    expect(sql).toContain("DELETE FROM users");
    expect(sql).toContain("WHERE id = ?1");
    expect(params).toEqual([row.id]);
    expectNumberedPlaceholdersOnly(sql);
  });

  it("is harmless for an id that does not exist", async () => {
    fake.willReturn([]);

    await expect(deleteUser("no-such-id")).resolves.toBe(false);
  });
});

describe("toPublicUser", () => {
  it("maps the row onto the seven public fields", () => {
    expect(toPublicUser(row)).toEqual({
      id: row.id,
      firstName: "Kusuma",
      lastName: "Reddy",
      username: "Kusuma",
      email: "kusuma@example.com",
      createdAt: "2026-08-23 12:04:11",
      updatedAt: "2026-08-23 12:04:11",
    });
  });

  it("omits password_hash even though the row it was given carries one", () => {
    const publicUser = toPublicUser(row);

    expect(Object.keys(publicUser)).not.toContain("password_hash");
    expect(Object.keys(publicUser)).not.toContain("passwordHash");
    expect(JSON.stringify(publicUser)).not.toContain(row.password_hash);
  });

  it("cannot leak a column added by a later migration", () => {
    const publicUser = toPublicUser({
      ...row,
      phone_number: "+91 555 0100",
    } as UserRow);

    expect(Object.keys(publicUser)).toEqual([
      "id",
      "firstName",
      "lastName",
      "username",
      "email",
      "createdAt",
      "updatedAt",
    ]);
    expect(JSON.stringify(publicUser)).not.toContain("555 0100");
  });

  it("preserves the username's casing on the way out", () => {
    expect(toPublicUser({ ...row, username: "KusumaBS" }).username).toBe(
      "KusumaBS",
    );
  });
});
