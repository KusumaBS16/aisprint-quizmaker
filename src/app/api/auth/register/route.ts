import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/password";
import { createUser, toPublicUser } from "@/lib/services/user-service";
import { registerSchema, toFieldErrors } from "@/lib/validation/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fields: toFieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { firstName, lastName, username, email, password } = parsed.data;

  try {
    const result = await createUser({
      firstName,
      lastName,
      username,
      email,
      passwordHash: await hashPassword(password),
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            result.conflict === "username"
              ? "Username already taken"
              : "Email already registered",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ user: toPublicUser(result.user) }, { status: 201 });
  } catch (error) {
    // The submitted body is deliberately not logged, so the plaintext password cannot
    // reach a log line.
    console.error("Registration failed", error);
    return NextResponse.json(
      { error: "Could not create account" },
      { status: 500 },
    );
  }
}
