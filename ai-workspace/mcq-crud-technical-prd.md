Date created: August 29, 2026
Date last modified: September 1, 2026 (revision 3 - sprint closed: all five phases and the
deployment close-out complete, live URL and version recorded, status wording brought up to date)

# MCQ Create, Update, Delete, and Preview - Technical PRD

**Sprint**: 2
**Owner**: Kusuma
**Branch**: `feature/mcq-crud` (cut from `main` at `215b615`, the Sprint 1 merge)
**Status**: **COMPLETE - DEPLOYED AND VERIFIED IN PRODUCTION**
**Live URL**: **https://aisprint-quizmaker.kusuma-bs.workers.dev**
**Version ID**: `54fa8c9a-882e-4c78-a364-5a285ae3b7dc`, deployed August 30, 2026

All five implementation phases and the Deployment Close-Out are finished, reviewed, and
committed. 385 tests pass across 22 files; `lint`, `tsc --noEmit`, and `build` are clean; and
the full create/edit/preview/delete journey has been walked on three runtimes - Node, workerd,
and the deployed Worker. Both migrations are applied locally and remotely. See Current Status
for the detail.

This document is the source of truth for Sprint 2. Application code followed the phases below
and nothing else. If this document and a chat request disagree, stop and ask.

**The phase sections below are a record of how the work was done and are written in the tense
they were executed in.** Statements like "Phases 1 through 5 are local-only" describe the rule
those phases ran under, and were true of them; they are not a description of where the sprint
ended up. Do not rewrite that history to match the outcome - the outcome is recorded in each
phase's Outcome note, in the Deployment Close-Out, and in Current Status.

Sprint 1 is described in `ai-workspace/aisprint-login-logout-technical-prd.md`. Its Known
Limitations section is load-bearing for this sprint: **there is still no session management**,
and Sprint 2 does not add any.

---



## Decisions Settled

Three points in the Sprint 2 brief conflicted with something already in the repository. Each
was raised before this document was written and decided by Kusuma on August 29, 2026. They are
recorded here with the reasoning that was on the table, in the same spirit as Sprint 1's Open
Decisions. Do not treat a settled decision as reopenable without saying so.

### SD1. HTTP route handlers rather than Server Actions

**Status**: SETTLED - August 29, 2026. Route handlers under `src/app/api/mcq/`, with the
deviation recorded here.

`.cursor/rules/nextjs.mdc` says: "Use Server Actions for form submissions and mutations. Reach
for a route handler in `src/app/api/` only when you need an HTTP endpoint for an external
consumer." `.cursor/rules/shadcn.mdc` echoes it: "Build forms as Server Actions validated with
Zod." The brief asks for six HTTP endpoints, which is the other thing.

Decided in favour of route handlers because Sprint 1 already resolved the identical tension the
same way - `/api/auth/register`, `/api/auth/login`, and `/api/auth/logout` are all route
handlers - and a codebase with auth over HTTP and questions over Server Actions would have two
mutation styles and one apparent reason for each. Zod validation, the `{ error, fields }` error
shape, and the "only the service touches D1" boundary are the parts of those rules that carry
the real safety, and all three are kept.

**This is a deliberate deviation from** `nextjs.mdc`**, not an oversight.** The rule file is left
unchanged; Kusuma declined amending it, so the exception lives here, scoped to this feature.

### SD2. Question IDs are generated in the service, not by SQLite

**Status**: SETTLED - August 29, 2026. `crypto.randomUUID()` in `mcq-service.ts`, with the SQL
`DEFAULT` kept on the column.

The brief asks for `db.batch()` so that a question and its choices cannot be half-written. Every
choice row needs its `question_id` at the moment the statement is built, so the question's ID has
to be known before the batch is assembled. Sprint 1 generates IDs in SQLite -
`id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))` - and
`migrations/0001_create_users_table.test.ts` asserts exactly that, under the name "generates the
id in SQLite rather than in the application". The two cannot both hold: a database-generated ID
forces an insert-then-read-back before the choices can be written, which is the non-atomic
sequence batching exists to avoid.

Decided in favour of atomicity. `createQuestion` calls `crypto.randomUUID()` and passes the ID
explicitly, so the question row and all of its choice rows go to D1 in one `db.batch()`.

The `DEFAULT (lower(hex(randomblob(16))))` clause **stays on all three new tables** so that any
insert which omits an ID still gets one, and so the schema keeps the shape Sprint 1 established.
`mcq_choices` and `mcq_attempts` rely on that default; only `mcq_questions` is given an explicit
ID by the service. `crypto.randomUUID()` is in the Workers runtime and in Node, so it needs no
dependency.

### SD3. Attempts cascade when their question is deleted

**Status**: SETTLED - August 29, 2026. `ON DELETE CASCADE` from `mcq_attempts` to both
`mcq_questions` and `mcq_choices`.

The brief specifies that choices are deleted with their question but says nothing about
attempts, which reference both. Without a rule, deleting a question would leave attempt rows
pointing at choices that no longer exist.

Decided in favour of cascading. Sprint 2 builds no reporting, no analytics, and no attempt
history UI, so a surviving attempt row would have no reader and would carry a
`selected_choice_id` that resolves to nothing. Deleting a question stays one operation with one
outcome. The alternatives - nulling the references to preserve a history nothing reads, or
blocking deletion of any question that has been attempted - both add weight for a consumer that
does not exist yet.

**Consequence, stated plainly**: attempt data is not durable across a question deletion. If a
later sprint wants attempt history to outlive its question, that is a migration and a decision
to revisit, not a bug in this one.

### Agreed without dispute: nullable user references

Not a conflict, but the reasoning belongs on the record. `mcq_questions.created_by` and
`mcq_attempts.user_id` are real foreign keys to `users`, and both are nullable and written as
`NULL` for the whole of Sprint 2, because with no session layer the server cannot identify the
caller. Considered and rejected: omitting the columns entirely, which loses the schema shape and
makes the session sprint a wider migration; inserting a sentinel "system" user, which puts
fictional data in a real table; and accepting a `userId` from the request body, which is
unauthenticated input and would be trivially forged - the same objection that decides server-side
answer checking below. See Known Limitations.

---



## Overview/Problem

Teachers who signed up in Sprint 1 land on `/mcq` and find a placeholder. The application can
create an account and check a password, but it cannot hold a single quiz question, so the product
it is named for does not exist yet. A teacher who wants to write a multiple-choice question today
has nowhere to put it, no way to correct it after the fact, and no way to see how it will read to
a student before using it.

Sprint 2 turns that placeholder into working question management: a teacher can write a
multiple-choice question, list everything written so far, edit it, delete it with a confirmation
step, and attempt their own question the way a student eventually will, with the result checked
by the server and recorded.

---



## Hypothesis

We believe that giving teachers a place to create, edit, delete, and preview multiple-choice
questions will turn QuizMaker from an account system into a usable authoring tool, and will prove
out the question and choice data model that every later quiz feature depends on.

---



## Scope



### In Scope

- Three D1 tables: `mcq_questions`, `mcq_choices`, `mcq_attempts`, in one migration, with the
four requested indexes.
- `src/lib/services/mcq-service.ts` - the only module in this feature that touches D1. Six
exported operations: create, update, list, find by ID, delete, record attempt.
- Six route handlers under `src/app/api/mcq/`, each validating its body with Zod.
- `/mcq` rebuilt as a table of all questions, showing name, question text, and a per-row actions
menu (edit, preview, delete) behind a three-vertical-dots trigger.
- `/mcq/new` and `/mcq/[id]/edit`, sharing one form component.
- `/mcq/[id]/preview`, where the teacher answers the question and is told whether they were
right.
- Between two and six choices per question, defaulting to two empty rows, with exactly one marked
correct.
- **Correctness decided on the server from stored data.** The client sends only which choice was
selected.
- Every attempt recorded in `mcq_attempts`.
- Test-first throughout, per `.cursor/skills/testing/SKILL.md`.
- **Deployment to Cloudflare**, as a close-out step after Phase 5 is reviewed: the migration
applied to the remote D1 database, the Worker deployed, and a live URL verified. Sprint 2 is
graded on a working live URL. See Deployment Close-Out.



### Out of Scope

Explicitly not built now; may be considered later.

- Session management of any kind - no cookies, no JWT, no session store, no auth middleware. This
is Sprint 1's documented limitation and it stays.
- Scoping questions to their author, or any per-teacher filtering. Every question is visible to
everyone who reaches the page.
- Any question type other than multiple choice.
- A question bank, categories, or tags.
- Search, sorting, or pagination on the question list.
- Sharing questions between teachers.
- Quizzes as a collection of questions, grading, reports, or analytics over `mcq_attempts`.
- Image upload or rich-text editing in questions or choices.
- Student-facing flows. Preview is the teacher answering their own question.
- An end-to-end test framework.
- **Deployment during Phases 1 through 5.** Those five phases are local-only: they use
`npm run dev` and `npm run preview`, and they never apply a migration with `--remote` and never
run `npm run deploy`. Deployment is not out of scope for the sprint - it is a required close-out
step that happens after Phase 5 is reviewed, and it has its own section below. What is out of
scope is deploying *early*, before the feature is verified locally.
- A CI/CD pipeline, preview environments per branch, or any automated deploy. The close-out
deploy is run by hand, once.
- A remote database seeded with data, or any migration of local rows to remote. The remote
database gets the schema, not the contents.



### Cut

Considered during planning and deliberately removed.

- **Server Actions for the form mutations** - cut per SD1, to keep one mutation style across the
API.
- **Preserving attempt history past a question deletion** - cut per SD3; nothing in Sprint 2
reads it.
- **A database-level "exactly one correct choice" constraint** - cut because SQLite cannot express
it without a trigger, and a trigger is a piece of untested logic living outside the migration's
readable surface. Enforced in Zod and re-checked in the service instead. Documented in Known
Limitations.
- **An attempts-per-question count in the list table** - cut as scope creep toward analytics.
- **Optimistic UI updates after delete** - cut in favour of `router.refresh()`, which needs no
client cache and no state library. `.cursor/rules/nextjs.mdc` forbids adding one without asking.
- **Filtering** `/mcq` **by the logged-in teacher** - cut because it is unimplementable without
sessions, not because it is undesirable.

---



## Technical Requirements



### Database Schema

One migration, created with
`npx wrangler d1 migrations create aisprint-quizmaker-db create_mcq_tables`, which produces
`migrations/0002_create_mcq_tables.sql` with a generated `-- Migration number:` header line.

Applied **locally** in Phase 1 and for the whole of Phases 1 through 5:

```bash
npx wrangler d1 migrations apply aisprint-quizmaker-db --local
```

The same migration is applied to the **remote** database once, in the Deployment Close-Out, and
not before. `.cursor/rules/d1.mdc` says remote schema changes are the user's decision to make and
execute; that decision is recorded in the close-out section.

```sql
CREATE TABLE mcq_questions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  question_text TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mcq_choices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id TEXT NOT NULL REFERENCES mcq_questions (id) ON DELETE CASCADE,
  choice_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  position INTEGER NOT NULL
);

CREATE TABLE mcq_attempts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id TEXT NOT NULL REFERENCES mcq_questions (id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  selected_choice_id TEXT NOT NULL REFERENCES mcq_choices (id) ON DELETE CASCADE,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mcq_questions_created_by ON mcq_questions (created_by);
CREATE INDEX idx_mcq_choices_question_id ON mcq_choices (question_id);
CREATE INDEX idx_mcq_attempts_question_id ON mcq_attempts (question_id);
CREATE INDEX idx_mcq_attempts_user_id ON mcq_attempts (user_id);
```

Notes on the shape:

