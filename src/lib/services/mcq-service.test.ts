import { beforeEach, describe, expect, it, vi } from "vitest";

const { context } = vi.hoisted(() => ({
  context: { db: undefined as unknown },
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { DB: context.db } })),
}));

import {
  createQuestion,
  deleteQuestion,
  findQuestionById,
  findQuestionForEditing,
  listQuestions,
  recordAttempt,
  updateQuestion,
  type ChoiceRow,
  type QuestionInput,
  type QuestionRow,
} from "@/lib/services/mcq-service";

type Query = { sql: string; params: unknown[] };

// Mirrors the Sprint 1 fake in user-service.test.ts: a statement offering only bind()
// and all(), with first() deliberately absent so a service that reached for it would
// fail with a TypeError rather than pass quietly.
//
// New here is batch(). It records each group as a unit, which is what lets a test assert
// that a question and its choices went to D1 in *one* call rather than several.
function createFakeDb() {
  const queries: Query[] = [];
  const batches: Query[][] = [];
  const queue: Array<{ results: unknown[] } | Error> = [];
  const statementQueries = new WeakMap<object, Query>();
  let batchFailure: Error | undefined;

  function nextResult() {
    const next = queue.shift();
    if (next === undefined) {
      return { results: [] };
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }

  const db = {
    prepare(sql: string) {
      const query: Query = { sql, params: [] };
      queries.push(query);

      const statement = {
        bind(...params: unknown[]) {
          query.params = params;
          return statement;
        },
        async all() {
          return nextResult();
        },
      };

      statementQueries.set(statement, query);
      return statement;
    },

    async batch(statements: object[]) {
      const group = statements.map((statement) => {
        const query = statementQueries.get(statement);
        if (!query) {
          throw new Error("batch() was handed something that was not a prepared statement");
        }
        return query;
      });
      batches.push(group);

      if (batchFailure) {
        const failure = batchFailure;
        batchFailure = undefined;
        throw failure;
      }

      return group.map(() => ({ results: [] }));
    },
  };

  return {
    db,
    queries,
    batches,
    willReturn(rows: unknown[]) {
      queue.push({ results: rows });
    },
    willThrow(error: Error) {
      queue.push(error);
    },
    willFailBatch(error: Error) {
      batchFailure = error;
    },
    lastQuery(): Query {
      const query = queries[queries.length - 1];
      if (!query) {
        throw new Error("No statement was prepared");
      }
      return query;
    },
    onlyBatch(): Query[] {
      if (batches.length !== 1) {
        throw new Error(`Expected exactly one batch, saw ${batches.length}`);
      }
      return batches[0];
    },
  };
}

let fake: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  context.db = fake.db;
});

function expectNoAnonymousPlaceholders(sql: string) {
  expect(sql).not.toMatch(/\?(?!\d)/);
}

const questionRow: QuestionRow = {
  id: "0f8fad5bd9cb469fa16570867728950e",
  name: "Capitals of Europe",
  question_text: "What is the capital of France?",
  created_by: null,
  created_at: "2026-08-29 18:00:00",
  updated_at: "2026-08-29 18:00:00",
};

const choiceRows: ChoiceRow[] = [
  {
    id: "choice-paris",
    question_id: questionRow.id,
    choice_text: "Paris",
    is_correct: 1,
    position: 0,
  },
  {
    id: "choice-lyon",
    question_id: questionRow.id,
    choice_text: "Lyon",
    is_correct: 0,
    position: 1,
  },
];

const input: QuestionInput = {
  name: "Capitals of Europe",
  questionText: "What is the capital of France?",
  choices: [
    { text: "Paris", isCorrect: true },
    { text: "Lyon", isCorrect: false },
  ],
};

