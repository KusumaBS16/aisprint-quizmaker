import { NextResponse } from "next/server";

// A stateless acknowledgement. There is no session, token, or cookie in this sprint, so
// there is nothing to invalidate - the client's redirect to /login is what the user
// experiences as logging out. It exists so there is one honest place to call, and a
// contract already in place the day sessions arrive.
export async function POST() {
  return NextResponse.json({ success: true }, { status: 200 });
}
