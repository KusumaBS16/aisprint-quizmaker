// Shared by both auth forms so they agree on how an error response becomes UI state. The rule
// is the one the API documents: a 400 with `fields` belongs on the inputs, anything else with
// an `error` is a form-level message. The API's wording is displayed as-is, never re-invented
// here, so the two cannot drift.
export type AuthResult =
  | { ok: true }
  | { ok: false; fields: Record<string, string>; formError?: undefined }
  | { ok: false; formError: string; fields?: undefined };

const UNREACHABLE = "Could not reach the server. Please try again.";
const UNEXPECTED = "Something went wrong. Please try again.";

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export async function postAuth(
  path: string,
  payload: unknown,
): Promise<AuthResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, formError: UNREACHABLE };
  }

  if (response.ok) {
    return { ok: true };
  }

  const body: unknown = await response.json().catch(() => null);
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error: unknown }).error
      : undefined;
  const fields =
    typeof body === "object" && body !== null && "fields" in body
      ? (body as { fields: unknown }).fields
      : undefined;

  if (isStringRecord(fields) && Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: false,
    formError: typeof error === "string" ? error : UNEXPECTED,
  };
}
