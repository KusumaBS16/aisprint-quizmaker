"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { postAuth } from "@/lib/auth-client";
import { registerSchema, toFieldErrors } from "@/lib/validation/auth";

// The same schema the route validates with, so the message a user sees before submitting is
// the message the server would have sent. There is one set of rules, not a client copy of them.
const FIELDS = [
  {
    name: "firstName",
    label: "First name",
    type: "text",
    autoComplete: "given-name",
  },
  {
    name: "lastName",
    label: "Last name",
    type: "text",
    autoComplete: "family-name",
  },
  { name: "username", label: "Username", type: "text", autoComplete: "username" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  {
    name: "password",
    label: "Password",
    type: "password",
    autoComplete: "new-password",
  },
] as const;

const EMPTY = {
  firstName: "",
  lastName: "",
  username: "",
  email: "",
  password: "",
};

export function RegisterForm() {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    const result = await postAuth("/api/auth/register", parsed.data);

    if (result.ok) {
      // Left disabled through the navigation, so a second click cannot fire a second request.
      router.push("/mcq");
      return;
    }

    if (result.fields) {
      setFieldErrors(result.fields);
    } else {
      setFormError(result.formError);
    }

    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup>
        {formError && <FieldError>{formError}</FieldError>}

        {FIELDS.map(({ name, label, type, autoComplete }) => (
          <Field key={name} data-invalid={Boolean(fieldErrors[name])}>
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            <Input
              id={name}
              name={name}
              type={type}
              autoComplete={autoComplete}
              value={values[name]}
              aria-invalid={Boolean(fieldErrors[name])}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [name]: event.target.value,
                }))
              }
            />
            <FieldError
              errors={
                fieldErrors[name] ? [{ message: fieldErrors[name] }] : undefined
              }
            />
          </Field>
        ))}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Create account"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}