describe("createQuestion", () => {
  it("writes the question and every choice in a single batch", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await createQuestion(input);

    const batch = fake.onlyBatch();
    expect(batch).toHaveLength(3);
    expect(batch[0].sql).toContain("INSERT INTO mcq_questions");
    expect(batch[1].sql).toContain("INSERT INTO mcq_choices");
    expect(batch[2].sql).toContain("INSERT INTO mcq_choices");
  });

  it("issues no insert outside the batch, so a question cannot land without its choices", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await createQuestion(input);

    const batched = new Set(fake.onlyBatch());
    const strayInserts = fake.queries.filter(
      (query) => query.sql.includes("INSERT") && !batched.has(query),
    );
    expect(strayInserts).toEqual([]);
  });

  it("generates the question id in the service so the choices can reference it", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await createQuestion(input);

    const [questionInsert, firstChoice, secondChoice] = fake.onlyBatch();
    const id = questionInsert.params[0];

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(firstChoice.params[0]).toBe(id);
    expect(secondChoice.params[0]).toBe(id);
  });

  it("stores created_by as null, because there is no session to attribute it to", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await createQuestion(input);

    const questionInsert = fake.onlyBatch()[0];
    expect(questionInsert.sql).toContain("created_by");
    expect(questionInsert.params[3]).toBeNull();
  });

  it("converts isCorrect to 1 and 0, and numbers positions from zero", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await createQuestion(input);

    const [, paris, lyon] = fake.onlyBatch();
    expect(paris.params).toEqual([expect.any(String), "Paris", 1, 0]);
    expect(lyon.params).toEqual([expect.any(String), "Lyon", 0, 1]);
  });

  it("lets SQLite generate the choice ids and the question timestamps", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await createQuestion(input);

    const [questionInsert, choiceInsert] = fake.onlyBatch();
    expect(questionInsert.sql).not.toContain("created_at");
    expect(questionInsert.sql).not.toContain("updated_at");
    expect(choiceInsert.sql).not.toMatch(/INSERT INTO mcq_choices \([^)]*\bid\b/);
  });

  it("scales the batch to the number of choices", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await createQuestion({
      ...input,
      choices: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: false },
        { text: "C", isCorrect: false },
        { text: "D", isCorrect: false },
        { text: "E", isCorrect: false },
        { text: "F", isCorrect: false },
      ],
    });

    expect(fake.onlyBatch()).toHaveLength(7);
  });

  it("propagates a failed batch rather than reporting a question that was never written", async () => {
    fake.willFailBatch(new Error("D1_ERROR: CHECK constraint failed"));

    await expect(createQuestion(input)).rejects.toThrow("CHECK constraint failed");
  });

  it("returns the stored question with its choices", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    const created = await createQuestion(input);

    expect(created).toEqual({
      id: questionRow.id,
      name: "Capitals of Europe",
      questionText: "What is the capital of France?",
      createdBy: null,
      createdAt: "2026-08-29 18:00:00",
      updatedAt: "2026-08-29 18:00:00",
      choices: [
        { id: "choice-paris", text: "Paris", position: 0 },
        { id: "choice-lyon", text: "Lyon", position: 1 },
      ],
    });
  });
});

describe("findQuestionById", () => {
  it("returns undefined for an unknown id without going looking for choices", async () => {
    fake.willReturn([]);

    const found = await findQuestionById("missing");

    expect(found).toBeUndefined();
    expect(fake.queries).toHaveLength(1);
  });

  it("orders choices by position so the list is stable across reads", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await findQuestionById(questionRow.id);

    expect(fake.lastQuery().sql).toContain("ORDER BY position");
  });

  it("returns the choices in the order the database gave them", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    const found = await findQuestionById(questionRow.id);

    expect(found?.choices.map((choice) => choice.text)).toEqual([
      "Paris",
      "Lyon",
    ]);
  });

  it("never exposes which choice is correct", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    const found = await findQuestionById(questionRow.id);

    expect(JSON.stringify(found)).not.toContain("isCorrect");
    expect(JSON.stringify(found)).not.toContain("is_correct");
    for (const choice of found?.choices ?? []) {
      expect(choice).not.toHaveProperty("isCorrect");
    }
  });

  it("binds the id rather than interpolating it", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await findQuestionById("0f8fad5bd9cb469fa16570867728950e");

    expect(fake.queries[0].sql).not.toContain("0f8fad5b");
    expect(fake.queries[0].params).toEqual(["0f8fad5bd9cb469fa16570867728950e"]);
  });
});

describe("findQuestionForEditing", () => {
  it("returns undefined for an unknown id", async () => {
    fake.willReturn([]);

    await expect(findQuestionForEditing("missing")).resolves.toBeUndefined();
  });

  it("does expose the correct flag, because the edit form needs the answer key", async () => {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    const found = await findQuestionForEditing(questionRow.id);

    expect(found?.choices).toEqual([
      { text: "Paris", isCorrect: true },
      { text: "Lyon", isCorrect: false },
    ]);
  });
});