- `created_by` **and** `user_id` **are nullable and always** `NULL` **in Sprint 2.** See SD3's neighbour
above and Known Limitations. `ON DELETE SET NULL` means deleting a user does not delete their
questions.
- **SQLite has no boolean type.** `is_correct` is `INTEGER` constrained to `0` or `1`, and the
service converts to and from `boolean` at its boundary so nothing above it handles a `0`.
- `position` keeps choice display order stable. Rows are always read back with
`ORDER BY position`, because SQLite gives no ordering guarantee otherwise.
- **No timestamps on** `mcq_choices`**.** Choices are rewritten wholesale on update and are only ever
read as part of their question, so a per-choice timestamp would have no reader.
- `updated_at` **on** `mcq_questions` **is set explicitly** by `updateQuestion`, matching
`updateUser` in `user-service.ts:163`. SQLite does not update it on its own.



### MCQ Service

`src/lib/services/mcq-service.ts` is the only module in this feature that calls
`getCloudflareContext()` or contains SQL, mirroring the `user-service.ts` invariant in
`AGENTS.md`. Route handlers and pages call its exports and never reach D1 themselves.

Conventions carried over from `user-service.ts`, all of them required:

- Numbered placeholders (`?1`, `?2`), never anonymous `?`, per `.cursor/rules/d1.mdc`.
- `RETURNING` on writes, read through `.all()` and `results[0]`. **Never** `.first()` - the
service test's fake statement deliberately omits `first()` so a call to it throws.
- `db.batch()` wherever a question and its choices are written together.

**Row types** are `snake_case` and mirror the columns. **Public types** are `camelCase` and are
what routes serialise, exactly as `UserRow` and `PublicUser` differ today.

```ts
export interface QuestionRow {
  id: string;
  name: string;
  question_text: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChoiceRow {
  id: string;
  question_id: string;
  choice_text: string;
  is_correct: number; // 0 or 1
  position: number;
}

export interface PublicChoice {
  id: string;
  text: string;
  position: number;
}

export interface PublicQuestion {
  id: string;
  name: string;
  questionText: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicQuestionWithChoices extends PublicQuestion {
  choices: PublicChoice[];
}
```

`PublicChoice` **has no** `isCorrect` **field.** This is deliberate and is the single most important
line in this section: `GET /api/mcq/[id]` feeds the preview page, and shipping the answer key to
the browser would let anyone read the correct answer out of the network tab before answering. The
correct flag never crosses the HTTP boundary in the read direction. The edit form is the one place
that needs it, and it gets it through a separate authoring shape:

```ts
export interface AuthoringChoice {
  text: string;
  isCorrect: boolean;
}
```

returned only by `findQuestionForEditing(id)`, which the edit page calls **on the server** as a
Server Component and passes into the form as props. It is never exposed as a route.

The exported operations:


| Export                                        | Behaviour                                                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createQuestion(input)`                       | Generates the ID with `crypto.randomUUID()` (SD2), then writes the question and every choice in one `db.batch()`. Returns the created question with its choices.                                                      |
| `updateQuestion(id, input)`                   | One `db.batch()`: `UPDATE` the question and set `updated_at`, `DELETE FROM mcq_choices WHERE question_id = ?1`, then re-insert every choice with fresh positions. Returns `undefined` if the question does not exist. |
| `listQuestions()`                             | All questions ordered by `created_at DESC`. No choices - the table does not render them.                                                                                                                              |
| `findQuestionById(id)`                        | One question with its choices ordered by `position`. `undefined` when absent.                                                                                                                                         |
| `findQuestionForEditing(id)`                  | As above, but choices carry `isCorrect`. Server-side callers only.                                                                                                                                                    |
| `deleteQuestion(id)`                          | `DELETE ... RETURNING id`; `true` when a row went. Choices and attempts cascade.                                                                                                                                      |
| `recordAttempt(questionId, selectedChoiceId)` | Described below.                                                                                                                                                                                                      |


`recordAttempt` **is where the trust boundary sits.** It must not accept a correctness claim from
its caller. The sequence:

1. `SELECT id, is_correct FROM mcq_choices WHERE id = ?1 AND question_id = ?2`.
2. If no row comes back, return `undefined`. **Both halves of that** `WHERE` **matter**: matching on
  `question_id` as well as `id` is what stops a caller submitting a choice belonging to a
   different question and having it scored against this one.
3. `is_correct` from that row - never from the request - is the verdict.
4. `INSERT INTO mcq_attempts (question_id, user_id, selected_choice_id, is_correct)` with
  `user_id` bound to `null`, using `RETURNING`.
5. Return `{ isCorrect, selectedChoiceId }`.

Rewriting choices wholesale on update means choice IDs change on every edit. That is acceptable
because nothing holds a choice ID across an edit, and it keeps `position` contiguous without a
reconciliation pass. It is recorded in Known Limitations because it does destroy the link from
older attempts, which cascade away with their choice rows.

### Validation

`src/lib/validation/mcq.ts`, structured like `src/lib/validation/auth.ts`: one message constant
per failure, reused by both the API and the form so the two cannot drift. It reuses the existing
`toFieldErrors` helper exported from `@/lib/validation/auth`.

```ts
export const questionSchema = z.object({
  name: z.string({ error: NAME_MESSAGE }).trim().min(1, NAME_MESSAGE).max(100, NAME_MESSAGE),
  questionText: z
    .string({ error: QUESTION_TEXT_MESSAGE })
    .trim()
    .min(1, QUESTION_TEXT_MESSAGE)
    .max(1000, QUESTION_TEXT_MESSAGE),
  choices: z
    .array(
      z.object({
        text: z.string({ error: CHOICE_TEXT_MESSAGE }).trim().min(1, CHOICE_TEXT_MESSAGE).max(500, CHOICE_TEXT_MESSAGE),
        isCorrect: z.boolean(),
      }),
    )
    .min(2, CHOICE_COUNT_MESSAGE)
    .max(6, CHOICE_COUNT_MESSAGE)
    .refine((choices) => choices.filter((choice) => choice.isCorrect).length === 1, {
      message: EXACTLY_ONE_CORRECT_MESSAGE,
    }),
});

