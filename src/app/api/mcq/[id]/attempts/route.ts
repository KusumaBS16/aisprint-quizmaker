import { NextResponse } from "next/server";

import { recordAttempt } from "@/lib/services/mcq-service";
import { toFieldErrors } from "@/lib/validation/auth";
import { attemptSchema } from "@/lib/validation/mcq";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const parsed = attemptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fields: toFieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  try {
    // Only the selected choice is forwarded. recordAttempt reads is_correct from the stored
    // row, so a body claiming the answer was right changes nothing about the verdict.
    const attempt = await recordAttempt(id, parsed.data.selectedChoiceId);

    // One response for an unknown question and for a choice belonging to a different
    // question, so this endpoint cannot be used to discover which ids exist.
    if (!attempt) {
      return NextResponse.json(
        { error: "Question not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ attempt }, { status: 201 });
  } catch (error) {
    console.error("Recording attempt failed", error);
    return NextResponse.json(
      { error: "Could not record attempt" },
      { status: 500 },
    );
  }
}
