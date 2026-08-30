# AGENTS.md

Instructions for AI agents working in this repository. This file is loaded into every
agent conversation, so it describes only what is stable and true of the project.

## Project

QuizMaker is a multiple-choice quiz app for learners who want to test themselves on a
topic, built as an AISprints teaching project. Sprint 1 delivered account creation and
sign-in against Cloudflare D1: `/register`, `/login`, and a stateless `/api/auth/logout`.
Sprint 2 replaced the `/mcq` stub with the real thing: teachers can create, edit, preview,
and delete multiple-choice questions, and previewing records an attempt.

**There is deliberately no session management** - no cookies, no JWT, no session store. A
successful login returns the user object and the client navigates to `/mcq`, and nothing
remembers that afterwards. `/mcq` is therefore reachable without logging in. This is a
known boundary, not a bug. Do not "fix" it without being asked; adding sessions is a
scoped piece of work, not a cleanup.

That absence has a visible consequence in Sprint 2's schema: `mcq_questions.created_by`
and `mcq_attempts.user_id` are real foreign keys to `users`, but the server has no way to
know who is calling, so **they are always written as NULL** and `/mcq` lists every
question rather than filtering by teacher. The columns exist so a future session layer
fills them in rather than migrating. Do not invent a caller to populate them.

The app is deployed at **https://aisprint-quizmaker.kusuma-bs.workers.dev**, backed by the
remote `aisprint-quizmaker-db`. Because there are no sessions, everything on that URL is
reachable by anyone - it is a graded demonstration, not somewhere to put real content.
That deploy was a one-off with explicit permission; the "do not deploy" rule below still
stands and a later sprint needs its own authorization.

There are two technical PRDs in `ai-workspace/`, one per sprint, and they are the source
of truth for what was built, what was deliberately left out, and why. Read the relevant
one before changing the auth flow or the MCQ feature.

## Stack

- **Next.js 16** with the App Router and React 19
- **Cloudflare Workers** for hosting, via `@opennextjs/cloudflare`
- **Tailwind CSS v4**, configured in CSS rather than a JS config file
- **shadcn/ui** on Base UI, `base-nova` style, with Lucide icons
- **TypeScript** in strict mode
- **Wrangler** for Cloudflare configuration, secrets, and deployment
- **Cloudflare D1** for storage, binding `DB`, database `aisprint-quizmaker-db`
- **Vitest** with Testing Library and jsdom for tests
- **Zod** for validating request bodies

No AI SDK is installed. Password hashing uses the runtime's own Web Crypto rather than a
library, so there is no `bcryptjs` and there never should be `$2b$` hashes in this
database. Do not write code that imports a package without adding it first and telling
the user.

## Layout

```
src/app/               Routes, layouts, and global styles (App Router)
src/app/api/auth/      register, login, and logout route handlers
src/app/api/mcq/       Question list/create, one question, and attempts
src/app/mcq/           The question table, plus new, edit, and preview pages
src/components/ui/     shadcn/ui components (generated; avoid hand-editing)
src/components/auth/   The auth client components
src/components/mcq/    The MCQ components. These and auth/ are the 'use client' leaves.
src/lib/               Shared utilities and services
src/lib/services/      user-service.ts and mcq-service.ts - the only modules touching D1
src/lib/validation/    Zod schemas, shared by the routes and the forms
migrations/            D1 schema. The only place the schema is defined.
ai-workspace/          Technical PRDs and planning documents
.cursor/rules/         File-scoped conventions
.cursor/skills/        Task-specific guidance loaded on demand
public/                Static assets
```

Pages are Server Components and read through the service directly; `'use client'` is
pushed down to the components that need interactivity, and those reach the API over
`fetch`. `src/lib/mcq-client.ts` and `src/lib/auth-client.ts` are the only places that
turn an HTTP response into UI state.