export const attemptSchema = z.object({
  selectedChoiceId: z.string({ error: SELECTION_MESSAGE }).trim().min(1, SELECTION_MESSAGE),
});
```

The rules, in words: name and question text are required; between two and six choices; no choice
may be empty or whitespace-only; exactly one choice is marked correct.

`toFieldErrors` keys on `issue.path[0]`, so every choice-level failure collapses to the single key
`choices`. That is the correct API shape - one message per field, as Sprint 1 established - and the
form is responsible for highlighting the specific offending row from its own client-side parse.

### API Endpoints

All under `src/app/api/mcq/`. Every handler parses `await request.json()` inside a `try`, returns
`{ error: "Validation failed" }` with a 400 on malformed JSON, validates with Zod, and returns
`{ error, fields }` on a validation failure - byte-identical in shape to the auth routes, so
`postAuth`-style client handling works unchanged.

#### GET /api/mcq

**Response**

- 200: `{ "questions": [{ "id", "name", "questionText", "createdBy", "createdAt", "updatedAt" }] }`
- 500: `{ "error": "Could not load questions" }`



#### POST /api/mcq

**Request Body**

```json
{
  "name": "Capitals of Europe",
  "questionText": "What is the capital of France?",
  "choices": [
    { "text": "Paris", "isCorrect": true },
    { "text": "Lyon", "isCorrect": false }
  ]
}
```

**Response**

- 201: `{ "question": { ...PublicQuestion, "choices": [{ "id", "text", "position" }] } }`
- 400: `{ "error": "Validation failed", "fields": { "name": "..." } }`
- 500: `{ "error": "Could not create question" }`



#### GET /api/mcq/[id]

**Response**

- 200: `{ "question": { ...PublicQuestion, "choices": [...] } }` - **without** `isCorrect`
- 404: `{ "error": "Question not found" }`
- 500: `{ "error": "Could not load question" }`



#### PUT /api/mcq/[id]

Full replacement, not a patch: the body carries the complete question and its complete choice
list, and the stored choices are replaced by what is sent. Same body and validation as `POST`.

**Response**

- 200: `{ "question": { ...PublicQuestion, "choices": [...] } }`
- 400: `{ "error": "Validation failed", "fields": { ... } }`
- 404: `{ "error": "Question not found" }`
- 500: `{ "error": "Could not update question" }`



#### DELETE /api/mcq/[id]

No request body.

**Response**

- 200: `{ "ok": true }`
- 404: `{ "error": "Question not found" }`
- 500: `{ "error": "Could not delete question" }`



#### POST /api/mcq/[id]/attempts

**Request Body**

```json
{ "selectedChoiceId": "a1b2c3d4e5f6" }
```

**Response**

- 201: `{ "attempt": { "isCorrect": true, "selectedChoiceId": "a1b2c3d4e5f6" } }`
- 400: `{ "error": "Validation failed", "fields": { "selectedChoiceId": "Select an answer" } }`
- 404: `{ "error": "Question not found" }` - also returned when the choice exists but belongs to
another question, so the endpoint cannot be used to probe which choice IDs are real
- 500: `{ "error": "Could not record attempt" }`

**The body carries no correctness claim and the server would ignore one if it did.** `isCorrect` in
the response is read from `mcq_choices` inside `recordAttempt`.

### User Interface Requirements

shadcn/ui only, per `.cursor/rules/shadcn.mdc`. Theme tokens only - no hard-coded colours, per
`.cursor/rules/tailwind.mdc` and `.cursor/BUGBOT.md`. Pages stay Server Components; `'use client'`
is pushed to the leaves that need interactivity, per `.cursor/rules/nextjs.mdc`.

Already installed and reused: `table`, `button`, `input`, `label`, `field`, `card`, `badge`,
`separator`, `dialog`.

To be added in Phase 4, and only these four:


| Component       | Used by                                   |
| --------------- | ----------------------------------------- |
| `dropdown-menu` | The per-row actions menu on `/mcq`        |
| `textarea`      | Question text on the create and edit form |
| `alert-dialog`  | The delete confirmation                   |
| `radio-group`   | Answer selection on the preview page      |


```bash
npx shadcn@latest add @shadcn/dropdown-menu @shadcn/textarea @shadcn/alert-dialog @shadcn/radio-group
```

The `@shadcn/` namespace is required; a bare name silently does nothing. If any of the four
produces no files it does not exist for the Base UI base - see Risks for the fallback.

#### Question list (`/mcq`)

- Server Component. Calls `listQuestions()` directly; no HTTP round trip to our own API.
- Keeps the existing `LogoutButton` in the header.
- A **Create question** button at the top right of the table, linking to `/mcq/new`.
- `Table` with three columns: Name, Question, Actions.
- Actions cell is a client component: a ghost icon `Button` holding the `MoreVertical` Lucide icon
(the three vertical dots), opening a `DropdownMenu` with **Edit**, **Preview**, and **Delete**.
The trigger carries an accessible name so it is reachable by `getByRole("button", { name: ... })`
and by screen readers.
- Delete opens an `AlertDialog` naming the question, with Cancel and Delete. Only on confirm does
it `DELETE /api/mcq/[id]`, then call `router.refresh()`.
- Empty state: a short line and the same create button, not a bare empty table.



#### Create (`/mcq/new`) and Edit (`/mcq/[id]/edit`)

Both render the same `McqForm` client component. Create passes no initial data; edit passes the
question from `findQuestionForEditing(id)`, fetched server-side, and edit returns Next's
`notFound()` for an unknown ID.

- Fields: **Name** (`Input`), **Question** (`Textarea`), and the choice rows.
- Each choice row: a text `Input`, a control marking it the correct one, and a remove control that
is disabled while only two rows remain.
- Two empty choice rows on a new question. **Add choice** appends a row and is disabled at six.
- Marking a choice correct unmarks the previous one, so "exactly one" is true by construction in
the UI as well as in Zod.
- Errors surface through `FieldError`, which takes `{ message }` objects, per `shadcn.mdc`.
- **Save and Cancel sit below the form, side by side, at equal width.** Implemented as
`grid grid-cols-2 gap-3` with `w-full` on both buttons, so each takes exactly half the form
width and neither can overflow at any viewport. A flex row with intrinsic widths is what causes
the overflow this requirement exists to prevent, so it is not used here.
- Cancel navigates back to `/mcq` without writing.
- Save posts to `POST /api/mcq` or `PUT /api/mcq/[id]` and, on success, navigates to `/mcq`.



#### Preview (`/mcq/[id]/preview`)

- Server Component fetching through `findQuestionById(id)`; `notFound()` for an unknown ID.
- Renders the question text and the choices as a `RadioGroup`, in `position` order.
- **The correct answer is not in the page's HTML.** The Server Component passes only
`PublicChoice` values into the client component, so the answer cannot be read from the DOM or
from the RSC payload before answering.
- Submit posts to `POST /api/mcq/[id]/attempts` and is disabled until a choice is selected.
- The result renders from the server's response: a clear correct or incorrect message, using
`text-destructive` and the theme's success tokens rather than literal colours.
- After answering, the teacher can return to `/mcq`.

---



## Implementation Phases

Five phases, bottom-up, mirroring Sprint 1's layering, **followed by a Deployment Close-Out** that
is not itself a phase. **Each phase ends at a review gate**: tests and linter run, real output
shown, work reported, and then a stop. No phase begins before Kusuma says so, and no phase is
committed before Kusuma approves it. This is now also encoded in
`.cursor/rules/phase-commit.mdc`, which always applies.

Phases 1 through 5 were local-only. Deployment happened once, at the end, after Phase 5 was
reviewed. **All five phases and the close-out are complete**; each phase below carries its own
status marker and an Outcome note recording what actually happened.

### Phase 1: Schema and Migration - COMPLETED

**Objective**: The three tables exist in the local D1 database with the right columns,
constraints, cascades, and indexes.

**Tasks**:

1. Create the migration file with `npx wrangler d1 migrations create`.
2. Write `migrations/0002_create_mcq_tables.test.ts` first, asserting what the SQL declares -
  column lists, nullability of `created_by` and `user_id`, both `CHECK` constraints, all three
   `ON DELETE` clauses, and all four named indexes. Model it on
   `migrations/0001_create_users_table.test.ts`.
3. Run the test and watch it fail because the SQL is empty.
4. Write the SQL from the Database Schema section above.
5. Apply locally: `npx wrangler d1 migrations apply aisprint-quizmaker-db --local`. **Not
  `--remote` in this phase** - the remote database is touched only in the Deployment Close-Out.
6. Verify against the real database with `npx wrangler d1 execute --local`: `PRAGMA table_info`
  for each table, `PRAGMA foreign_key_list` for the cascades, `PRAGMA index_list` for the
   indexes.
7. Confirm cascade behaviour for real: insert a question with choices and an attempt, delete the
  question, and check that the choice and attempt rows are gone.

**Deliverables**:

- `migrations/0002_create_mcq_tables.sql`
- `migrations/0002_create_mcq_tables.test.ts`
- Pasted `wrangler d1 execute --local` output evidencing tasks 6 and 7

**Outcome** (August 29, 2026): Both files written, migration applied locally, all seven tasks
done. The test was written first and run against the empty migration, where 23 of 25 assertions
failed with `No CREATE TABLE mcq_questions (...) statement found`; after the SQL was written all
25 passed. Full suite 218 passed across 13 files. Lint clean apart from one pre-existing warning.

Verified against the real local database, not just the SQL text:

- `PRAGMA table_info` on all three tables returns exactly the PRD's columns, in order, with
`created_by` and `user_id` the only nullable non-generated columns.
- `pragma_foreign_key_list` shows **five** foreign keys with the intended `on_delete` actions:
`SET NULL` for both user references, `CASCADE` for `mcq_choices.question_id`,
`mcq_attempts.question_id`, and `mcq_attempts.selected_choice_id`.
- `pragma_index_list` shows all four named indexes, each `"unique": 0`, alongside one implicit
primary-key autoindex per table.
- Cascade proven by execution: a question with 2 choices and 1 attempt, then one
`DELETE FROM mcq_questions`, left all three tables at zero rows.
- `CHECK` proven by execution: `is_correct = 2` was rejected with
`CHECK constraint failed: is_correct IN (0, 1)`.
- Foreign keys proven to be **enforced**, not merely declared: a choice referencing a
non-existent question was rejected with `FOREIGN KEY constraint failed`. This is what makes the
cascade meaningful and it was worth confirming rather than assuming.
- All three tables left empty, so Phase 2 starts from a known state.

Two notes for later phases:

1. **Task 2 above says "all three** `ON DELETE` **clauses"; there are actually five.** The test covers
  all five. The task wording is left exactly as written rather than quietly corrected - see Notes
   for AI Agents item 12 - pending Kusuma's decision on whether to fix it.
2. **A multi-statement** `wrangler d1 execute` **rolled back entirely when a later statement failed**:
  the question inserted before the rejected `CHECK` did not survive. That is encouraging for
   Phase 2 task 6, but it is `d1 execute` behaviour and is **not** evidence about `db.batch()`.
   Phase 2 still has to prove the batch rollback on its own terms.



### Phase 2: MCQ Service - COMPLETED

**Objective**: Every database operation this feature needs, behind one tested module.

**Tasks**:

1. Write `src/lib/services/mcq-service.test.ts` first, extending Sprint 1's fake-D1 helper - which
  currently offers only `prepare`, `bind`, and `all` - with a `batch()` that records the
   statements it was handed. Keep `first()` absent so a call to it still throws.
2. Cover: create writes question and choices in **one** `batch` call; update replaces choices
  rather than accumulating them; `updateQuestion` and `findQuestionById` return `undefined` for
   an unknown ID; choices come back in `position` order; `recordAttempt` returns `undefined` when
   the choice belongs to a different question; `recordAttempt` derives `isCorrect` from the stored
   row and binds `user_id` as `null`; every statement uses numbered placeholders.
3. Run the tests and watch them fail for the right reason - the module does not exist.
4. Implement `mcq-service.ts` until they pass.
5. Confirm no `.first()` call and no `getCloudflareContext()` outside this module.
6. **Verify the batch write against the real local database**, because a fake that records
  statements can only prove `batch()` was *called* - it cannot prove D1 wrote atomically. Same
   shape as Phase 1 task 7, using `npx wrangler d1 execute --local`:
  - **Success path**: write a throwaway question with its choices, then confirm the question row
  and exactly its choice rows are present, with `position` values contiguous from zero.
  - **Failure path**: run a batch whose last choice insert is guaranteed to fail - a
  `CHECK` violation on `is_correct`, or a `question_id` that does not exist - and confirm
  **no question row was left behind**. This is the acceptance criterion "a failed batch leaves
  no question row behind", and it can only be evidenced here.
  - **Clean up** both throwaway questions and confirm all three tables are empty afterwards, so
  Phase 3 starts from a known state.
  - Paste the real output, including the row counts before and after.

**Deliverables**:

- `src/lib/services/mcq-service.ts`
- `src/lib/services/mcq-service.test.ts`
- Pasted `wrangler d1 execute --local` output evidencing task 6, both paths, plus the empty-table
confirmation

**Outcome** (August 30, 2026): 40 service tests written first and run before the module existed,
failing with `Failed to resolve import "@/lib/services/mcq-service"`. After implementation all 40
pass. Full suite 258 passed across 14 files, `npx tsc --noEmit` clean, lint 0 errors and the same
one pre-existing `Badge` warning.

Seven exports, one more than the six the brief named: `findQuestionForEditing` is the seventh, and
it is the server-only path that carries the answer key for the edit form.

Verified against the real local database with throwaway rows, all cleaned up:

- **The SQL is accepted by D1**, which the mocked suite cannot show. Question insert with an
application-supplied id, three choice inserts, the choice read-back, the attempt lookup and
insert, the update's delete-and-reinsert, and the cascade delete were all run as written.
- **Choice ordering is genuinely by position, not by id.** The three SQLite-generated choice ids
sorted `2acb…`, `6537…`, `846c…`, so an accidental id ordering would have returned Lyon, Nice,
Paris. `ORDER BY position, id` returned Paris, Lyon, Nice, with positions 0, 1, 2.
- **A failed write leaves no question behind.** A question plus a good choice plus a choice with
`is_correct = 7` was rejected with `CHECK constraint failed: is_correct IN (0, 1)`, and the
question row did not survive - `SELECT id, name FROM mcq_questions` afterwards showed only the
unrelated probe.
- **Update replaces rather than accumulates**: choices went 3 to 2, not 3 to 5.
- **Cascade delete confirmed again at service scale**: 1 question, 2 choices, 1 attempt, then one
`DELETE ... RETURNING id`, left `{"questions": 0, "choices": 0, "attempts": 0}`. `RETURNING`
returned the deleted id, which is what `deleteQuestion` keys its boolean on.
- `user_id` **is written as null** and came back null from `RETURNING`.
- All three tables empty afterwards; Phase 3 starts clean.

Invariants checked by search rather than assertion: `getCloudflareContext` appears only in the two
service modules and their tests, `.first(` appears nowhere in `src/`, and the three `mcq_` table
names appear only in `mcq-service.ts` and its test.

**Known Limitation 8 was observed happening, not just predicted.** Replacing a question's choices
on update cascaded its existing attempt away: the count went from 1 to 0 with no explicit delete
of the attempt. The limitation is written correctly; this is confirmation, not a surprise.

**Caveat on what this does and does not prove.** These checks ran through
`wrangler d1 execute`, which is the same D1 engine and does roll a failed multi-statement command
back. They are not a test of the `db.batch()` binding call itself, which only exists on the
Workers runtime. Phase 5 exercises that path end to end; until then, the batch grouping is proven
by the unit tests and the SQL is proven by these.

### Phase 3: API Routes and Validation - COMPLETED

**Objective**: Six endpoints, each validating input and returning the agreed status codes and
error shapes.

**Tasks**:

1. Write `src/lib/validation/mcq.test.ts` first: name and question text required, fewer than two
  choices rejected, more than six rejected, an empty or whitespace-only choice rejected, zero
   correct rejected, two correct rejected, exactly one accepted.
2. Write the route tests first, mocking `@/lib/services/mcq-service` at the module boundary as
  Sprint 1's route tests mock `user-service`. Cover every status code in the API section,
   including 404 for an unknown question, 400 for malformed JSON, and **the response of**
   `GET /api/mcq/[id]` **containing no** `isCorrect` **anywhere**.
3. Add a test proving `POST /api/mcq/[id]/attempts` ignores a forged correctness field: send a
  body claiming the wrong choice is right and assert the response says incorrect.
4. Run all of it and watch it fail.
5. Implement `src/lib/validation/mcq.ts` and the six handlers until green.
6. **Run** `npm run build` **and read the route table it prints.** Confirm it lists exactly the six
  intended routes - `/api/mcq`, `/api/mcq/[id]`, `/api/mcq/[id]/attempts`, alongside the Sprint 1
   auth routes and pages - and that **no colocated** `*.test.ts` **file has been picked up as a
   route**. Only a file named exactly `route.ts` is a route handler, so `route.test.ts` should be
   inert, and Sprint 1 already colocates auth route tests the same way without trouble. This step
   confirms that rather than assuming it, and would catch a stray `route.ts` in the wrong
   directory or an accidental extra dynamic segment. Paste the route table.

**Deliverables**:

- `src/lib/validation/mcq.ts` and its test
- `src/app/api/mcq/route.ts` (GET, POST)
- `src/app/api/mcq/[id]/route.ts` (GET, PUT, DELETE)
- `src/app/api/mcq/[id]/attempts/route.ts` (POST)
- A colocated `route.test.ts` beside each
- The pasted route table from `npm run build`

**Outcome** (August 30, 2026): 71 tests across the four new files, all written first and observed
failing on unresolvable imports before any handler existed. Full suite 329 passed across 18 files.
Lint 0 errors and the same one pre-existing `Badge` warning. `npx tsc --noEmit` clean **after a
fix described below**.

Three route files carry the six endpoints, since the App Router groups methods by path:
`/api/mcq` holds GET and POST, `/api/mcq/[id]` holds GET, PUT, and DELETE, and
`/api/mcq/[id]/attempts` holds POST.

The build's route table lists exactly what was intended and nothing more:

```
├ ƒ /api/mcq
├ ƒ /api/mcq/[id]
├ ƒ /api/mcq/[id]/attempts
```

alongside the Sprint 1 routes and pages. **No colocated** `*.test.ts` **was picked up as a route**,
confirming rather than assuming that only a file named exactly `route.ts` becomes a handler.

**A real problem found by checking rather than assuming.** `npm run build` reported its
TypeScript step clean, but `npx tsc --noEmit` reported **9 errors** in the new route tests -
`TS18046: 'body' is of type 'unknown'` and `TS2571: Object is of type 'unknown'` - because
`response.json()` returns `unknown` and the tests reached into `.fields` without narrowing. The
build had not caught them: its typecheck covers the files in its own build graph, and test files
are not in it. Fixed by narrowing once per file through a typed `errorBody(response)` helper
rather than asserting inline. This is exactly the quiet pile-up the Phase 5 checklist exists to
prevent, and it is why `tsc --noEmit` is listed there separately from `npm run build`.

Trust boundary evidence, since it is the point of the design: a test posts
`{ selectedChoiceId: "choice-lyon", isCorrect: true }` and asserts the response still reports
incorrect, and a second asserts the handler forwards only two arguments to `recordAttempt`, so no
correctness claim can reach the service. A third asserts `GET /api/mcq/[id]` contains neither
`isCorrect` nor `is_correct` anywhere in its serialised body.

### Phase 4: User Interface - COMPLETED

**Objective**: The four pages, working against the real API.

**Tasks**:

1. Add the four shadcn components, and report which ones landed.
2. Write component tests first for the client components: the form renders two choice rows
  initially; **Add choice** stops at six; remove is disabled at two; marking a second choice
   correct unmarks the first; Save is blocked and errors render when validation fails; the actions
   menu exposes all three items; delete is not sent until the dialog is confirmed; preview cannot
   submit with nothing selected and renders the server's verdict.
3. Run them and watch them fail.
4. Build `src/components/mcq/mcq-form.tsx`, `question-actions.tsx`, `delete-question-dialog.tsx`,
  and `preview-form.tsx`, plus `src/lib/mcq-client.ts` for the fetch and error-mapping shape,
   modelled on `auth-client.ts`.
5. Rebuild `src/app/mcq/page.tsx` as the table, and add `/mcq/new`, `/mcq/[id]/edit`, and
  `/mcq/[id]/preview`.
6. Query by role and accessible name, per the testing skill. Confirm Save and Cancel are equal
  width and neither overflows.

**Deliverables**:

- The four components, `mcq-client.ts`, and colocated tests
- `src/app/mcq/page.tsx` rewritten, plus the three new pages
- The list of shadcn components actually added

**Outcome** (August 30, 2026): 56 component tests across four new files, written first and
observed failing on unresolvable imports. Full suite 385 passed across 22 files. Lint clean,
`npx tsc --noEmit` clean, `npm run build` clean, and the route table now lists `/mcq`,
`/mcq/[id]/edit`, `/mcq/[id]/preview`, and `/mcq/new` and nothing else.

**shadcn components added, all four and only those four**: `dropdown-menu`, `textarea`,
`alert-dialog`, `radio-group`. No package was installed and no dependency changed.

Five components rather than the four planned, because the table itself needed to be testable:
`questions-table.tsx` was split out of the page so that its columns, empty state, and create
control could be asserted directly. The pages stayed Server Components, and a new
`src/app/mcq/layout.tsx` holds the header so the logout control is declared once, in a bar of its
own, with page content starting below the border.

**Two Base UI behaviours were found by probing rather than by assuming**, both written up in the
Troubleshooting Guide: its menus do not open under jsdom, and wrapping a `Link` in `Button` either
warns or relabels the link as a button.

**A real browser walkthrough, not an inspection.** Chrome was driven headless over the DevTools
protocol using Node's built-in `WebSocket`, with `Input.dispatchMouseEvent` producing genuine
mouse events, so the pointer-driven paths that jsdom cannot reach were exercised for real. The
whole journey ran end to end: create with three choices, save, open the dots menu, edit, add a
fourth choice, save, preview, answer wrong, try again, answer right, open the delete dialog,
cancel it, reopen it, confirm. Observed along the way: the new form arrives with exactly two
choice rows and both remove buttons disabled; marking choice 1 correct leaves the other two
false; the menu holds exactly Edit, Preview, Delete with the first two carrying the right hrefs;
the edit form arrives prefilled with `Paris, Lyon, Nice` and the correct mark on the first;
preview lists all four choices with Submit disabled until one is picked; the wrong answer
returned **Incorrect** and the right one **Correct**; cancelling the dialog left the row in
place; confirming it emptied the table. **The string "correct" appears zero times in the preview
page's rendered HTML**, so the answer key is not merely hidden but absent. The browser console
was clean on `/mcq` and `/mcq/new` at the end.

Attempts were confirmed in local D1 during the same pass: three rows, `user_id` null on all
three, `is_correct` 0, 1, 0 - the third being a forged body claiming a wrong choice was right,
recorded as wrong. Deleting the question took 1 question, 4 choices, and 3 attempts to 0, 0, 0.

Pages that read D1 carry `export const dynamic = "force-dynamic"`, added so nothing is
prerendered at build time; the route table agrees, marking those three dynamic and `/mcq/new`
static. This was a precaution rather than a fix - the build was never observed failing without
it.

Tests use plain Vitest matchers and query by role and accessible name, matching the Sprint 1
component tests. `@testing-library/jest-dom` was deliberately not installed: adding a dependency
to write `toBeDisabled()` instead of reading `.disabled` is not a trade this sprint needs.

### Phase 5: Workers Runtime Verification and Documentation - COMPLETED

**Objective**: Prove it works on the real runtime, not just under jsdom, and leave the
documentation true.

**Tasks**:

1. `npm run test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` - all four, with real
  output. Green tests do not substitute for `tsc`, since Vitest transpiles without typechecking.
2. `npm run preview` and exercise the full journey on the Workers runtime at `127.0.0.1:8787`:
  create, list, edit, preview with a correct answer, preview with an incorrect answer, delete.
3. Confirm in D1 that attempts were written with `user_id` null and the right `is_correct`.
4. Confirm a deleted question took its choices and attempts with it.
5. Check the preview page's HTML and network responses contain no correct-answer flag.
6. Try to score a choice belonging to another question and confirm a 404.
7. Record every real problem hit during the sprint in the Troubleshooting Guide.
8. Tick the Acceptance Criteria against observed behaviour, not inspection.
9. Update `AGENTS.md`: the Project section still says `/mcq` is a hard-coded stub, and the Layout
  section needs the new directories.
10. Update Current Status and the phase markers, then stop and hand back to Kusuma for review.

**Deliverables**:

- Pasted output from all four commands and the `preview` journey
- `AGENTS.md` updated
- This PRD updated: Troubleshooting, Acceptance Criteria, Current Status

**Outcome** (August 30, 2026): all four checks clean - 385 tests across 22 files, `eslint .`
silent at exit 0, `npx tsc --noEmit` silent at exit 0, and `next build` compiling with the route
table unchanged from Phase 4. The `Badge` warning carried since Sprint 1 is gone with the
placeholder page that produced it, so the lint output is now genuinely empty rather than
tolerably noisy.

**The journey was walked on the Workers runtime, not the dev server.** `npm run preview` built
through OpenNext and served on `127.0.0.1:8787` with `env.DB (aisprint-quizmaker-db)` bound as a
local D1 database, and the same headless-Chrome driver used in Phase 4 was pointed at 8787.
Every observation matched the Node dev server: two choice rows on arrival with both remove
buttons disabled, the menu holding exactly Edit/Preview/Delete, the edit form prefilled with
`Paris, Lyon, Nice` and the correct mark on the first, Submit disabled until a choice is picked,
**Incorrect** then **Correct**, cancel leaving the row alone, and confirm emptying the table.
Nothing behaved differently on workerd - which is worth recording, because Sprint 1's reason for
insisting on this step was that password hashing did differ.

**The end-to-end evidence, read straight out of D1 while the preview was still serving.** The
question row stored `created_by` NULL, as designed. Its choices stored the correct flag on the
right row and kept their order:

```
{ "position": 0, "choice_text": "Paris",    "is_correct": 1 }
{ "position": 1, "choice_text": "Lyon",     "is_correct": 0 }
{ "position": 2, "choice_text": "Nice",     "is_correct": 0 }
{ "position": 3, "choice_text": "Toulouse", "is_correct": 0 }
```

and the attempts, joined back to the choice each one selected, agree with it:

```
{ "user_id": null, "selected": "Nice",  "choice_is_correct": 0, "attempt_is_correct": 0 }
{ "user_id": null, "selected": "Paris", "choice_is_correct": 1, "attempt_is_correct": 1 }
```

That join is the point of the whole design: `attempt_is_correct` was not sent by the browser, it
was derived from `choice_is_correct` at the moment the attempt was recorded. Deleting the
question through the confirmation dialog then took `questions: 1, choices: 4, attempts: 2` to
`0, 0, 0` in one step.

**Answer-key and probing checks, repeated against the runtime.** `GET /api/mcq/[id]` returned
choices carrying exactly `id, text, position`, with zero occurrences of `isCorrect` or
`is_correct` in the raw response body. The preview page's HTML contained zero occurrences of
`is_correct`, `isCorrect`, **or even the word "correct"**. Scoring question A with a choice
belonging to question B returned `404 {"error":"Question not found"}` - byte-identical to the
404 for a question ID that does not exist. A body sending `isCorrect: true` alongside a wrong
choice was answered `{"attempt":{"isCorrect":false,...}}`. Validation still rejected a
one-choice body with the same `400` and the same wording as under Vitest.

**The generated-bundle problem did not occur, because the setup was already right.** After the
preview run, `.wrangler/` held 17 files and `.open-next/` held 1,210, and `npm run lint` still
exited 0 with no output while `git status --short` printed nothing at all. `.wrangler/**` and
`.open-next/**` were already in the ESLint ignores and `.gitignore` from Sprint 1. Nothing was
added and no package was installed - the correct outcome for a warning that turns out to be
already handled.

Three real problems were hit and are written up in the Troubleshooting Guide: the dev server's
watcher blocking the OpenNext build, orphaned `workerd` processes surviving the npm wrapper, and
Node 26 refusing to spawn `npx.cmd`.

**Phase 5 was local-only.** Nothing was deployed in it and the remote database was untouched.
Deployment was the separate close-out below, which began after Kusuma reviewed and approved
Phase 5 on August 30, 2026 and **is now complete** - see the Deployment Close-Out for what went
live.

### Deployment Close-Out - COMPLETED

**Objective**: The feature runs on Cloudflare at a live URL that can be submitted.

**This is not Phase 6 and it is not part of the phased build.** It is a close-out step that runs
after Phase 5 is reviewed and approved. Phases 1 through 5 remain local-only; nothing here changes
that.

**Authorization, recorded because two guardrails require it.** `AGENTS.md` says "Do not deploy.
Never run `npm run deploy` unless explicitly asked" and "Do not touch the remote database.
Migrations may be applied locally only." `.cursor/rules/d1.mdc` says "Never apply migrations to the
remote database... Remote schema changes are the user's decision to make and execute." **Kusuma
explicitly asked for both on August 29, 2026**, because Sprint 2 is graded on a working live URL.
That request is the authorization those rules require, and it is scoped to this close-out: it does
not make deploying a routine action, and a later sprint needs its own.

**Tasks**:

1. Confirm Phase 5 is approved. If it is not, stop.
2. Confirm the working tree is clean and every phase commit is pushed to `feature/mcq-crud`.
3. Check what the remote database currently holds:
  `npx wrangler d1 migrations list aisprint-quizmaker-db --remote`. Expect `0001` to be
   unapplied, since Sprint 1 shipped nothing remotely - so this step applies **both** migrations,
   not just `0002`. Report what the list actually says before applying anything.
4. Apply remotely, with Kusuma present for it:
  `npx wrangler d1 migrations apply aisprint-quizmaker-db --remote`. Paste the output.
5. Verify the remote schema: `npx wrangler d1 execute aisprint-quizmaker-db --remote` with
  `PRAGMA table_info` for `users` and all three `mcq_` tables.
6. Deploy: `npm run deploy`. Paste the output including the deployed URL.
7. Walk the full journey against the live URL: create, list, edit, preview correct, preview
  incorrect, delete. Confirm the correct-answer flag is absent from the live responses too - the
   check that mattered locally matters more in public.
8. Confirm attempts were written remotely, with `user_id` null.
9. Record the live URL in this PRD's Current Status, and note that the remote database now carries
  the schema.
10. Update Known Limitations: the "not deployed" entry becomes a statement of what *is* deployed.
11. Report back and stop. Kusuma submits the URL and the exported chat.

**Deliverables**:

- Both migrations applied remotely, with pasted output
- A deployed Worker and its live URL, recorded in Current Status
- Pasted evidence of the live journey
- This PRD updated to describe a deployed state

**Stop conditions specific to this step**: if `wrangler` cannot authenticate, if the remote
migration list shows something unexpected, or if the deploy would overwrite something Kusuma has
not seen, stop and ask rather than pressing on. A half-applied remote migration is materially
worse than an unapplied one.

**Outcome** (August 30, 2026): **deployed and verified in production.**

**Live URL**: [https://aisprint-quizmaker.kusuma-bs.workers.dev](https://aisprint-quizmaker.kusuma-bs.workers.dev)
**Version ID**: `54fa8c9a-882e-4c78-a364-5a285ae3b7dc`

**Task 3 found this document's own prediction to be wrong, which is why the step existed.** The
PRD expected both migrations to be pending and said so in task 3. The remote list showed only
`0002`:

```
Migrations to be applied:
┌────────────────────────────┐
│ 0002_create_mcq_tables.sql │
└────────────────────────────┘
```

`0001_create_users_table.sql` had already been applied remotely on **2026-08-24**, during Sprint
1, and the remote `users` table held **4 real accounts**. So Sprint 1 did ship its schema
remotely, contrary to what this PRD assumed when it was written. Reading the remote database
before writing to it is what turned a wrong assumption into a footnote instead of a surprise.
The surprise ran in the safe direction - one additive migration against an existing database
rather than two against an empty one - so applying was still correct, but the check is the reason
that could be said with confidence rather than hoped.

**Task 4, applied remotely**: `🚣 Executed 8 commands` - three `CREATE TABLE` and four
`CREATE INDEX`, plus the migration bookkeeping - and `0002_create_mcq_tables.sql ✅`. Nothing in
`users` was read or written by it.

**Task 5, remote schema verified**: `migrations list --remote` now answers
`✅ No migrations to apply!`, `d1_migrations` carries both rows, and the remote database holds
`users`, `mcq_questions`, `mcq_choices`, `mcq_attempts` with all four named indexes present.

**Task 6, deployed**: `npm run deploy` uploaded 6358.84 KiB (1300.73 KiB gzipped) with a 30 ms
worker startup time, bound `env.DB (aisprint-quizmaker-db)` and `env.ASSETS`, and printed the URL
above. The route table in the deploy build is identical to Phase 5's. No production secret was
needed: the only binding is D1, and the sole `.dev.vars` entry (`NEXTJS_ENV=development`) is
development-only.

**Task 7, the journey walked against the live URL.** Same headless-Chrome driver, pointed at
`https://`. Create with three choices, edit to add a fourth, preview wrong then right, cancel the
delete, then confirm it - every observation matched local. **The answer key is absent in public**:
`GET /api/mcq/[id]` returns choices carrying exactly `id, text, position`, and the live preview
page's HTML contains zero occurrences of `isCorrect`, `is_correct`, or the word "correct". A
choice belonging to another question returns `404 {"error":"Question not found"}`, byte-identical
to the unknown-question 404, so IDs cannot be probed on the open internet. A body sending
`isCorrect: true` with a wrong choice was still answered `{"isCorrect":false}`.

**Task 8, attempts confirmed in the remote database**, read while the question still existed:

```
{ "user_id": null, "selected": "Nice",  "choice_is_correct": 0, "attempt_is_correct": 0 }
{ "user_id": null, "selected": "Paris", "choice_is_correct": 1, "attempt_is_correct": 1 }
```

`user_id` is NULL, as Known Limitation 3 requires, and each verdict was derived from the stored
choice rather than sent by the browser. Deleting the question then cascaded its choices and both
attempts away, remotely.

**Kusuma was already using the live site during this step**, which produced better evidence than
the walkthrough did. A question of her own - *"General questions / what is the capital of India?"*

- was present before the driver ran, created through the deployed UI, with `Delhi` stored as
`is_correct: 1` at position 1. Real production data written by a real user, correct in the
database. The walkthrough worked around it, deleted only its own throwaway rows, and left hers
intact; the remote user count also rose from 4 to 5 as she registered. Nothing here created or
removed an account.

---



## Technical Implementation Details



### Key Files


| File                                            | Purpose                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `migrations/0002_create_mcq_tables.sql`         | The only definition of the three tables                                     |
| `src/lib/services/mcq-service.ts`               | The only module in this feature that touches D1                             |
| `src/lib/validation/mcq.ts`                     | Zod schemas and the one message per failure                                 |
| `src/app/api/mcq/route.ts`                      | `GET` list, `POST` create                                                   |
| `src/app/api/mcq/[id]/route.ts`                 | `GET` one, `PUT` update, `DELETE`                                           |
| `src/app/api/mcq/[id]/attempts/route.ts`        | `POST` an attempt; server-side scoring                                      |
| `src/lib/mcq-client.ts`                         | Client-side fetch and error mapping, like `auth-client.ts`                  |
| `src/components/mcq/mcq-form.tsx`               | Shared by create and edit                                                   |
| `src/components/mcq/question-actions.tsx`       | Three-dots dropdown                                                         |
| `src/components/mcq/delete-question-dialog.tsx` | Confirmation before delete                                                  |
| `src/components/mcq/preview-form.tsx`           | Radio group, submit, verdict                                                |
| `src/components/mcq/questions-table.tsx`        | The table and the create control, split out of the page so it can be tested |
| `src/app/mcq/layout.tsx`                        | Header and page shell; the only place the logout control is declared        |
| `src/app/mcq/page.tsx`                          | The table, a Server Component                                               |
| `src/app/mcq/new/page.tsx`                      | Create                                                                      |
| `src/app/mcq/[id]/edit/page.tsx`                | Edit                                                                        |
| `src/app/mcq/[id]/preview/page.tsx`             | Preview                                                                     |




### Layering

```
Page (Server Component) ─── reads ──▶ mcq-service ──▶ D1
        │
        └── Client component ── fetch ──▶ /api/mcq/... ──▶ mcq-service ──▶ D1
```

Reads for the initial render go straight through the service, because a Server Component calling
its own HTTP API would be a needless round trip. Mutations go over HTTP from client components and
are followed by `router.refresh()`. Nothing above the service imports `getCloudflareContext()`,
and no client component imports the service.

### Implementation Patterns

Atomic create, the pattern SD2 exists to enable:

```ts
export async function createQuestion(input: CreateQuestionInput) {
  const db = await getDb();
  const id = crypto.randomUUID();

  const statements = [
    db
      .prepare(
        `INSERT INTO mcq_questions (id, name, question_text, created_by)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(id, input.name, input.questionText, null),
    ...input.choices.map((choice, index) =>
      db
        .prepare(
          `INSERT INTO mcq_choices (question_id, choice_text, is_correct, position)
           VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(id, choice.text, choice.isCorrect ? 1 : 0, index),
    ),
  ];

  await db.batch(statements);
  return findQuestionById(id);
}
```

Scoring, with the verdict taken from storage:

```ts
const { results } = await db
  .prepare(
    `SELECT id, is_correct FROM mcq_choices WHERE id = ?1 AND question_id = ?2`,
  )
  .bind(selectedChoiceId, questionId)
  .all<Pick<ChoiceRow, "id" | "is_correct">>();

const choice = results[0];
if (!choice) {
  return undefined;
}

const isCorrect = choice.is_correct === 1;
```



### Important Notes

- `crypto.randomUUID()` is available on Workers and on Node 22. No dependency, no polyfill.
- `db.batch()` runs its statements in one transaction. A failure rolls the whole batch back, which
is the guarantee this design is built on.
- D1 enforces foreign keys, so `ON DELETE CASCADE` fires without an application-level cleanup.
Phase 1 task 7 verifies this rather than assuming it.
- `is_correct` crosses the service boundary as a `boolean`; the `0`/`1` representation stops there.
- The one existing `Badge` import in `src/app/mcq/page.tsx` is currently unused behind commented
markup and disappears in the Phase 4 rewrite.

---



## Acceptance Criteria

Pass or fail, marked against observed behaviour rather than inspection, in the phase that produced
the evidence.

**Schema**

All six verified in Phase 1 against real `wrangler d1 execute --local` output.

- [x] `mcq_questions`, `mcq_choices`, and `mcq_attempts` exist with exactly the columns above
- [x] `created_by` and `user_id` are nullable; every other non-defaulted column is `NOT NULL`
- [x] Deleting a question deletes its choices
- [x] Deleting a question deletes its attempts
- [x] All four named indexes are present in `PRAGMA index_list`
- [x] `is_correct` rejects a value other than `0` or `1`
- [x] Foreign keys are enforced, not merely declared - an orphan choice is rejected with
  ```
  `FOREIGN KEY constraint failed` (added in Phase 1; the cascades above mean nothing without
  it)
  ```

**Service**

Verified in Phase 2. Marked where the evidence came from, since the batch grouping is proven by
unit test and the SQL behaviour by real `wrangler d1 execute --local` output.

- [x] `createQuestion` writes the question and all choices in a single `db.batch()` call - one
  ```
  batch of 1 + N statements, with no insert issued outside it
  ```
- [x] A failed batch leaves no question row behind - `CHECK` violation on a sibling insert, and
  ```
  the question did not survive
  ```
- [x] `updateQuestion` replaces choices rather than appending to them - 3 choices became 2
- [x] Choices are always returned in `position` order - proven against ids that sort differently
- [x] `recordAttempt` returns `undefined` for a choice belonging to another question, and writes
  ```
  nothing in that case
  ```
- [x] `recordAttempt` writes `user_id` as `NULL`
- [x] No `.first()` anywhere in the service
- [x] No SQL outside `mcq-service.ts` for this feature

**API**

Verified in Phase 3 by route tests with the service mocked at the module boundary. Re-confirmed
against the running Workers runtime in Phase 5.

- [x] `GET /api/mcq` returns every question, unfiltered by creator
- [x] `POST /api/mcq` returns 201 and the created question with its choices
- [x] One choice is a 400; seven choices is a 400; an empty choice is a 400
- [x] Zero correct choices is a 400; two correct choices is a 400
- [x] Malformed JSON is a 400, not a 500
- [x] An unknown ID is a 404 on GET, PUT, DELETE, and the attempts route
- [x] `GET /api/mcq/[id]` returns no `isCorrect` field anywhere in the payload
- [x] A body claiming the wrong answer is correct still returns incorrect
- [x] A choice ID from another question returns 404 rather than being scored
- [x] The attempts route returns an identical 404 for an unknown question and an unknown choice,
  ```
  so ids cannot be probed
  ```
- [x] A caller cannot set `id` or `createdBy` through the create body - Zod strips them

**UI**

Verified in Phase 4 by component tests and by a real browser walkthrough driven over the Chrome
DevTools protocol. Re-confirmed on the Workers runtime in Phase 5.

- [x] `/mcq` lists all questions with name, question text, and an actions column
- [x] The actions trigger is the three-vertical-dots icon and has an accessible name
- [x] The dropdown offers exactly Edit, Preview, and Delete
- [x] Delete shows a confirmation dialog, and cancelling it deletes nothing
- [x] Create and edit render the same form component
- [x] A new question starts with two empty choice rows
- [x] Add choice is disabled at six rows; remove is disabled at two
- [x] Marking a choice correct unmarks the previously marked one
- [x] Save and Cancel are side by side, equal width, and neither overflows the viewport
- [x] Cancel returns to `/mcq` without writing
- [x] Preview renders the choices as radio options and cannot submit with none selected
- [x] Preview reports correct for the right answer and incorrect for a wrong one
- [x] The correct answer does not appear in the preview page source or its network responses
- [x] Every attempt is written to `mcq_attempts`

**Process**

- [x] Tests were written before implementation in every phase and observed failing first
- [x] `npm run test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` all pass
- [x] The full journey works under `npm run preview` on the Workers runtime
- [x] Only the four named shadcn components were added; no other dependency - verified in Phase 4
- [x] Any package that did prove necessary was installed with a real `npm install` and appears in
  ```
  `package.json`, with no manual `node_modules` edits, junctions, or copied folders - vacuously
  true, since no package proved necessary and `package.json` is byte-identical to Sprint 1's
  ```
- [x] Nothing was deployed and the remote database was untouched **for the whole of Phases 1
  ```
  through 5**
  ```
- [x] The build's route table lists exactly the six intended routes, and no `*.test.ts` file was
  ```
  picked up as a route - verified in Phase 3
  ```

**Deployment close-out** - marked only after Phase 5 is approved

- [x] Both migrations are applied to the remote database, evidenced by `migrations list --remote`
  ```
  - now `✅ No migrations to apply!`; `0001` turned out to have been applied back on 2026-08-24
  ```
- [x] The remote schema shows `users` and all three `mcq_` tables - plus all four named indexes
- [x] `npm run deploy` succeeded and produced a live URL
- [x] The full journey works against the live URL, not just locally
- [x] The correct-answer flag is absent from live API responses and page source - 0 occurrences of
  ```
  `isCorrect`, `is_correct`, or even the word "correct"
  ```
- [x] An attempt made against the live URL is written to the remote `mcq_attempts` - two, both with
  ```
  `user_id` NULL and a verdict matching the stored choice
  ```
- [x] The live URL is recorded in Current Status

---



## Success Metrics


| Metric                         | Target                                                                  | How Measured                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Question creation              | A teacher can go from `/mcq` to a saved question in one form submission | Manual walkthrough under `npm run preview` - **met**, walked on 8787                                                                            |
| Answer integrity               | 0 of N forged-correctness requests are scored as correct                | Phase 3 test plus a manual request in Phase 5 - **met**, 0 of 2                                                                                 |
| Attempt capture                | 100% of preview submissions produce an `mcq_attempts` row               | `SELECT COUNT(*)` before and after - **met**, 2 submissions, 2 rows                                                                             |
| Referential integrity          | 0 orphaned choice or attempt rows after a delete                        | `wrangler d1 execute --local` after Phase 1 task 7 - **met**, 1/4/2 to 0/0/0                                                                    |
| Scope discipline               | 0 items from the Not Building list implemented                          | Review of this PRD against the diff at Phase 5 - **met**, and no dependency added either                                                        |
| Test coverage of failure paths | Every 400 and 404 in the API section has a test                         | Count against the endpoint list - **met**, and each re-confirmed on the runtime                                                                 |
| Batch atomicity                | 0 orphaned question rows after a deliberately failed batch              | Phase 2 task 6, against the real local database - met: 0 orphans                                                                                |
| Deployment                     | A live URL serving the full journey                                     | Close-out task 7 - **met**, walked against [https://aisprint-quizmaker.kusuma-bs.workers.dev](https://aisprint-quizmaker.kusuma-bs.workers.dev) |
| Remote schema parity           | Remote schema matches local for all four tables                         | Close-out task 5 - **met**, four tables and four named indexes, `No migrations to apply`                                                        |
| Answer integrity in public     | The answer key is absent from live responses and page source            | Close-out task 7 - **met**, 0 occurrences, and cross-question scoring 404s                                                                      |


---



## Dependencies



### External Dependencies

- **Cloudflare D1** - `aisprint-quizmaker-db`, binding `DB`. Local for Phases 1 to 5; the remote
database is used in the Deployment Close-Out.
- **Wrangler** - migration creation, local application, `npm run preview`, and the remote
migration at close-out.
- **A Cloudflare account with working** `wrangler` **credentials** - needed only by the close-out. If
authentication fails there, the deploy stops and Kusuma runs it; per `AGENTS.md` a cloud agent
has no credentials and must not try to authenticate.



### Internal Dependencies

- `users` table from migration `0001` - the target of both new foreign keys.
- `src/lib/validation/auth.ts` - `toFieldErrors` is reused, not reimplemented.
- `src/lib/auth-client.ts` - the shape `mcq-client.ts` follows.
- `src/components/auth/logout-button.tsx` - stays in the `/mcq` header.
- `src/components/ui/*` - `table`, `button`, `input`, `label`, `field` already present.



### New Packages

**None.** No npm dependency is added in Sprint 2. The four shadcn components are source files
copied into `src/components/ui/`, not packages. `crypto.randomUUID()` is runtime-provided. If any
phase appears to need a package, that is a stop condition, per `AGENTS.md`.

If Kusuma approves one, it is installed with a real `npm install` / `npm install -D` and both
`package.json` and `package-lock.json` are committed. No junctions, no hand-copied folders, no
`node_modules` edits - the result must survive a fresh clone. See Notes for AI Agents, item 11.

### Environment Variables

**None.** No new variable, so `.dev.vars.example` is unchanged.

---



## Risks and Mitigation



### Technical Risks

- **Risk**: One of the four shadcn components does not exist for the Base UI base and `add`
produces no files, as `.cursor/rules/shadcn.mdc` warns.
**Mitigation**: Phase 4 task 1 checks what actually landed before anything is built on it. The
fallbacks are the installed `dialog` in place of `alert-dialog`, and Base UI's `menu` in place of
`dropdown-menu`. A radio group can be composed from `field` and native inputs if it comes to
that. No new UI library either way; if none of the fallbacks work, stop and ask.
- **Risk**: `db.batch()` behaves differently in local Wrangler than the tests' fake suggests, or
does not roll back as expected.
**Mitigation**: Phase 1 verifies cascades against the real database, and Phase 5 exercises create
and update under `npm run preview`. The batch guarantee is not taken on trust from a mock.
- **Risk**: Foreign keys turn out not to be enforced, so cascades silently do nothing and orphans
accumulate.
**Mitigation**: Phase 1 task 7 deletes a question that has choices and attempts and checks the
rows are gone. This is a real-database check by design.
- **Risk**: The correct answer leaks to the browser through the RSC payload or an API response,
making preview meaningless.
**Mitigation**: `PublicChoice` has no `isCorrect` field, the edit path uses a separate
server-only shape, and there are checks in both Phase 3 and Phase 5.
- **Risk**: Rewriting choices on update changes their IDs, breaking anything holding one.
**Mitigation**: Nothing holds a choice ID across an edit in Sprint 2. Recorded in Known
Limitations so a later sprint is not surprised.
- **Risk**: `npm run preview` on Windows orphans `wrangler dev`, which locks `.open-next/` and
makes the next build fail with `EBUSY` - hit in Sprint 1, twice.
**Mitigation**: Kill the `wrangler dev` process itself, not just the npm wrapper. See Sprint 1's
Troubleshooting entry.
- **Risk**: The `[id]` dynamic segment and its nested `attempts` route collide or resolve
unexpectedly.
**Mitigation**: Route tests in Phase 3 exercise both paths; Phase 5 confirms on the real runtime.



### User Experience Risks

- **Risk**: Save and Cancel overflow on a narrow viewport - the specific thing this brief calls
out.
**Mitigation**: `grid grid-cols-2 gap-3` with `w-full` buttons, so width is a fraction of the
container rather than intrinsic to the label. Explicitly checked in Phase 4 task 6.
- **Risk**: A teacher deletes a question by accident.
**Mitigation**: `AlertDialog` naming the question, with a cancel path that writes nothing.
- **Risk**: A teacher fills in five choices and loses them to a validation failure on save.
**Mitigation**: The form validates client-side with the same schema and keeps state on failure;
errors render per field through `FieldError`.
- **Risk**: Because every question is visible to every teacher, one teacher edits or deletes
another's work.
**Mitigation**: Not solvable without sessions. Documented in Known Limitations rather than
papered over.



### Process Risks

- **Risk**: The sprint drifts into session management, the single most tempting out-of-scope item,
because so much here would be better with it.
**Mitigation**: Named in Out of Scope, in Not Building, and as a stop condition. `user_id` stays
null.
- **Risk**: A phase rolls into the next without review, or work is committed before approval.
**Mitigation**: `.cursor/rules/phase-commit.mdc`, which always applies.
- **Risk**: A closed phase gets quietly edited later, so the chat transcript no longer explains
the diff - and the transcript is what gets submitted.
**Mitigation**: Notes for AI Agents, item 12. Later fixes are requested in chat and approved
before they are made.



### Deployment Risks

- **Risk**: `0001` was never applied remotely, so the remote database has no `users` table and the
new foreign keys have nothing to point at. Applying only `0002` would fail or, worse, half-apply.
**Mitigation**: Close-out task 3 runs `migrations list --remote` and reports what is actually
there **before** applying anything. Expect both migrations to run.
- **Risk**: A remote migration partially applies and leaves the database in a state no local
environment matches.
**Mitigation**: Both migrations are pure `CREATE TABLE` and `CREATE INDEX` with no data
movement, so a failure leaves a missing table rather than a corrupted one. Task 5 verifies the
remote schema explicitly, and a surprise is a stop condition rather than something to retry.
- **Risk**: The deployed app behaves differently from `npm run preview`, so the first real
exercise of the code is in public.
**Mitigation**: Phase 5 already runs the whole journey on the Workers runtime locally, which is
the same runtime. Close-out task 7 repeats it live rather than assuming parity.
- **Risk**: The live URL is public and the app has no authentication, so anyone who has it can
create and delete questions.
**Mitigation**: Accepted and documented as Known Limitation 16. The URL is a graded
demonstration, not a service. Do not paper over it with a password prompt - that is session
work, and it is out of scope.
- **Risk**: Deploying is treated as routine afterwards, or as something to redo whenever
convenient.
**Mitigation**: The close-out records a one-off authorization scoped to this sprint. `AGENTS.md`
still governs; a later deploy needs a later request.

---



## Not Building

Sprint 2 is graded partly on scope control, so this is the explicit list. None of the following is
built, scaffolded, or half-wired, and no "just in case" column, route, or component is added for
any of it.

1. **Session management** - no cookies, no JWT, no session store, no auth middleware, no route
  protection.
2. **Other question types** - no true/false, short answer, or multi-select.
3. **A question bank, categories, or tags.**
4. **Search, sorting, or pagination** on the question list.
5. **Sharing questions between teachers**, and no permissions model.
6. **Quizzes, grading, reports, or analytics** over `mcq_attempts`.
7. **Image upload or rich text** in questions or choices - plain text only.
8. **Student-facing flows** - preview is the teacher answering their own question.
9. **An E2E test framework** - no Playwright, no Cypress. Vitest only.
10. **Toast or notification libraries** - no `sonner`, no `react-hot-toast`, no toast component.
  Success and failure are communicated by navigating back to `/mcq` and by inline `FieldError`
    messages, which is what the installed components already support.
11. **Animation libraries** - no `framer-motion`, no `motion`, no new animation package. Note that
  `tw-animate-css` is **already a dependency** from the project starter and is used by the
    existing shadcn components; leaving it alone is not the same as adding one. Nothing in this
    sprint adds a new animation dependency or hand-written transitions.
12. **Drag-to-reorder on the choice rows.** The `position` column exists and keeps display order
  stable, but order is assigned by the row's index in the form and nothing lets a teacher drag
    rows around. Reordering means removing a choice and re-adding it. Dragging would need a
    dependency and a keyboard-accessible equivalent, which is a piece of work in its own right.
13. **Soft delete, restore, an archive, or an undo.** `deleteQuestion` issues a real `DELETE` and
  the row is gone, along with its choices and attempts. There is no `deleted_at` column, no
    trash view, and no way back. The `AlertDialog` confirmation is the only safeguard, which is
    why it is not optional.

If any of these looks necessary during implementation, **stop and ask Kusuma** rather than
building it.

---



## Known Limitations

Accepted and deliberate. Limitations of the sprint, not defects to file.

1. **No session management**, inherited from Sprint 1 and unchanged. Everything below follows.
2. `created_by` **is always** `NULL`**.** The column and its foreign key are real, but with no session
  there is no caller to attribute a question to.
3. `mcq_attempts.user_id` **is always** `NULL`, for the same reason. Every attempt is anonymous.
4. `/mcq` **shows every question to everyone.** With no identity there is nothing to filter on, so
  any teacher can edit or delete any question.
5. `idx_mcq_questions_created_by` **and** `idx_mcq_attempts_user_id` **index all-null columns.** They
  are built for the shape the schema will have once sessions exist, and buy nothing today.
6. **All four pages are reachable without logging in**, exactly as the `/mcq` stub was.
7. **"Exactly one correct choice" is not enforced by the database.** Zod and the service enforce
  it; SQL written directly against D1 could violate it. Deliberate, per Cut.
8. **Editing a question replaces its choices**, so choice IDs change on every save, and attempts
  recorded against the old choices cascade away. Editing therefore discards that question's
   attempt history.
9. **Deleting a question deletes its attempts** (SD3). Attempt data is not durable.
10. **Nothing reads** `mcq_attempts`**.** Rows are written and never displayed or aggregated;
  reporting is out of scope.
11. **No draft state.** A question is either saved and live in the list or it does not exist.
12. **No optimistic concurrency.** Two teachers editing the same question simultaneously means
  last write wins, silently.
13. **Question and choice text are plain text only**, and are rendered as text - no formatting,
  no images.
14. `findQuestionForEditing` **has no HTTP route by design.** It is server-side only, because it
  returns the answer key.
15. **Deployed.** This entry previously read "local-only until the close-out" and was written to be
  rewritten here. It now records what is live:
    **[https://aisprint-quizmaker.kusuma-bs.workers.dev](https://aisprint-quizmaker.kusuma-bs.workers.dev)**, version
    `54fa8c9a-882e-4c78-a364-5a285ae3b7dc`, backed by the remote `aisprint-quizmaker-db` carrying
    both migrations and all four tables. The live site and the local database are entirely
    separate stores; a question created locally does not appear in production, and vice versa.
16. **The deployed app carries every limitation above, in public, and this is no longer
  hypothetical.** Items 1 through 6 mean **anyone with the URL can list, create, edit, preview,
    and delete every question without logging in** - `/mcq` and its API answer unauthenticated
    requests, as verified during the close-out. The login page exists and works, but nothing
    depends on having used it. This is the accepted, understood consequence of a session-less
    sprint, and it is why the live URL is a graded demonstration rather than anything that should
    hold real content. It is the single most important thing a session layer would fix.
17. **The live question list is unfiltered.** Every teacher sees every question, because
  `created_by` is NULL for all of them and there is nothing to filter on. On a shared live URL
    that means one person's questions are visible and editable by anyone else who opens it.
18. **No CI/CD.** The close-out deploy is manual and one-off; nothing redeploys on push. The live
  Worker will keep serving version `54fa8c9a` until someone runs `npm run deploy` again.

Sessions remain the natural next sprint, and would fill in items 2 through 6 without reshaping
anything here. They are also what items 16 and 17 are waiting on.

---



## Troubleshooting Guide

Populated as real problems are hit. Sprint 1's guide is a useful precedent; several of its entries
are still live for this repository.

### Carried over from Sprint 1 and still relevant

`getCloudflareContext()` **throws under jsdom** - mock `@opennextjs/cloudflare` and supply a fake
`env`, per `.cursor/skills/testing/SKILL.md`.

**D1 parameter binding errors in local Wrangler** - use numbered placeholders (`?1`, `?2`)
throughout and never mix them with anonymous `?`.

`preview` **fails with** `EBUSY: rmdir '.open-next\assets'` - an orphaned `wrangler dev` is holding
the directory. Kill that process, not just the npm wrapper.

`npm run lint` **reports thousands of errors after** `preview` - generated bundles under
`.wrangler/tmp/`. `.wrangler/**` is in the ESLint ignores; if the errors appear, check that ignore
is intact.

### Resolved (Phase 3): `npm run build` passes TypeScript but `npx tsc --noEmit` reports errors

**Problem**: The production build reported its TypeScript step finished cleanly, while
`npx tsc --noEmit` reported 9 errors - `TS18046: 'body' is of type 'unknown'` and `TS2571: Object is of type 'unknown'` - all in colocated `route.test.ts` files.

**Cause**: Next's build typechecks the files in its own build graph. Test files are not imported
by the application, so they are never in it. `tsc --noEmit` reads `tsconfig.json` and checks
everything, tests included. The two are not interchangeable, and the build is the weaker check.

**Solution**: Narrow `response.json()` once per test file with a typed helper rather than
asserting inline:

```ts
type ErrorBody = { error?: string; fields?: Record<string, string> };

async function errorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}
```

**Wider lesson**: run `npx tsc --noEmit` at every phase gate, not only at Phase 5. A green build
and a green test run together still let type errors accumulate in test files.

**Code Reference**: `src/app/api/mcq/route.test.ts:48-55`

### Resolved (Phase 4): Base UI menus do not open under jsdom

**Symptom**: `userEvent.click()` on the dropdown trigger left `aria-expanded="false"` and rendered
no menu items, so every test of the actions menu failed at the first assertion.

**Cause**: Base UI's menu opens from `pointerdown`. jsdom reports `PointerEvent` as defined but
does not implement `Element.prototype.hasPointerCapture` or `scrollIntoView`, and polyfilling
those did not help - a click still did not open the menu. This was established by a throwaway
probe that rendered each primitive and dumped its DOM, rather than by guessing.

**Resolution**: the tests focus the trigger and press Enter, which opens the menu reliably. That
is a real path a teacher can take, and the assertions about the menu's contents are unaffected by
how it was opened. The mouse path is covered instead by the browser walkthrough, where
`Input.dispatchMouseEvent` produces genuine pointer events. The reason is recorded in a comment
at the top of `question-actions.test.tsx` so nobody later "fixes" the keyboard interaction back
into a click and watches it fail.

**Worth knowing for Phase 5 and beyond**: the same probe showed Base UI renders a radio as a
`span` with `role="radio"` and `aria-checked`, plus a hidden native input, so checkedness is read
from the attribute rather than from `.checked`. The alert dialog does expose `role="alertdialog"`
and works under jsdom without help.

### Resolved (Phase 4): `Button` wrapping a `Link` either warns or lies about its role

**Symptom**: `<Button render={<Link href="/mcq/new" />}>` printed a console error on every render
of `/mcq`: *"A component that acts as a button expected a native* `<button>` *because the*
`nativeButton` *prop is true."* The Next.js dev overlay showed it as "1 Issue".

**What the obvious fix did**: setting `nativeButton={false}`, as the message suggests, silenced
the warning but made Base UI put `role="button"` on the anchor. Three tests querying
`getByRole("link", { name: /create question/i })` went red, and rightly so - the control
navigates, so announcing it as a button is worse than the warning was.

**Resolution**: drop `Button` for this control and style the anchor directly with
`buttonVariants()`. It looks identical, keeps the link role, and the console is clean.

**Wider lesson**: this only surfaced because the browser console was read during the walkthrough.
The tests passed throughout, and the build never mentioned it.

### Resolved (Phase 5): `npm run preview` fails with EPERM before it compiles anything

**Symptom**: the OpenNext build died immediately, on its own output directory:

```
Error: EPERM, Permission denied: \\?\C:\aisprint-quizmaker\aisprint-quizmaker\.open-next
    at Object.rmSync (node:fs:1206:18)
    at Module.initOutputDir (.../@opennextjs/aws/dist/build/helper.js:348:8)
```

**Cause**: `npm run dev` was still running. Its file watcher holds a handle on
`.open-next/assets`, and on Windows an open directory handle makes the directory
undeletable - `Remove-Item` gave *"The process cannot access the file ... because it is being
used by another process."* OpenNext starts by clearing its output directory, so it never got as
far as the Next build. No `workerd` or `wrangler` process was running, which is what ruled out
the cause `AGENTS.md` already documented and pointed at the dev server instead.

**Resolution**: stop `npm run dev` before `npm run preview`. Now recorded in `AGENTS.md` under
the preview gotchas, alongside the orphaning problem, since the two look identical from the error
message and have different fixes.

### Resolved (Phase 5): stopping the preview leaves the runtime serving

**Symptom**: after killing the `npm run preview` process, `127.0.0.1:8787` was still answering
and `.open-next/` was still locked.

**Cause**: the tree is five processes deep - npm, `@opennextjs/cloudflare`, `wrangler.js`, its
node child, and **two** `workerd.exe`. Killing the npm wrapper orphans everything below it.
`AGENTS.md` warned about this in the singular; there are two `workerd` processes, not one.

**Resolution**: find the listener with
`(Get-NetTCPConnection -LocalPort 8787 -State Listen).OwningProcess`, then walk up
`ParentProcessId` via `Get-CimInstance Win32_Process` and stop the whole tree. Confirm with the
port check *and* by deleting `.open-next/`, since the port can free before the file handles do.

### Resolved (Phase 5): Node 26 will not spawn `npx.cmd`

**Symptom**: the walkthrough driver aborted at the database step with
`FAILED: spawnSync npx.cmd EINVAL`, after the UI half had already passed.

**Cause**: Node 26 refuses to execute `.cmd` and `.bat` files through `child_process.execFile`
without `shell: true`. Passing `shell: true` would have worked but would then have put SQL
containing spaces, commas, and quotes through the Windows command parser.

**Resolution**: run wrangler's JavaScript entry point under `process.execPath` -
`node node_modules/wrangler/bin/wrangler.js d1 execute ...`. No shell, so no quoting, and the SQL
is passed as a single argv element unchanged.

### Resolved (Close-Out): the remote migration list did not match this PRD

**Symptom**: `wrangler d1 migrations list --remote` showed only `0002` pending. This document's
task 3 said to expect both, "since Sprint 1 shipped nothing remotely".

**Cause**: the assumption was wrong. `0001_create_users_table.sql` was applied remotely on
2026-08-24, during Sprint 1, and the remote `users` table already held 4 accounts. Sprint 1's PRD
describes local work, and this PRD inferred from that that nothing remote had happened - an
inference, not a fact, and it was not true.

**Resolution**: none needed. Applying `0002` alone was the correct action and is additive, so the
existing accounts were never at risk. Recorded because the *process* is the point: task 3 exists
to read the remote state before writing to it, and it earned its place the first time it ran. A
close-out that had trusted the PRD and run `apply` blind would have got the same result by luck.
**Do not delete this entry to make the plan look right.**

### Confirmed harmless (Phase 5): the anticipated problems

`db.batch()` **and the test fake** - happened as expected in Phase 2 and was fixed there by
extending the fake to record batches. Kept here only so the prediction and its outcome stay
together.

**A** `CHECK` **violation surfaces as a generic D1 error** - still true, and still not a problem.
Nothing in the feature needs to distinguish a `CHECK` failure at the service boundary, because
Zod rejects those bodies before any SQL runs; the constraint is a backstop, not a control flow.
No `uniqueConflictColumn`-style message matching was needed and none was added.

---



## Notes for AI Agents

1. Read Overview and Hypothesis first, then Scope and Not Building. **Do not build anything in Out
  of Scope, Cut, or Not Building.**
2. Read Decisions Settled before questioning the ID generation, the route-handler choice, or the
  attempt cascade. All three were decided with the alternatives on the table.
3. **Only** `src/lib/services/mcq-service.ts` **touches D1 for this feature.** Same invariant as
  `user-service.ts` in `AGENTS.md`.
4. **Correctness is never taken from the client.** If you find yourself reading an `isCorrect` out
  of a request body, stop.
5. `PublicChoice` must not gain an `isCorrect` field. That field leaking is the failure mode this
  design is shaped around.
6. Do one phase at a time. Stop at the gate. Do not commit before approval - see
  `.cursor/rules/phase-commit.mdc`.
7. Tests first, watched failing, then implementation. Never weaken a test to reach green.
8. Update phase markers, Acceptance Criteria, Troubleshooting, and Current Status as work
  proceeds, in the same commit as the code.
9. Cite code as `filepath:line-number`.
10. Adding a dependency, or needing anything from Not Building, is a stop condition. Ask Kusuma.
  Applying a migration remotely and deploying are stop conditions **during Phases 1 to 5**; both
    are authorized in the Deployment Close-Out and nowhere else.
11. **Install packages properly, or not at all.** If something turns out to be missing, it goes
  into `package.json` through a real `npm install` or `npm install -D`, run in the repository
    root, with the resulting `package.json` and `package-lock.json` changes committed. **Never**
    work around a missing package with a directory junction, a symlink, a hand-copied folder, a
    hand-edited `node_modules`, or an edit to `package.json` without an install to back it. The
    test is a fresh clone: someone who runs `npm install` on a clean checkout must end up with
    exactly what the agent had. Anything that only works on this machine is not done. Adding the
    package still requires asking first, per `AGENTS.md` - this rule governs *how* it is added
    once approved.
12. **No silent edits after a phase closes.** Once a phase has been approved and committed, its
  files are not touched again on the agent's own initiative - not for a tidy-up, not for a
    rename, not to fix something spotted later. Raise it in chat, let Kusuma decide, and change it
    only after approval. The reason is that the chat transcript is the record of how this sprint
    was built: an edit that never appears as a request leaves a diff no one can trace back to a
    decision. This applies to the PRD too. If a later phase reveals that an earlier one was wrong,
    say so and ask - do not quietly correct it.

---



## Current Status

**Last Updated**: September 1, 2026 (revision 3 - sprint closed; header and status wording
brought into line with the deployed state)
**Current Phase**: All five phases complete and the Deployment Close-Out done. **The sprint is
finished.**
**Status**: DEPLOYED AND VERIFIED IN PRODUCTION
**Live URL**: **[https://aisprint-quizmaker.kusuma-bs.workers.dev](https://aisprint-quizmaker.kusuma-bs.workers.dev)**
**Version ID**: `54fa8c9a-882e-4c78-a364-5a285ae3b7dc`, deployed August 30, 2026

**What exists**: The branch `feature/mcq-crud`, cut from `main` at `215b615`, with one commit per
phase exactly as `.cursor/rules/phase-commit.mdc` requires:

| Commit | What it carries |
|---|---|
| `65aaaee` | Sprint 2 planning: this PRD and the phase-commit rule |
| `dc2fa74` | Phase 1: schema and migration - 25 migration assertions |
| `08bc57e` | Phase 2: MCQ service with atomic writes - 40 service tests |
| `d1e1e71` | Phase 3: API routes and validation - 71 validation and route tests |
| `7c2b177` | Phase 4: user interface - 56 component tests |
| `1df90e8` | Phase 5: Workers runtime verification and `AGENTS.md` |
| `3a3cfd6` | Deployment close-out: remote migration, deploy, and production verification |

Every phase was reviewed and approved by Kusuma before its commit, and nothing was committed to
`main`. This documentation revision is the final commit on the branch, which is ready to merge.

The feature is built, tested, and live: three tables, a service, six endpoints, four pages, and
**385 tests across 22 files** - 25 + 40 + 71 + 56 written for this sprint, on top of Sprint 1's
193, and every one of them written before the code it covers and observed failing first. Both
migrations are applied to the local **and** the remote database.
The full create/edit/preview/delete journey has been walked on three runtimes - Node under
`npm run dev`, workerd under `npm run preview`, and the deployed Worker - and behaved identically
on all three.

**What was proven rather than asserted.** Choices store the correct flag on the right row in
position order; attempt rows carry a verdict derived from the stored choice rather than from the
request, confirmed by joining the two in both databases; deleting a question cascades its choices
and attempts away; the answer key appears nowhere in any API response or page source, locally or
in public; and a choice belonging to another question returns a 404 identical to the
unknown-question one, so IDs cannot be probed.

**On scope.** `package.json` is byte-identical to `main` - **not one dependency was added at any
point in this sprint.** The only additions to the UI were four shadcn components, all of them
used. Nothing on the Not Building list was built: no sessions, no other question types, no
question bank, no search or sorting or pagination, no sharing, no quizzes or reports or analytics,
no rich text or image uploads, no student-facing flows, no E2E framework, no toast or animation
library, no drag-to-reorder, no soft delete. Where a shortcut was tempting, it was written into
Known Limitations instead of taken quietly.

**What is deliberately still missing**, and is the honest caveat on the live URL: there is **no
session management**, so `created_by` and `user_id` are always NULL, `/mcq` shows every question
to everyone without filtering by teacher, and every page and endpoint is reachable without logging
in. The login and registration flows work, but nothing depends on having used them. This was out
of scope by agreement at the start of the sprint, not an oversight, and it is the first thing a
follow-up sprint should address. See Known Limitations 1 through 6 and 16 through 17.

**Phase 1 result**: 25 migration assertions pass. All six Schema acceptance criteria ticked, plus
a seventh added for foreign-key enforcement.

**Phase 2 result**: 40 service tests pass. All eight Service acceptance criteria ticked.

**Phase 3 result**: 71 validation and route tests pass; full suite 329 passed across 18 files;
`tsc --noEmit` clean after fixing 9 type errors the build had not caught; lint 0 errors and 1
pre-existing warning (`Badge` unused in `src/app/mcq/page.tsx`, which Phase 4 rewrites). Build
route table confirmed to contain only the intended routes. All API acceptance criteria ticked,
plus the route-table Process criterion.

**Phase 4 result**: 56 component tests pass; full suite 385 passed across 22 files; lint,
`tsc --noEmit`, and `build` all clean, and the `Badge` warning is gone with the placeholder page
that carried it. Four shadcn components added and no dependency. The full journey was walked in a
real headless Chrome over the DevTools protocol, and every UI acceptance criterion is ticked
against what was observed there rather than by reading the code. Two Base UI problems were found
and written into the Troubleshooting Guide.

**Phase 5 result**: all four checks clean - 385 tests across 22 files, `eslint .` silent at exit
0, `npx tsc --noEmit` silent at exit 0, `next build` compiling with the route table unchanged.
The full journey was walked on the Workers runtime at `127.0.0.1:8787` under `npm run preview`
and behaved identically to the Node dev server. D1 was read mid-flow: choices stored with the
correct flag on the right row and in position order, and attempt rows whose `is_correct` matched
the selected choice's stored flag rather than anything the browser sent. The delete cascade took
1 question, 4 choices, and 2 attempts to zero. The answer key was absent from both the API
payload and the preview page's HTML on the runtime, and cross-question scoring returned a 404
identical to the unknown-question 404. `.wrangler/` and `.open-next/` were already ignored by
both ESLint and git, so lint stayed clean and `git status` stayed empty with 1,227 generated
files on disk; nothing was added. Three runtime and tooling problems were hit and written into
the Troubleshooting Guide. **All Schema, Service, API, UI, and Process criteria were ticked at
the end of this phase**, leaving only the Deployment criteria - which the close-out then closed.
**Every acceptance criterion in this document is now ticked.**

**Revision 2 changed**: deployment moved out of Out of Scope into a required Deployment Close-Out
after Phase 5, with Out of Scope, Acceptance Criteria, Known Limitations, Success Metrics, and
Dependencies all reworded to match; a real-database batch atomicity check added as Phase 2 task 6;
a build route-table check added as Phase 3 task 6; toast and animation libraries, drag-to-reorder,
and soft delete added to Not Building; and two working habits - proper `npm install` and no silent
post-phase edits - written into Notes for AI Agents.

**Close-out result**: `0002` applied remotely in 8 commands after the remote list revealed that
`0001` had been applied back on 2026-08-24 - a prediction in this document that was wrong and is
recorded in Troubleshooting rather than edited away. `npm run deploy` published version `54fa8c9a`
with a 30 ms startup time. The journey was walked against the live URL with the answer key absent
from every public response, and both attempts landed in the remote database with `user_id` NULL
and verdicts matching their stored choices. Kusuma's own question, created through the live UI
while this ran, was left untouched.

**Revision 3 changed**: no content, only status wording. The header still read
`Status: PLANNING - awaiting review of this document` and carried an August 29 modified date, and
a handful of forward-looking sentences still described deployment as something that would happen
later. The header now states the sprint is complete and deployed and carries the live URL and
version ID; the phase-commit list in Current Status is a table including the close-out commit
`3a3cfd6`; and the Phase 5 result no longer says the Deployment criteria are open, because they
are not. **The phase sections themselves were deliberately left in the tense they were written
in**, because they are a record of how the work was done and not a description of the outcome -
a note at the top of the document says so, to stop a later reader "fixing" them.

It also aligned two revision counters that had drifted apart: the header read "revision 2" while
this section read "revision 5", because the two were being bumped independently and this section
was not renumbered during Phases 4 and 5 even though its content was rewritten. Both now read
revision 3, and there is one counter for the document from here on.

**Next Steps**: none for this sprint. The branch is ready to merge to `main` and the live URL is
ready to submit. Sessions are the natural next sprint: they would fill in Known Limitations 2
through 6 and close 16 and 17 without reshaping anything built here.