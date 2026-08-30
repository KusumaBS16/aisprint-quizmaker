import { getCloudflareContext } from "@opennextjs/cloudflare";

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
  is_correct: number;
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

// Deliberately carries no correct-answer flag. This shape is what the preview page and
// every read route serialise, and shipping is_correct with it would let anyone read the
// answer out of the network tab before answering.
export interface PublicChoice {
  id: string;
  text: string;
  position: number;
}

// The answer key, for the edit form only. Reached through findQuestionForEditing, which
// is called from Server Components and has no HTTP route.
export interface AuthoringChoice {
  text: string;
  isCorrect: boolean;
}

export interface PublicQuestionWithChoices extends PublicQuestion {
  choices: PublicChoice[];
}

export interface AuthoringQuestion extends PublicQuestion {
  choices: AuthoringChoice[];
}

export interface QuestionInput {
  name: string;
  questionText: string;
  choices: AuthoringChoice[];
}

export interface AttemptResult {
  isCorrect: boolean;
  selectedChoiceId: string;
}

const QUESTION_COLUMNS =
  "id, name, question_text, created_by, created_at, updated_at";

const CHOICE_COLUMNS =
  "id, question_id, choice_text, is_correct, position";

// Sprint 2 has no session layer, so nothing can be attributed to a caller. Named rather
// than written as a bare null at each call site, so the reason travels with the value.
const NO_AUTHENTICATED_USER = null;

async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  return env.DB;
}

function toPublicQuestion(row: QuestionRow): PublicQuestion {
  return {
    id: row.id,
    name: row.name,
    questionText: row.question_text,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublicChoice(row: ChoiceRow): PublicChoice {
  return {
    id: row.id,
    text: row.choice_text,
    position: row.position,
  };
}

function toAuthoringChoice(row: ChoiceRow): AuthoringChoice {
  return {
    text: row.choice_text,
    isCorrect: row.is_correct === 1,
  };
}

async function findQuestionRow(
  db: D1Database,
  id: string,
): Promise<QuestionRow | undefined> {
  const { results } = await db
    .prepare(`SELECT ${QUESTION_COLUMNS} FROM mcq_questions WHERE id = ?1`)
    .bind(id)
    .all<QuestionRow>();

  return results[0];
}

// Ordered by position, with id as a tiebreak so the sequence is stable even if two rows
// ever share a position. Every caller renders choices in this order, and the preview page
// depends on it matching what the teacher saw while authoring.
async function findChoiceRows(
  db: D1Database,
  questionId: string,
): Promise<ChoiceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${CHOICE_COLUMNS}
       FROM mcq_choices
       WHERE question_id = ?1
       ORDER BY position, id`,
    )
    .bind(questionId)
    .all<ChoiceRow>();

  return results;
}

function choiceInserts(
  db: D1Database,
  questionId: string,
  choices: AuthoringChoice[],
): D1PreparedStatement[] {
  return choices.map((choice, index) =>
    db
      .prepare(
        `INSERT INTO mcq_choices (question_id, choice_text, is_correct, position)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(questionId, choice.text, choice.isCorrect ? 1 : 0, index),
  );
}

/**
 * The id is generated here rather than by SQLite so that the choice rows can reference it
 * inside the same batch. That is the whole point: one atomic write, so a question can never
 * be stored without its choices. The column keeps its SQL DEFAULT for any other writer.
 */
export async function createQuestion(
  input: QuestionInput,
): Promise<PublicQuestionWithChoices> {
  const db = await getDb();
  const id = crypto.randomUUID();

  await db.batch([
    db
      .prepare(
        `INSERT INTO mcq_questions (id, name, question_text, created_by)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(id, input.name, input.questionText, NO_AUTHENTICATED_USER),
    ...choiceInserts(db, id, input.choices),
  ]);

  const created = await findQuestionById(id);
  if (!created) {
    throw new Error(`createQuestion wrote ${id} but could not read it back`);
  }
  return created;
}

/**
 * Replaces the choice set wholesale rather than reconciling it, which keeps positions
 * contiguous without a diffing pass. Choice ids therefore change on every edit; nothing
 * holds one across an edit, and attempts against the old rows cascade away with them.
 */
export async function updateQuestion(
  id: string,
  input: QuestionInput,
): Promise<PublicQuestionWithChoices | undefined> {
  const db = await getDb();

  const { results } = await db
    .prepare("SELECT id FROM mcq_questions WHERE id = ?1")
    .bind(id)
    .all<{ id: string }>();

  if (!results[0]) {
    return undefined;
  }

  await db.batch([
    db
      .prepare(
        `UPDATE mcq_questions
         SET name = ?1, question_text = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?3`,
      )
      .bind(input.name, input.questionText, id),
    db.prepare("DELETE FROM mcq_choices WHERE question_id = ?1").bind(id),
    ...choiceInserts(db, id, input.choices),
  ]);

  return findQuestionById(id);
}

export async function listQuestions(): Promise<PublicQuestion[]> {
  const db = await getDb();

  const { results } = await db
    .prepare(
      `SELECT ${QUESTION_COLUMNS}
       FROM mcq_questions
       ORDER BY created_at DESC, id DESC`,
    )
    .all<QuestionRow>();

  return results.map(toPublicQuestion);
}

export async function findQuestionById(
  id: string,
): Promise<PublicQuestionWithChoices | undefined> {
  const db = await getDb();

  const question = await findQuestionRow(db, id);
  if (!question) {
    return undefined;
  }

  const choices = await findChoiceRows(db, id);

  return {
    ...toPublicQuestion(question),
    choices: choices.map(toPublicChoice),
  };
}

/**
 * Server-side only, and deliberately not exposed as a route: the returned choices carry
 * isCorrect, which is the answer key.
 */
export async function findQuestionForEditing(
  id: string,
): Promise<AuthoringQuestion | undefined> {
  const db = await getDb();

  const question = await findQuestionRow(db, id);
  if (!question) {
    return undefined;
  }

  const choices = await findChoiceRows(db, id);

  return {
    ...toPublicQuestion(question),
    choices: choices.map(toAuthoringChoice),
  };
}

export async function deleteQuestion(id: string): Promise<boolean> {
  const db = await getDb();

  const { results } = await db
    .prepare("DELETE FROM mcq_questions WHERE id = ?1 RETURNING id")
    .bind(id)
    .all<{ id: string }>();

  return results.length > 0;
}

/**
 * The trust boundary. The caller says which choice was selected and nothing more: the
 * verdict is read from mcq_choices, never accepted from the request. Matching on
 * question_id as well as id is what stops a choice from another question being scored
 * against this one.
 */
export async function recordAttempt(
  questionId: string,
  selectedChoiceId: string,
): Promise<AttemptResult | undefined> {
  const db = await getDb();

  const { results } = await db
    .prepare(
      "SELECT id, is_correct FROM mcq_choices WHERE id = ?1 AND question_id = ?2",
    )
    .bind(selectedChoiceId, questionId)
    .all<Pick<ChoiceRow, "id" | "is_correct">>();

  const choice = results[0];
  if (!choice) {
    return undefined;
  }

  const isCorrect = choice.is_correct === 1;

  await db
    .prepare(
      `INSERT INTO mcq_attempts (question_id, user_id, selected_choice_id, is_correct)
       VALUES (?1, ?2, ?3, ?4)
       RETURNING id`,
    )
    .bind(questionId, NO_AUTHENTICATED_USER, selectedChoiceId, isCorrect ? 1 : 0)
    .all<{ id: string }>();

  return { isCorrect, selectedChoiceId };
}