Import through the `@/` alias, which maps to `src/`. Tests sit next to the code they
cover, as `*.test.ts` or `*.test.tsx`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server on Node at `localhost:3000` |
| `npm run preview` | Build and run on the local **Workers** runtime at `127.0.0.1:8787` |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run cf-typegen` | Regenerate `cloudflare-env.d.ts` after changing bindings |

`npm run dev` runs on Node and will not surface Workers-specific problems. Verify
anything runtime-sensitive with `npm run preview`. Password hashing is exactly that.

Three `preview` gotchas on Windows, all seen in this repo:

- It leaves generated bundles in `.wrangler/` and `.open-next/`. Both are in the ESLint
  ignores and in `.gitignore`, which is why a preview run does not produce thousands of
  bogus lint problems afterwards. Leave that setup alone.
- **Stop `npm run dev` before running `npm run preview`.** The dev server's file watcher
  holds a handle on `.open-next/assets`, and the OpenNext build starts by deleting its own
  output directory, so it dies with
  `Error: EPERM, Permission denied: ...\.open-next` before it compiles anything.
- Stopping the npm wrapper orphans the underlying `wrangler dev` and its two `workerd`
  processes, which keep serving on 8787 and keep `.open-next/` locked. Kill the whole tree
  - the `wrangler.js` process, its child, and both `workerd.exe` - not just the parent.

Apply migrations locally only:

```bash
npx wrangler d1 migrations apply aisprint-quizmaker-db --local
```

## Working agreements

- **Do not deploy.** Never run `npm run deploy` unless explicitly asked.
- **Do not touch the remote database.** Migrations may be applied locally only.
- **Ask before adding a dependency.** This is a teaching repository; an unexplained
  dependency is a cost. Propose it and say why.
- **Do not edit generated files.** `cloudflare-env.d.ts`, `next-env.d.ts`, and
  `package-lock.json` are generated.
- **Keep secrets out of the repo.** Local values belong in `.dev.vars`, which is
  gitignored. When adding a variable, also add an empty placeholder to
  `.dev.vars.example`. Production values go in `wrangler secret put`.
- **Verify before claiming completion.** Run `npm run test`, `npm run lint`, and
  `npm run build` and report the actual result. Do not describe work as done based on
  inspection alone. Green tests are not a substitute for `npx tsc --noEmit`, since Vitest
  transpiles without typechecking.
- **Say when you are unsure.** A flagged uncertainty is more useful than a confident
  guess that has to be unwound later.

## Auth invariants

Four rules the Sprint 1 code depends on. Each one is a decision, not an accident, and
each is the kind of thing that gets "tidied up" by reflex.

- **Only `src/lib/services/user-service.ts` touches D1.** It is the single call site for
  `getCloudflareContext()` and the only file containing SQL. Everything else goes through
  its exports. This is what makes the rest of the codebase testable without a database.
- **Only `src/lib/password.ts` touches crypto.** It is the only place the
  `pbkdf2-sha256$iterations$salt$key` string is written or parsed. Verification reads the
  iteration count out of the stored hash rather than a constant, so old rows keep working
  when the count is raised. Do not replace this with a library.
- **Never lowercase a username. Always lowercase an email.** The asymmetry is deliberate:
  `Kusuma` and `kusuma` are two different accounts and login is case-sensitive, while
  emails are case-insensitive. If you are about to add `.toLowerCase()` to a username, add
  `COLLATE NOCASE` to the column, or file the case-sensitive login as a bug - stop.
- **A duplicate username or email is a 400, not a 409**, and both 401s from login are
  byte-identical so the response cannot be used to discover which usernames exist. There
  are tests for both; if one fails, the test is right.

## MCQ invariants

The same kind of list for Sprint 2. Each of these has tests behind it.

- **Only `src/lib/services/mcq-service.ts` touches D1 for this feature.** Route handlers
  and pages call its exports; neither contains SQL or `getCloudflareContext()`.
- **The correct-answer flag never reaches the browser.** `PublicChoice` carries `id`,
  `text`, and `position` and nothing else, and it is what every HTTP read serialises. The
  answer key is reachable only through `findQuestionForEditing`, which has no route and is
  called from the edit page as a Server Component. If you are about to add `isCorrect` to
  a response so the client can score an answer, stop - that is the thing this design
  exists to prevent.
- **Correctness is decided from stored rows, never from the request.** `POST
  /api/mcq/[id]/attempts` accepts `selectedChoiceId` and nothing else; the handler passes
  exactly two arguments to `recordAttempt`, which reads `is_correct` out of `mcq_choices`.
  A body claiming a wrong choice is right is still told it is wrong.
- **An unknown question and a choice belonging to a different question return an
  identical 404**, so the endpoint cannot be used to discover which IDs exist.
- **A question and its choices are written in one `db.batch()`.** That is why the service
  generates the question ID with `crypto.randomUUID()` rather than letting SQLite's
  `DEFAULT` do it: the child rows need the ID before the parent insert has run. Both
  writes land or neither does, so a question can never exist with no choices.
- **Exactly one correct choice, between two and six choices.** Enforced in
  `src/lib/validation/mcq.ts` and shared by the form and the route, so the message a user
  sees before submitting is the same string a 400 would carry. SQLite cannot express this
  without a trigger, so the schema does not try.

## Cursor Cloud specific instructions

Cloud agents have no Cloudflare credentials and no `.dev.vars`. In that environment:

- `npm run dev`, `npm run build`, and `npm run lint` work normally.
- `npm run preview`, `npm run deploy`, and any `wrangler` command that needs
  authentication will fail. This is expected. Do not try to authenticate.
- If a task genuinely requires Cloudflare access, stop and report that it must be run
  locally instead.
