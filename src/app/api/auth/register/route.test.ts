// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the D1-touching function is replaced. toPublicUser stays real, so the assertions
// below about what does and does not reach the response are testing the actual mapper, and
// @/lib/password is not mocked at all - Phase 4 hashing runs for real in these tests.
vi.mock("@/lib/services/user-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/user-service")>();
  return { ...actual, createUser: vi.fn() };
});

import { hashPassword, verifyPassword } from "@/lib/password";
import { createUser, type UserRow } from "@/lib/services/user-service";

import { POST } from "./route";

const PLAINTEXT = "correct-horse-battery";
const HASH_FORMAT = /^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

// A real hash, produced by the module under test rather than a stand-in string.
const REAL_HASH = await hashPassword(PLAINTEXT);

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
  password_hash: REAL_HASH,
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

function passwordHashSentToService(): string {
  const [call] = vi.mocked(createUser).mock.calls;
  return call[0].passwordHash;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
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

  it("hands the service a real PBKDF2 hash, not the plaintext", async () => {
    await POST(postRequest(validBody));

    expect(createUser).toHaveBeenCalledWith({
      firstName: "Kusuma",
      lastName: "Reddy",
      username: "Kusuma",
      email: "kusuma@example.com",
      passwordHash: expect.stringMatching(HASH_FORMAT),
    });
  });

  it("hands the service a hash the submitted password verifies against", async () => {
    await POST(postRequest(validBody));

    const stored = passwordHashSentToService();
    await expect(verifyPassword(PLAINTEXT, stored)).resolves.toBe(true);
    await expect(verifyPassword("not-the-password", stored)).resolves.toBe(
      false,
    );
  });

  it("salts per registration, so two identical passwords are stored differently", async () => {
    await POST(postRequest(validBody));
    const first = passwordHashSentToService();

    vi.clearAllMocks();
    vi.mocked(createUser).mockResolvedValue({ ok: true, user: createdRow });
    await POST(postRequest({ ...validBody, username: "Someone" }));
    const second = passwordHashSentToService();

    expect(first).not.toBe(second);
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
    expect(body).not.toContain(REAL_HASH);
    expect(body).not.toContain(PLAINTEXT);
    expect(body).not.toContain("pbkdf2");
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
