# AGENTS.md

Instructions for AI agents working in this repository. This file is loaded into every
agent conversation, so it describes only what is stable and true of the project.

## Project

QuizMaker is a multiple-choice quiz app for learners who want to test themselves on a
topic, built as an AISprints teaching project. Sprint 1 delivered account creation and
sign-in against Cloudflare D1: `/register`, `/login`, a stateless `/api/auth/logout`, and
a hard-coded `/mcq` stub standing in for the quiz itself.

**There is deliberately no session management** - no cookies, no JWT, no session store. A
successful login returns the user object and the client navigates to `/mcq`, and nothing
remembers that afterwards. `/mcq` is therefore reachable without logging in. This is a
known Sprint 1 boundary, not a bug, and it is stated on the page itself. Do not "fix" it
without being asked; adding sessions is a scoped piece of work, not a cleanup.

The technical PRD in `ai-workspace/` is the source of truth for what was built, what was
deliberately left out, and why. Read it before changing anything in the auth flow.

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
src/components/ui/     shadcn/ui components (generated; avoid hand-editing)
src/components/auth/   The auth client components. The only 'use client' files.
src/lib/               Shared utilities and services
src/lib/services/      user-service.ts - the only module that touches D1
migrations/            D1 schema. The only place the schema is defined.
ai-workspace/          Technical PRDs and planning documents
.cursor/rules/         File-scoped conventions
.cursor/skills/        Task-specific guidance loaded on demand
public/                Static assets
```

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

Two `preview` gotchas on Windows, both seen in this repo: it leaves generated bundles in
`.wrangler/tmp/`, which is why `.wrangler/**` is in the ESLint ignores; and stopping the
npm wrapper can orphan the underlying `wrangler dev`, which then locks `.open-next/` and
makes the next build fail with `EBUSY`. Kill the `wrangler dev` process, not just its
parent.

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

## Cursor Cloud specific instructions

Cloud agents have no Cloudflare credentials and no `.dev.vars`. In that environment:

- `npm run dev`, `npm run build`, and `npm run lint` work normally.
- `npm run preview`, `npm run deploy`, and any `wrangler` command that needs
  authentication will fail. This is expected. Do not try to authenticate.
- If a task genuinely requires Cloudflare access, stop and report that it must be run
  locally instead.
