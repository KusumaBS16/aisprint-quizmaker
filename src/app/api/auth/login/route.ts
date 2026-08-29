import { NextResponse } from "next/server";

import { verifyPassword } from "@/lib/password";
import { findUserByUsername, toPublicUser } from "@/lib/services/user-service";
import { loginSchema, toFieldErrors } from "@/lib/validation/auth";

// Built once and returned from both failure paths, so an unknown username and a wrong
// password cannot drift apart into an account-enumeration oracle.
function invalidCredentials() {
  return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fields: toFieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { username, password } = parsed.data;

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      return invalidCredentials();
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      return invalidCredentials();
    }

    return NextResponse.json({ user: toPublicUser(user) }, { status: 200 });
  } catch (error) {
    console.error("Login failed", error);
    return NextResponse.json({ error: "Could not sign in" }, { status: 500 });
  }
}
