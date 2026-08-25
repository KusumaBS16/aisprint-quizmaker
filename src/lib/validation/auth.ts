import { z, type ZodError } from "zod";

// One message per field, used for every way that field can fail. The register form renders
// these strings verbatim, and the API returns a single string per field rather than a list,
// so a field that breaks two rules still has exactly one thing to say.
const FIRST_NAME_MESSAGE = "First name is required";
const LAST_NAME_MESSAGE = "Last name is required";
const USERNAME_MESSAGE = "Must be between 3 and 32 characters";
const EMAIL_MESSAGE = "Must be a valid email address";
const PASSWORD_MESSAGE = "Must be at least 8 characters";
const CONFIRM_PASSWORD_MESSAGE = "Confirm password is required";
const PASSWORDS_DO_NOT_MATCH_MESSAGE = "Passwords do not match";

export const registerSchema = z.object({
  firstName: z
    .string({ error: FIRST_NAME_MESSAGE })
    .trim()
    .min(1, FIRST_NAME_MESSAGE)
    .max(50, FIRST_NAME_MESSAGE),
  lastName: z
    .string({ error: LAST_NAME_MESSAGE })
    .trim()
    .min(1, LAST_NAME_MESSAGE)
    .max(50, LAST_NAME_MESSAGE),
  // Trimmed only. Lowercasing here would merge Kusuma and kusuma into one account, which is
  // deliberately not what this sprint does.
  username: z
    .string({ error: USERNAME_MESSAGE })
    .trim()
    .min(3, USERNAME_MESSAGE)
    .max(32, USERNAME_MESSAGE),
  email: z
    .string({ error: EMAIL_MESSAGE })
    .trim()
    .toLowerCase()
    .max(254, EMAIL_MESSAGE)
    .pipe(z.email(EMAIL_MESSAGE)),
  // Not trimmed: leading and trailing spaces are part of a password.
  password: z
    .string({ error: PASSWORD_MESSAGE })
    .min(8, PASSWORD_MESSAGE)
    .max(128, PASSWORD_MESSAGE),
});

// Client-only: confirmPassword is validated here and never sent to the API.
export const registerFormSchema = registerSchema
  .extend({
    confirmPassword: z
      .string({ error: CONFIRM_PASSWORD_MESSAGE })
      .min(1, CONFIRM_PASSWORD_MESSAGE),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: PASSWORDS_DO_NOT_MATCH_MESSAGE,
    path: ["confirmPassword"],
  });

// Login deliberately carries none of register's length rules. A credential that register
// would have rejected is a failed login, not a malformed request, so it has to reach the
// lookup and come back as a 401.
export const loginSchema = z.object({
  username: z
    .string({ error: "Username is required" })
    .trim()
    .min(1, "Username is required"),
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type RegisterFormInput = z.infer<typeof registerFormSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export function toFieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || field in fields) {
      continue;
    }
    fields[field] = issue.message;
  }

  return fields;
}
