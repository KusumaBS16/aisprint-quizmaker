import { NextResponse } from "next/server";

import { createQuestion, listQuestions } from "@/lib/services/mcq-service";
import { toFieldErrors } from "@/lib/validation/auth";
import { questionSchema } from "@/lib/validation/mcq";

export async function GET() {
  try {
    const questions = await listQuestions();
    return NextResponse.json({ questions }, { status: 200 });
  } catch (error) {
    console.error("Listing questions failed", error);
    return NextResponse.json(
      { error: "Could not load questions" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const parsed = questionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fields: toFieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  try {
    // parsed.data only, never the raw body: Zod has stripped anything the caller added,
    // so an id or a created_by sent from the client cannot reach the service.
    const question = await createQuestion(parsed.data);
    return NextResponse.json({ question }, { status: 201 });
  } catch (error) {
    console.error("Creating question failed", error);
    return NextResponse.json(
      { error: "Could not create question" },
      { status: 500 },
    );
  }
}
