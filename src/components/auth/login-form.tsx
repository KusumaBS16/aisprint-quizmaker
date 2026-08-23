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
import { loginSchema, toFieldErrors } from "@/lib/validation/auth";

// No length or format rules here, matching loginSchema: a credential register would have
// rejected is a failed login, and the server must be the one to say so. Only emptiness is
// caught locally, and there is no "remember me" - it would be a lie without sessions.
export function LoginForm() {
  const router = useRouter();
  const [values, setValues] = useState({ username: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    const result = await postAuth("/api/auth/login", parsed.data);

    if (result.ok) {
      router.push("/mcq");
      return;
    }

    if (result.fields) {
      setFieldErrors(result.fields);
    } else {
      // "Invalid credentials" arrives here, deliberately unattached to either input so the
      // form does not hint at which one was wrong.
      setFormError(result.formError);
    }

    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup>
        {formError && <FieldError>{formError}</FieldError>}

        <Field data-invalid={Boolean(fieldErrors.username)}>
          <FieldLabel htmlFor="username">Username</FieldLabel>
          <Input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={values.username}
            aria-invalid={Boolean(fieldErrors.username)}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                username: event.target.value,
              }))
            }
          />
          <FieldError
            errors={
              fieldErrors.username
                ? [{ message: fieldErrors.username }]
                : undefined
            }
          />
        </Field>

        <Field data-invalid={Boolean(fieldErrors.password)}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={values.password}
            aria-invalid={Boolean(fieldErrors.password)}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                password: event.target.value,
              }))
            }
          />
          <FieldError
            errors={
              fieldErrors.password
                ? [{ message: fieldErrors.password }]
                : undefined
            }
          />
        </Field>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Need an account?{" "}
          <Link href="/register" className="underline underline-offset-4">
            Register
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}