describe("listQuestions", () => {
  it("returns every question, unfiltered by creator", async () => {
    fake.willReturn([questionRow, { ...questionRow, id: "second" }]);

    const questions = await listQuestions();

    expect(questions).toHaveLength(2);
    expect(fake.lastQuery().sql).not.toContain("WHERE");
  });

  it("orders newest first", async () => {
    fake.willReturn([questionRow]);

    await listQuestions();

    expect(fake.lastQuery().sql).toContain("ORDER BY created_at DESC");
  });

  it("does not read choices, which the list does not render", async () => {
    fake.willReturn([questionRow]);

    await listQuestions();

    expect(fake.queries).toHaveLength(1);
    expect(fake.lastQuery().sql).not.toContain("mcq_choices");
  });

  it("returns camelCase questions rather than raw rows", async () => {
    fake.willReturn([questionRow]);

    const [question] = await listQuestions();

    expect(question).toEqual({
      id: questionRow.id,
      name: "Capitals of Europe",
      questionText: "What is the capital of France?",
      createdBy: null,
      createdAt: "2026-08-29 18:00:00",
      updatedAt: "2026-08-29 18:00:00",
    });
  });
});

describe("updateQuestion", () => {
  it("returns undefined for an unknown id and writes nothing", async () => {
    fake.willReturn([]);

    const updated = await updateQuestion("missing", input);

    expect(updated).toBeUndefined();
    expect(fake.batches).toEqual([]);
  });

  it("updates the question and replaces its choices in a single batch", async () => {
    fake.willReturn([{ id: questionRow.id }]);
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await updateQuestion(questionRow.id, input);

    const batch = fake.onlyBatch();
    expect(batch[0].sql).toContain("UPDATE mcq_questions");
    expect(batch[1].sql).toContain("DELETE FROM mcq_choices");
    expect(batch[2].sql).toContain("INSERT INTO mcq_choices");
    expect(batch[3].sql).toContain("INSERT INTO mcq_choices");
    expect(batch).toHaveLength(4);
  });

  it("deletes the old choices before inserting the new ones, so they cannot accumulate", async () => {
    fake.willReturn([{ id: questionRow.id }]);
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await updateQuestion(questionRow.id, input);

    const batch = fake.onlyBatch();
    const deleteIndex = batch.findIndex((query) =>
      query.sql.includes("DELETE FROM mcq_choices"),
    );
    const firstInsertIndex = batch.findIndex((query) =>
      query.sql.includes("INSERT INTO mcq_choices"),
    );
    expect(deleteIndex).toBeLessThan(firstInsertIndex);
    expect(batch[deleteIndex].params).toEqual([questionRow.id]);
  });

  it("refreshes updated_at, which SQLite will not do on its own", async () => {
    fake.willReturn([{ id: questionRow.id }]);
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await updateQuestion(questionRow.id, input);

    expect(fake.onlyBatch()[0].sql).toContain("updated_at = CURRENT_TIMESTAMP");
  });

  it("renumbers positions from zero on the replacement choices", async () => {
    fake.willReturn([{ id: questionRow.id }]);
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await updateQuestion(questionRow.id, {
      ...input,
      choices: [
        { text: "First", isCorrect: false },
        { text: "Second", isCorrect: true },
        { text: "Third", isCorrect: false },
      ],
    });

    const inserts = fake
      .onlyBatch()
      .filter((query) => query.sql.includes("INSERT INTO mcq_choices"));
    expect(inserts.map((query) => query.params[3])).toEqual([0, 1, 2]);
    expect(inserts.map((query) => query.params[2])).toEqual([0, 1, 0]);
  });

  it("does not let a caller change created_by", async () => {
    fake.willReturn([{ id: questionRow.id }]);
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);

    await updateQuestion(questionRow.id, input);

    expect(fake.onlyBatch()[0].sql).not.toContain("created_by");
  });
});

describe("deleteQuestion", () => {
  it("reports true when a row was removed", async () => {
    fake.willReturn([{ id: questionRow.id }]);

    await expect(deleteQuestion(questionRow.id)).resolves.toBe(true);
  });

  it("reports false for an unknown id", async () => {
    fake.willReturn([]);

    await expect(deleteQuestion("missing")).resolves.toBe(false);
  });

  it("uses RETURNING to tell an absent row from a deleted one", async () => {
    fake.willReturn([{ id: questionRow.id }]);

    await deleteQuestion(questionRow.id);

    expect(fake.lastQuery().sql).toContain("RETURNING");
  });

  it("deletes only the question, leaving the cascade to the database", async () => {
    fake.willReturn([{ id: questionRow.id }]);

    await deleteQuestion(questionRow.id);

    expect(fake.queries).toHaveLength(1);
    expect(fake.lastQuery().sql).not.toContain("mcq_choices");
    expect(fake.lastQuery().sql).not.toContain("mcq_attempts");
  });
});

