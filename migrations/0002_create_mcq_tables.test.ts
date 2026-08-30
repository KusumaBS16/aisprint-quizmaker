import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Asserts what the migration file declares, not that D1 accepted it. Applying the
// migration is the only thing that proves the latter, which Phase 1 does separately
// against the local database.
//
// Resolved from the Vitest root rather than `import.meta.url`, which is not a file:
// URL once Vite has transformed this module.
const sql = readFileSync(
  resolve(process.cwd(), "migrations/0002_create_mcq_tables.sql"),
  "utf8",
);

function createTableBody(table: string): string {
  const body = sql.match(
    new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`),
  )?.[1];
  if (!body) {
    throw new Error(`No \`CREATE TABLE ${table} (...)\` statement found`);
  }
  return body;
}

function columnLines(table: string): string[] {
  return createTableBody(table)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function columnNames(table: string): string[] {
  return columnLines(table).map((line) => line.split(/\s+/)[0]);
}

function columnDefinition(table: string, name: string): string {
  const line = columnLines(table).find((candidate) =>
    candidate.startsWith(`${name} `),
  );
  if (!line) {
    throw new Error(`No column definition found for "${table}.${name}"`);
  }
  return line;
}

describe("0002_create_mcq_tables.sql", () => {
  describe("mcq_questions", () => {
    it("declares exactly the six columns in the PRD schema", () => {
      expect(columnNames("mcq_questions")).toEqual([
        "id",
        "name",
        "question_text",
        "created_by",
        "created_at",
        "updated_at",
      ]);
    });

    it("generates the id in SQLite rather than in the application", () => {
      const id = columnDefinition("mcq_questions", "id");
      expect(id).toContain("PRIMARY KEY");
      expect(id).toContain("DEFAULT (lower(hex(randomblob(16))))");
    });

    it("requires a name and question text", () => {
      expect(columnDefinition("mcq_questions", "name")).toContain("NOT NULL");
      expect(columnDefinition("mcq_questions", "question_text")).toContain(
        "NOT NULL",
      );
    });

    it("leaves created_by nullable, because there is no session to attribute a question to", () => {
      expect(columnDefinition("mcq_questions", "created_by")).not.toContain(
        "NOT NULL",
      );
    });

    it("points created_by at users and nulls it when that user is deleted", () => {
      expect(columnDefinition("mcq_questions", "created_by")).toContain(
        "REFERENCES users (id) ON DELETE SET NULL",
      );
    });

    it("makes both timestamps NOT NULL and defaulted", () => {
      for (const column of ["created_at", "updated_at"]) {
        expect(columnDefinition("mcq_questions", column)).toContain("NOT NULL");
        expect(columnDefinition("mcq_questions", column)).toContain(
          "DEFAULT CURRENT_TIMESTAMP",
        );
      }
    });
  });

  describe("mcq_choices", () => {
    it("declares exactly the five columns in the PRD schema", () => {
      expect(columnNames("mcq_choices")).toEqual([
        "id",
        "question_id",
        "choice_text",
        "is_correct",
        "position",
      ]);
    });

    it("generates the id in SQLite rather than in the application", () => {
      const id = columnDefinition("mcq_choices", "id");
      expect(id).toContain("PRIMARY KEY");
      expect(id).toContain("DEFAULT (lower(hex(randomblob(16))))");
    });

    it("deletes a question's choices along with the question", () => {
      const questionId = columnDefinition("mcq_choices", "question_id");
      expect(questionId).toContain("NOT NULL");
      expect(questionId).toContain(
        "REFERENCES mcq_questions (id) ON DELETE CASCADE",
      );
    });

    it("requires every remaining column", () => {
      for (const column of ["choice_text", "is_correct", "position"]) {
        expect(columnDefinition("mcq_choices", column)).toContain("NOT NULL");
      }
    });

    it("constrains is_correct to 0 or 1, since SQLite has no boolean type", () => {
      expect(columnDefinition("mcq_choices", "is_correct")).toContain(
        "CHECK (is_correct IN (0, 1))",
      );
    });

    it("defaults is_correct to 0, so a choice is wrong unless it says otherwise", () => {
      expect(columnDefinition("mcq_choices", "is_correct")).toContain(
        "DEFAULT 0",
      );
    });

    it("stores no timestamps, because choices are rewritten wholesale on update", () => {
      expect(columnNames("mcq_choices")).not.toContain("created_at");
      expect(columnNames("mcq_choices")).not.toContain("updated_at");
    });
  });

  describe("mcq_attempts", () => {
    it("declares exactly the six columns in the PRD schema", () => {
      expect(columnNames("mcq_attempts")).toEqual([
        "id",
        "question_id",
        "user_id",
        "selected_choice_id",
        "is_correct",
        "created_at",
      ]);
    });

    it("generates the id in SQLite rather than in the application", () => {
      const id = columnDefinition("mcq_attempts", "id");
      expect(id).toContain("PRIMARY KEY");
      expect(id).toContain("DEFAULT (lower(hex(randomblob(16))))");
    });

    it("deletes a question's attempts along with the question", () => {
      const questionId = columnDefinition("mcq_attempts", "question_id");
      expect(questionId).toContain("NOT NULL");
      expect(questionId).toContain(
        "REFERENCES mcq_questions (id) ON DELETE CASCADE",
      );
    });

    it("deletes an attempt along with the choice it selected", () => {
      const selected = columnDefinition("mcq_attempts", "selected_choice_id");
      expect(selected).toContain("NOT NULL");
      expect(selected).toContain(
        "REFERENCES mcq_choices (id) ON DELETE CASCADE",
      );
    });

    it("leaves user_id nullable, because attempts are anonymous without sessions", () => {
      expect(columnDefinition("mcq_attempts", "user_id")).not.toContain(
        "NOT NULL",
      );
    });

    it("points user_id at users and nulls it when that user is deleted", () => {
      expect(columnDefinition("mcq_attempts", "user_id")).toContain(
        "REFERENCES users (id) ON DELETE SET NULL",
      );
    });

    it("constrains is_correct to 0 or 1 and gives it no default", () => {
      const isCorrect = columnDefinition("mcq_attempts", "is_correct");
      expect(isCorrect).toContain("NOT NULL");
      expect(isCorrect).toContain("CHECK (is_correct IN (0, 1))");
      // Unlike a choice, an attempt has no sensible default verdict: the server
      // always computes one, so a missing value must fail rather than read false.
      expect(isCorrect).not.toContain("DEFAULT");
    });

    it("timestamps every attempt", () => {
      const createdAt = columnDefinition("mcq_attempts", "created_at");
      expect(createdAt).toContain("NOT NULL");
      expect(createdAt).toContain("DEFAULT CURRENT_TIMESTAMP");
    });
  });

  describe("indexes", () => {
    it("creates all four named indexes from the PRD", () => {
      expect(sql).toContain(
        "CREATE INDEX idx_mcq_questions_created_by ON mcq_questions (created_by)",
      );
      expect(sql).toContain(
        "CREATE INDEX idx_mcq_choices_question_id ON mcq_choices (question_id)",
      );
      expect(sql).toContain(
        "CREATE INDEX idx_mcq_attempts_question_id ON mcq_attempts (question_id)",
      );
      expect(sql).toContain(
        "CREATE INDEX idx_mcq_attempts_user_id ON mcq_attempts (user_id)",
      );
    });

    it("declares no unique index, since nothing here is constrained to be unique", () => {
      expect(sql).not.toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    });
  });

  describe("blast radius", () => {
    it("creates exactly the three mcq tables and nothing else", () => {
      const created = [...sql.matchAll(/CREATE TABLE (\w+)/g)].map(
        (match) => match[1],
      );
      expect(created).toEqual(["mcq_questions", "mcq_choices", "mcq_attempts"]);
    });

    it("does not alter or drop anything Sprint 1 created", () => {
      expect(sql).not.toMatch(/ALTER TABLE/i);
      expect(sql).not.toMatch(/DROP TABLE/i);
    });
  });
});
