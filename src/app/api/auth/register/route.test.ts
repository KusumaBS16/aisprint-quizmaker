// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { FAKE_HASH } = vi.hoisted(() => ({
  FAKE_HASH: "pbkdf2-sha256$100000$ZmFrZXNhbHQ=$ZmFrZWtleQ==",
}));

// Only the D1-touching function is replaced. toPublicUser stays real, so the assertions
// below about what does and does not reach the response are testing the actual mapper.
vi.mock("@/lib/services/user-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/user-service")>();
  return { ...actual, createUser: vi.fn() };
});

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async () => FAKE_HASH),
  verifyPassword: vi.fn(async () => true),
}));

import { hashPassword } from "@/lib/password";
import { createUser, type UserRow } from "@/lib/services/user-service";

import { POST } from "./route";

const PLAINTEXT = "correct-horse-battery";

const validBody = {
  firstName: "Kusuma",
  lastName: "Reddy",
  username: "Kusuma",
  email: "kusuma@example.com",
  password: PLAINTEXT,
};

const createdRow: UserRow = {
  id: "3f7fd8dcf39b789bc0180d39bd9ab94e",
  first_name: "Kusuma",
  last_name: "Reddy",
  username: "Kusuma",
  email: "kusuma@example.com",
  password_hash: FAKE_HASH,
  created_at: "2026-08-23 12:04:11",
  updated_at: "2026-08-23 12:04:11",
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(hashPassword).mockResolvedValue(FAKE_HASH);
  vi.mocked(createUser).mockResolvedValue({ ok: true, user: createdRow });
});

describe("POST /api/auth/register", () => {
  it("returns 201 with the user wrapped under a user key", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: createdRow.id,
        firstName: "Kusuma",
        lastName: "Reddy",
        username: "Kusuma",
        email: "kusuma@example.com",
        createdAt: "2026-08-23 12:04:11",
        updatedAt: "2026-08-23 12:04:11",
      },
    });
  });

  it("hashes the password before the service ever sees it", async () => {
    await POST(postRequest(validBody));

    expect(hashPassword).toHaveBeenCalledWith(PLAINTEXT);
    expect(createUser).toHaveBeenCalledWith({
      firstName: "Kusuma",
      lastName: "Reddy",
      username: "Kusuma",
      email: "kusuma@example.com",
      passwordHash: FAKE_HASH,
    });
  });

  it("never hands the plaintext password to the service", async () => {
    await POST(postRequest(validBody));

    expect(JSON.stringify(vi.mocked(createUser).mock.calls)).not.toContain(
      PLAINTEXT,
    );
  });

  it("keeps the username's casing and lowercases the email on the way through", async () => {
    await POST(
      postRequest({
        ...validBody,
        username: "  KusumaBS  ",
        email: "  Kusuma@Example.COM  ",
      }),
    );

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "KusumaBS",
        email: "kusuma@example.com",
      }),
    );
  });

  it("returns no password hash anywhere in a success response", async () => {
    const response = await POST(postRequest(validBody));
    const body = await response.text();

    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain(FAKE_HASH);
    expect(body).not.toContain(PLAINTEXT);
  });

  it("returns 400 Validation failed with one string per bad field", async () => {
    const response = await POST(
      postRequest({ ...validBody, email: "nope", password: "short" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Validation failed",
      fields: {
        email: "Must be a valid email address",
        password: "Must be at least 8 characters",
      },
    });
  });

  it("does not attempt to create anyone when validation fails", async () => {
    await POST(postRequest({ ...validBody, username: "ku" }));

    expect(createUser).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("returns 400 Username already taken for a username collision", async () => {
    vi.mocked(createUser).mockResolvedValue({
      ok: false,
      conflict: "username",
    });

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Username already taken",
    });
  });

  it("returns 400 Email already registered for an email collision", async () => {
    vi.mocked(createUser).mockResolvedValue({ ok: false, conflict: "email" });

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Email already registered",
    });
  });

  it("never answers a duplicate with 409", async () => {
    for (const conflict of ["username", "email"] as const) {
      vi.mocked(createUser).mockResolvedValue({ ok: false, conflict });

      const response = await POST(postRequest(validBody));

      expect(response.status).not.toBe(409);
    }
  });

  it("carries no fields object on a duplicate, so the form shows it at form level", async () => {
    vi.mocked(createUser).mockResolvedValue({
      ok: false,
      conflict: "username",
    });

    const body = await (await POST(postRequest(validBody))).json();

    expect(body).not.toHaveProperty("fields");
  });

  it("returns 500 Could not create account when the service throws", async () => {
    vi.mocked(createUser).mockRejectedValue(
      new Error("D1_ERROR: database is locked"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not create account",
    });
  });

  it("returns 500 when hashing fails, without leaking why", async () => {
    vi.mocked(hashPassword).mockRejectedValue(new Error("crypto unavailable"));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not create account",
    });
  });

  it("keeps the plaintext password out of the logs on the failure path", async () => {
    vi.mocked(createUser).mockRejectedValue(new Error("D1_ERROR: boom"));

    await POST(postRequest(validBody));

    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      PLAINTEXT,
    );
  });

  it("returns 400 Validation failed for a body that is not JSON", async () => {
    const response = await POST(postRequest("this is not json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Validation failed",
    });
    expect(createUser).not.toHaveBeenCalled();
  });
});
