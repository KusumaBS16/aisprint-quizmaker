// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The one test that spans both routes. D1 is mocked, hashing is not: register's output is fed
// to login as if it had been written to and read back from the users table. If the two routes
// ever disagree about the stored format, this is the test that notices.
vi.mock("@/lib/services/user-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/user-service")>();
  return {
    ...actual,
    createUser: vi.fn(),
    findUserByUsername: vi.fn(),
  };
});

import {
  createUser,
  findUserByUsername,
  type UserRow,
} from "@/lib/services/user-service";

import { POST as loginPOST } from "./login/route";
import { POST as registerPOST } from "./register/route";

const PLAINTEXT = "correct-horse-battery";

const registration = {
  firstName: "Kusuma",
  lastName: "Reddy",
  username: "Kusuma",
  email: "kusuma@example.com",
  password: PLAINTEXT,
};

function postRequest(path: string, body: unknown) {
  return new Request(`http://localhost/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Registers, then stands in for D1 by returning exactly the row register asked to have written.
async function registerAndPersist(): Promise<UserRow> {
  let written: UserRow | undefined;

  vi.mocked(createUser).mockImplementation(async (input) => {
    written = {
      id: "3f7fd8dcf39b789bc0180d39bd9ab94e",
      first_name: input.firstName,
      last_name: input.lastName,
      username: input.username,
      email: input.email,
      password_hash: input.passwordHash,
      created_at: "2026-08-23 12:04:11",
      updated_at: "2026-08-23 12:04:11",
    };
    return { ok: true, user: written };
  });

  const response = await registerPOST(postRequest("register", registration));
  expect(response.status).toBe(201);

  if (!written) {
    throw new Error("register did not call createUser");
  }

  vi.mocked(findUserByUsername).mockResolvedValue(written);
  return written;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("register then login", () => {
  it("logs in with the password that was just registered", async () => {
    await registerAndPersist();

    const response = await loginPOST(
      postRequest("login", { username: "Kusuma", password: PLAINTEXT }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: expect.objectContaining({
        username: "Kusuma",
        email: "kusuma@example.com",
      }),
    });
  });

  it("rejects any other password against that same stored hash", async () => {
    await registerAndPersist();

    const response = await loginPOST(
      postRequest("login", { username: "Kusuma", password: `${PLAINTEXT}x` }),
    );

    expect(response.status).toBe(401);
  });

  it("stores a hash rather than the password that was submitted", async () => {
    const row = await registerAndPersist();

    expect(row.password_hash).not.toContain(PLAINTEXT);
    expect(row.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
  });

  it("is case-sensitive about the username, as the sprint decided", async () => {
    await registerAndPersist();
    vi.mocked(findUserByUsername).mockResolvedValue(undefined);

    const response = await loginPOST(
      postRequest("login", { username: "kusuma", password: PLAINTEXT }),
    );

    expect(response.status).toBe(401);
    expect(findUserByUsername).toHaveBeenLastCalledWith("kusuma");
  });
});
