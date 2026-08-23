import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  loginSchema,
  registerSchema,
  toFieldErrors,
} from "@/lib/validation/auth";

const validRegisterInput = {
  firstName: "Kusuma",
  lastName: "Reddy",
  username: "Kusuma",
  email: "kusuma@example.com",
  password: "correct-horse-battery",
};

function messagesFor(
  result: z.ZodSafeParseResult<unknown>,
  field: string,
): string[] {
  if (result.success) {
    throw new Error("Expected parsing to fail, but it succeeded");
  }
  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

function parseRegister(input: unknown) {
  return registerSchema.safeParse(input);
}

function parseLogin(input: unknown) {
  return loginSchema.safeParse(input);
}

function registerWithout(field: keyof typeof validRegisterInput) {
  const input: Record<string, unknown> = { ...validRegisterInput };
  delete input[field];
  return parseRegister(input);
}

describe("registerSchema", () => {
  it("accepts the five documented fields", () => {
    const result = parseRegister(validRegisterInput);

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(validRegisterInput);
  });

  it("trims the display names", () => {
    const result = parseRegister({
      ...validRegisterInput,
      firstName: "  Kusuma  ",
      lastName: "  Reddy  ",
    });

    expect(result.success && result.data.firstName).toBe("Kusuma");
    expect(result.success && result.data.lastName).toBe("Reddy");
  });

  it("trims the username but keeps its casing", () => {
    const result = parseRegister({
      ...validRegisterInput,
      username: "  Kusuma  ",
    });

    expect(result.success && result.data.username).toBe("Kusuma");
  });

  it("leaves a mixed-case username exactly as typed", () => {
    const result = parseRegister({ ...validRegisterInput, username: "KusumaBS" });

    expect(result.success && result.data.username).toBe("KusumaBS");
  });

  it("trims and lowercases the email", () => {
    const result = parseRegister({
      ...validRegisterInput,
      email: "  Kusuma@Example.COM  ",
    });

    expect(result.success && result.data.email).toBe("kusuma@example.com");
  });

  it("does not trim the password, since whitespace is part of it", () => {
    const result = parseRegister({
      ...validRegisterInput,
      password: "  spaces are meaningful  ",
    });

    expect(result.success && result.data.password).toBe(
      "  spaces are meaningful  ",
    );
  });

  it("drops unknown fields, so a stray confirmPassword cannot travel further", () => {
    const result = parseRegister({
      ...validRegisterInput,
      confirmPassword: "correct-horse-battery",
    });

    expect(result.success && Object.keys(result.data)).toEqual([
      "firstName",
      "lastName",
      "username",
      "email",
      "password",
    ]);
  });

  it("reports a missing first name with the documented message", () => {
    expect(messagesFor(registerWithout("firstName"), "firstName")).toContain(
      "First name is required",
    );
  });

  it("reports a missing last name with the documented message", () => {
    expect(messagesFor(registerWithout("lastName"), "lastName")).toContain(
      "Last name is required",
    );
  });

  it("reports a missing username with the documented message", () => {
    expect(messagesFor(registerWithout("username"), "username")).toContain(
      "Must be between 3 and 32 characters",
    );
  });

  it("reports a missing email with the documented message", () => {
    expect(messagesFor(registerWithout("email"), "email")).toContain(
      "Must be a valid email address",
    );
  });

  it("reports a missing password with the documented message", () => {
    expect(messagesFor(registerWithout("password"), "password")).toContain(
      "Must be at least 8 characters",
    );
  });

  it("rejects a first name that is only whitespace", () => {
    const result = parseRegister({ ...validRegisterInput, firstName: "   " });

    expect(messagesFor(result, "firstName")).toContain(
      "First name is required",
    );
  });

  it("rejects a malformed email", () => {
    const result = parseRegister({
      ...validRegisterInput,
      email: "kusuma-at-example",
    });

    expect(messagesFor(result, "email")).toContain(
      "Must be a valid email address",
    );
  });

  it("rejects a username of two characters", () => {
    const result = parseRegister({ ...validRegisterInput, username: "ku" });

    expect(messagesFor(result, "username")).toContain(
      "Must be between 3 and 32 characters",
    );
  });

  it("rejects a username that is only long enough before trimming", () => {
    const result = parseRegister({ ...validRegisterInput, username: "  ku  " });

    expect(messagesFor(result, "username")).toContain(
      "Must be between 3 and 32 characters",
    );
  });

  it("accepts a username at both length boundaries", () => {
    expect(parseRegister({ ...validRegisterInput, username: "abc" }).success).toBe(
      true,
    );
    expect(
      parseRegister({ ...validRegisterInput, username: "a".repeat(32) }).success,
    ).toBe(true);
  });

  it("rejects a username of thirty-three characters", () => {
    const result = parseRegister({
      ...validRegisterInput,
      username: "a".repeat(33),
    });

    expect(messagesFor(result, "username")).toContain(
      "Must be between 3 and 32 characters",
    );
  });

  it("accepts a username containing punctuation or an at sign", () => {
    expect(
      parseRegister({ ...validRegisterInput, username: "kusuma@example.com" })
        .success,
    ).toBe(true);
    expect(
      parseRegister({ ...validRegisterInput, username: "kusuma.b-s_16" }).success,
    ).toBe(true);
  });

  it("rejects a seven-character password and accepts an eight-character one", () => {
    expect(
      messagesFor(
        parseRegister({ ...validRegisterInput, password: "1234567" }),
        "password",
      ),
    ).toContain("Must be at least 8 characters");
    expect(
      parseRegister({ ...validRegisterInput, password: "12345678" }).success,
    ).toBe(true);
  });

  it("rejects a password over 128 characters", () => {
    const result = parseRegister({
      ...validRegisterInput,
      password: "a".repeat(129),
    });

    expect(messagesFor(result, "password")).toHaveLength(1);
  });

  it("rejects a first name over 50 characters", () => {
    const result = parseRegister({
      ...validRegisterInput,
      firstName: "a".repeat(51),
    });

    expect(messagesFor(result, "firstName")).toHaveLength(1);
  });

  it("rejects a non-string field with that field's message", () => {
    const result = parseRegister({ ...validRegisterInput, username: 12345 });

    expect(messagesFor(result, "username")).toContain(
      "Must be between 3 and 32 characters",
    );
  });

  it("rejects a body that is not an object at all", () => {
    expect(parseRegister(undefined).success).toBe(false);
    expect(parseRegister("not a body").success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts a username and password", () => {
    const result = parseLogin({ username: "Kusuma", password: "secret" });

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      username: "Kusuma",
      password: "secret",
    });
  });

  it("trims the username but keeps its casing, matching register", () => {
    const result = parseLogin({ username: "  Kusuma  ", password: "secret" });

    expect(result.success && result.data.username).toBe("Kusuma");
  });

  it("does not trim the password", () => {
    const result = parseLogin({ username: "Kusuma", password: "  secret  " });

    expect(result.success && result.data.password).toBe("  secret  ");
  });

  it("accepts a username register would have rejected, leaving the 401 to do that work", () => {
    expect(parseLogin({ username: "k", password: "secret" }).success).toBe(true);
    expect(
      parseLogin({ username: "a".repeat(64), password: "secret" }).success,
    ).toBe(true);
  });

  it("accepts a password register would have rejected", () => {
    expect(parseLogin({ username: "Kusuma", password: "short" }).success).toBe(
      true,
    );
  });

  it("rejects a missing username", () => {
    expect(messagesFor(parseLogin({ password: "secret" }), "username")).toContain(
      "Username is required",
    );
  });

  it("rejects a missing password", () => {
    expect(messagesFor(parseLogin({ username: "Kusuma" }), "password")).toContain(
      "Password is required",
    );
  });

  it("rejects an empty or whitespace-only username", () => {
    expect(
      messagesFor(parseLogin({ username: "", password: "secret" }), "username"),
    ).toContain("Username is required");
    expect(
      messagesFor(parseLogin({ username: "   ", password: "secret" }), "username"),
    ).toContain("Username is required");
  });

  it("rejects an empty password", () => {
    expect(
      messagesFor(parseLogin({ username: "Kusuma", password: "" }), "password"),
    ).toContain("Password is required");
  });

  it("has no confirmPassword and drops unknown fields", () => {
    const result = parseLogin({
      username: "Kusuma",
      password: "secret",
      confirmPassword: "secret",
    });

    expect(result.success && Object.keys(result.data)).toEqual([
      "username",
      "password",
    ]);
  });
});

describe("toFieldErrors", () => {
  it("returns one string per field, not an array", () => {
    const result = parseRegister({
      ...validRegisterInput,
      email: "nope",
      password: "short",
    });
    if (result.success) {
      throw new Error("Expected parsing to fail");
    }

    const fields = toFieldErrors(result.error);

    expect(fields).toEqual({
      email: "Must be a valid email address",
      password: "Must be at least 8 characters",
    });
    expect(typeof fields.email).toBe("string");
  });

  it("keeps the first message when one field breaks several rules", () => {
    const result = parseRegister({ ...validRegisterInput, email: "" });
    if (result.success) {
      throw new Error("Expected parsing to fail");
    }

    const fields = toFieldErrors(result.error);

    expect(fields.email).toBe("Must be a valid email address");
    expect(Object.keys(fields)).toEqual(["email"]);
  });

  it("names every failing field when the whole body is missing", () => {
    const result = parseRegister({});
    if (result.success) {
      throw new Error("Expected parsing to fail");
    }

    expect(Object.keys(toFieldErrors(result.error)).sort()).toEqual([
      "email",
      "firstName",
      "lastName",
      "password",
      "username",
    ]);
  });
});
