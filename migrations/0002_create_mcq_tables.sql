-- Migration number: 0002 	 2026-08-29T17:10:52.284Z

-- created_by is a real foreign key but is written as NULL for the whole of Sprint 2:
-- there is no session layer, so the server cannot identify the caller. Nullable now,
-- fillable later, per the PRD's Known Limitations.
CREATE TABLE mcq_questions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  question_text TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SQLite has no boolean type, so is_correct is an INTEGER pinned to 0 or 1. "Exactly one
-- correct choice per question" is not expressible here without a trigger; it is enforced
-- in Zod and the service instead.
CREATE TABLE mcq_choices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id TEXT NOT NULL REFERENCES mcq_questions (id) ON DELETE CASCADE,
  choice_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  position INTEGER NOT NULL
);

-- An attempt dies with its question and with the choice it selected. Nothing in Sprint 2
-- reads this table, so there is no reader to strand.
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
