import { NextResponse } from "next/server";

import {
  deleteQuestion,
  findQuestionById,
  updateQuestion,
} from "@/lib/services/mcq-service";
import { toFieldErrors } from "@/lib/validation/auth";
import { questionSchema } from "@/lib/validation/mcq";

// Dynamic route params are async in the App Router, so the context is a promise.
type RouteContext = { params: Promise<{ id: string }> };

function questionNotFound() {
  return NextResponse.json({ error: "Question not found" }, { status: 404 });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    // findQuestionById returns PublicChoice values, which carry no correct-answer flag.
    // That is what makes this response safe to hand to the preview page.
    const question = await findQuestionById(id);
    if (!question) {
      return questionNotFound();
    }

    return NextResponse.json({ question }, { status: 200 });
  } catch (error) {
    console.error("Loading question failed", error);
    return NextResponse.json(
      { error: "Could not load question" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params;

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
    const question = await updateQuestion(id, parsed.data);
    if (!question) {
      return questionNotFound();
    }

    return NextResponse.json({ question }, { status: 200 });
  } catch (error) {
    console.error("Updating question failed", error);
    return NextResponse.json(
      { error: "Could not update question" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const deleted = await deleteQuestion(id);
    if (!deleted) {
      return questionNotFound();
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Deleting question failed", error);
    return NextResponse.json(
      { error: "Could not delete question" },
      { status: 500 },
    );
  }
}
