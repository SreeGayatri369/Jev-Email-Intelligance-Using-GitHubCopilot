import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUESTIONS_FILE = path.join(
  __dirname,
  "questions.json"
);

function readQuestions() {
  if (!fs.existsSync(QUESTIONS_FILE)) {
    fs.writeFileSync(
      QUESTIONS_FILE,
      JSON.stringify([], null, 2)
    );
  }

  try {
    const content = fs.readFileSync(
      QUESTIONS_FILE,
      "utf8"
    );

    return JSON.parse(content);
  } catch {
    return [];
  }
}

function writeQuestions(questions) {
  fs.writeFileSync(
    QUESTIONS_FILE,
    JSON.stringify(questions, null, 2)
  );
}

function normalizeName(value) {
  return String(value || "").trim();
}

function normalizeCriteria(type, criteria) {
  if (type === "choice") {
    if (
      !criteria ||
      Array.isArray(criteria) ||
      typeof criteria !== "object"
    ) {
      throw new Error(
        "Choice requires at least two options."
      );
    }

    const normalized = Object.fromEntries(
      Object.entries(criteria)
        .map(([option, description]) => [
          normalizeName(option),
          normalizeName(description) || null
        ])
        .filter(([option]) => option)
    );

    if (Object.keys(normalized).length < 2) {
      throw new Error(
        "Choice requires at least two options."
      );
    }

    return normalized;
  }

  if (type === "score") {
    if (!Array.isArray(criteria)) {
      throw new Error(
        "Score requires an ordered list of levels."
      );
    }

    const normalized = criteria
      .map(normalizeName)
      .filter(Boolean);

    if (normalized.length < 2) {
      throw new Error(
        "Score requires at least two levels."
      );
    }

    return normalized;
  }

  if (type === "noul") {
    return {
      true:
        normalizeName(criteria?.true) ||
        "The answer is yes.",
      false:
        normalizeName(criteria?.false) ||
        "The answer is no."
    };
  }

  throw new Error(
    "Question type must be choice, score, or noul."
  );
}

function validateQuestion(input, existingId = null) {
  const type = normalizeName(
    input.type
  ).toLowerCase();

  if (!["choice", "score", "noul"].includes(type)) {
    throw new Error(
      "Invalid JEV question type."
    );
  }

  const name = normalizeName(input.name);
  const instructions = normalizeName(
    input.instructions
  );

  if (!name) {
    throw new Error("Column name is required.");
  }

  if (!instructions) {
    throw new Error(
      "Question for JEV is required."
    );
  }

  return {
    id:
      existingId ||
      `${type}_${crypto.randomUUID()}`,
    type,
    name,
    instructions,
    criteria: normalizeCriteria(
      type,
      input.criteria
    ),
    createdAt:
      input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function getQuestions() {
  return readQuestions();
}

export function createQuestion(input) {
  const questions = readQuestions();
  const question = validateQuestion(input);

  questions.push(question);
  writeQuestions(questions);

  return question;
}

export function updateQuestion(id, input) {
  const questions = readQuestions();

  const index = questions.findIndex(
    (question) => question.id === id
  );

  if (index < 0) {
    throw new Error("Question not found.");
  }

  const question = validateQuestion(
    {
      ...questions[index],
      ...input,
      createdAt: questions[index].createdAt
    },
    id
  );

  questions[index] = question;
  writeQuestions(questions);

  return question;
}

export function removeQuestion(id) {
  const questions = readQuestions();

  const filtered = questions.filter(
    (question) => question.id !== id
  );

  if (filtered.length === questions.length) {
    throw new Error("Question not found.");
  }

  writeQuestions(filtered);

  return filtered;
}