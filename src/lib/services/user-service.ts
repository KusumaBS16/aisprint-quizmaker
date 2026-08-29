import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  passwordHash: string;
}

export type UpdateUserInput = Partial<CreateUserInput>;

export type CreateUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; conflict: "username" | "email" };

const USER_COLUMNS =
  "id, first_name, last_name, username, email, password_hash, created_at, updated_at";

const UPDATABLE_COLUMNS: Record<keyof UpdateUserInput, string> = {
  firstName: "first_name",
  lastName: "last_name",
  username: "username",
  email: "email",
  passwordHash: "password_hash",
};

async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  return env.DB;
}

function uniqueConflictColumn(
  error: unknown,
): "username" | "email" | undefined {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("UNIQUE constraint failed: users.username")) {
    return "username";
  }
  if (message.includes("UNIQUE constraint failed: users.email")) {
    return "email";
  }
  return undefined;
}

export async function createUser(
  input: CreateUserInput,
): Promise<CreateUserResult> {
  const db = await getDb();

  try {
    const { results } = await db
      .prepare(
        `INSERT INTO users (first_name, last_name, username, email, password_hash)
         VALUES (?1, ?2, ?3, ?4, ?5)
         RETURNING ${USER_COLUMNS}`,
      )
      .bind(
        input.firstName,
        input.lastName,
        input.username,
        input.email,
        input.passwordHash,
      )
      .all<UserRow>();

    return { ok: true, user: results[0] };
  } catch (error) {
    const conflict = uniqueConflictColumn(error);
    if (conflict) {
      return { ok: false, conflict };
    }
    throw error;
  }
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const db = await getDb();

  const { results } = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`)
    .bind(id)
    .all<UserRow>();

  return results[0];
}

export async function findUserByUsername(
  username: string,
): Promise<UserRow | undefined> {
  const db = await getDb();

  const { results } = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?1`)
    .bind(username)
    .all<UserRow>();

  return results[0];
}

export async function findUserByEmail(
  email: string,
): Promise<UserRow | undefined> {
  const db = await getDb();

  const { results } = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?1`)
    .bind(email)
    .all<UserRow>();

  return results[0];
}

export async function updateUser(
  id: string,
  updates: UpdateUserInput,
): Promise<UserRow | undefined> {
  const assignments: string[] = [];
  const values: unknown[] = [];

  // Column names come from UPDATABLE_COLUMNS, never from the caller, so the interpolation
  // below cannot carry anything a caller supplied. Values stay bound.
  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = updates[field as keyof UpdateUserInput];
    if (value === undefined) {
      continue;
    }
    values.push(value);
    assignments.push(`${column} = ?${values.length}`);
  }

  if (assignments.length === 0) {
    throw new Error("updateUser requires at least one field to update");
  }

  const db = await getDb();

  const { results } = await db
    .prepare(
      `UPDATE users
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?${values.length + 1}
       RETURNING ${USER_COLUMNS}`,
    )
    .bind(...values, id)
    .all<UserRow>();

  return results[0];
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = await getDb();

  const { results } = await db
    .prepare("DELETE FROM users WHERE id = ?1 RETURNING id")
    .bind(id)
    .all<{ id: string }>();

  return results.length > 0;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