describe("recordAttempt", () => {
  const correctChoice = { id: "choice-paris", is_correct: 1 };
  const wrongChoice = { id: "choice-lyon", is_correct: 0 };

  it("scopes the choice lookup to the question, so another question's choice cannot be scored", async () => {
    fake.willReturn([]);

    const result = await recordAttempt(questionRow.id, "choice-from-elsewhere");

    expect(result).toBeUndefined();
    const lookup = fake.queries[0];
    expect(lookup.sql).toContain("question_id");
    expect(lookup.params).toEqual(["choice-from-elsewhere", questionRow.id]);
  });

  it("writes nothing when the choice does not belong to the question", async () => {
    fake.willReturn([]);

    await recordAttempt(questionRow.id, "choice-from-elsewhere");

    expect(fake.queries.some((query) => query.sql.includes("INSERT"))).toBe(
      false,
    );
  });

  it("reads the verdict from the stored row", async () => {
    fake.willReturn([correctChoice]);
    fake.willReturn([{ id: "attempt-1" }]);

    const result = await recordAttempt(questionRow.id, "choice-paris");

    expect(result).toEqual({ isCorrect: true, selectedChoiceId: "choice-paris" });
  });

  it("reports an incorrect answer as incorrect", async () => {
    fake.willReturn([wrongChoice]);
    fake.willReturn([{ id: "attempt-1" }]);

    const result = await recordAttempt(questionRow.id, "choice-lyon");

    expect(result).toEqual({ isCorrect: false, selectedChoiceId: "choice-lyon" });
  });

  it("persists the attempt with the verdict it computed", async () => {
    fake.willReturn([correctChoice]);
    fake.willReturn([{ id: "attempt-1" }]);

    await recordAttempt(questionRow.id, "choice-paris");

    const insert = fake.lastQuery();
    expect(insert.sql).toContain("INSERT INTO mcq_attempts");
    expect(insert.params).toEqual([questionRow.id, null, "choice-paris", 1]);
  });

  it("records the attempt anonymously, since there is no session", async () => {
    fake.willReturn([wrongChoice]);
    fake.willReturn([{ id: "attempt-1" }]);

    await recordAttempt(questionRow.id, "choice-lyon");

    expect(fake.lastQuery().params[1]).toBeNull();
  });

  it("selects only what it needs, never the whole choice row", async () => {
    fake.willReturn([correctChoice]);
    fake.willReturn([{ id: "attempt-1" }]);

    await recordAttempt(questionRow.id, "choice-paris");

    expect(fake.queries[0].sql).not.toContain("choice_text");
    expect(fake.queries[0].sql).not.toContain("SELECT *");
  });
});

describe("SQL conventions", () => {
  async function exerciseEveryOperation() {
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);
    await createQuestion(input);

    fake.willReturn([{ id: questionRow.id }]);
    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);
    await updateQuestion(questionRow.id, input);

    fake.willReturn([questionRow]);
    await listQuestions();

    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);
    await findQuestionById(questionRow.id);

    fake.willReturn([questionRow]);
    fake.willReturn(choiceRows);
    await findQuestionForEditing(questionRow.id);

    fake.willReturn([{ id: questionRow.id }]);
    await deleteQuestion(questionRow.id);

    fake.willReturn([{ id: "choice-paris", is_correct: 1 }]);
    fake.willReturn([{ id: "attempt-1" }]);
    await recordAttempt(questionRow.id, "choice-paris");
  }

  it("uses no anonymous placeholders anywhere", async () => {
    await exerciseEveryOperation();

    expect(fake.queries.length).toBeGreaterThan(0);
    for (const query of fake.queries) {
      expectNoAnonymousPlaceholders(query.sql);
    }
  });

  it("binds every value it parameterises", async () => {
    await exerciseEveryOperation();

    for (const query of fake.queries) {
      const placeholders = new Set(query.sql.match(/\?\d+/g) ?? []);
      expect(placeholders.size).toBe(query.params.length);
    }
  });

  it("touches only the three mcq tables", async () => {
    await exerciseEveryOperation();

    for (const query of fake.queries) {
      expect(query.sql).not.toMatch(/\busers\b/);
    }
  });
});
