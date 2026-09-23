const JEV_ENDPOINT =
  "https://api.typesafe.ai/v1/systemone";

function clamp(
  value,
  minimum = 0,
  maximum = 100
) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return minimum;
  }

  return Math.min(
    maximum,
    Math.max(minimum, numericValue)
  );
}

function multiply(firstValue, secondValue) {
  const firstNumber = Number(firstValue);
  const secondNumber = Number(secondValue);

  if (
    !Number.isFinite(firstNumber) ||
    !Number.isFinite(secondNumber) ||
    secondNumber === 0
  ) {
    return 0;
  }

  return firstNumber / (1 / secondNumber);
}

function toPercentage(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  if (
    numericValue >= 0 &&
    numericValue <= 1
  ) {
    return clamp(
      multiply(numericValue, 100)
    );
  }

  return clamp(numericValue);
}

function getDistribution(answer) {
  if (
    !answer ||
    typeof answer !== "object"
  ) {
    return null;
  }

  return (
    answer.probabilities ||
    answer.distribution ||
    answer.scores ||
    answer.options ||
    null
  );
}

function getMaximumProbability(answer) {
  const distribution =
    getDistribution(answer);

  if (!distribution) {
    return 0;
  }

  const values = Array.isArray(distribution)
    ? distribution
    : Object.values(distribution);

  const numericValues = values
    .map((value) => Number(value))
    .filter((value) =>
      Number.isFinite(value)
    );

  if (!numericValues.length) {
    return 0;
  }

  return toPercentage(
    Math.max(...numericValues)
  );
}

function findNumericValue(...values) {
  for (const value of values) {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

function normalizeChoice(answer) {
  const safeAnswer =
    answer &&
    typeof answer === "object"
      ? answer
      : {};

  const distribution =
    getDistribution(safeAnswer);

  let selectedChoice =
    safeAnswer.choice ??
    safeAnswer.selected ??
    safeAnswer.label ??
    safeAnswer.value ??
    safeAnswer.answer ??
    null;

  if (
    !selectedChoice &&
    distribution &&
    typeof distribution === "object"
  ) {
    const entries =
      Array.isArray(distribution)
        ? distribution.map(
            (probability, index) => [
              String(index),
              probability
            ]
          )
        : Object.entries(distribution);

    entries.sort(
      (firstEntry, secondEntry) =>
        Number(secondEntry[1]) -
        Number(firstEntry[1])
    );

    selectedChoice =
      entries[0]?.[0] || null;
  }

  const directConfidence =
    toPercentage(
      safeAnswer.confidence
    );

  const confidence =
    directConfidence ||
    getMaximumProbability(safeAnswer);

  return {
    type: "choice",
    value: String(
      selectedChoice || "Unknown"
    ),
    confidence:
      Math.round(confidence),
    distribution:
      distribution || null
  };
}

function normalizeNoul(answer) {
  const safeAnswer =
    answer &&
    typeof answer === "object"
      ? answer
      : {};

  let rawProbability =
    safeAnswer.noul ??
    safeAnswer.probability ??
    safeAnswer.true_probability ??
    safeAnswer.yes_probability ??
    safeAnswer.value ??
    safeAnswer.answer ??
    0;

  if (rawProbability === true) {
    rawProbability = 1;
  }

  if (rawProbability === false) {
    rawProbability = 0;
  }

  if (
    typeof rawProbability === "string" &&
    rawProbability
      .trim()
      .toLowerCase() === "yes"
  ) {
    rawProbability = 1;
  }

  if (
    typeof rawProbability === "string" &&
    rawProbability
      .trim()
      .toLowerCase() === "no"
  ) {
    rawProbability = 0;
  }

  const yesProbability =
    toPercentage(rawProbability);

  const isYes =
    yesProbability >= 50;

  return {
    type: "noul",
    value:
      Math.round(yesProbability),
    label:
      isYes ? "Yes" : "No",
    confidence:
      Math.round(
        isYes
          ? yesProbability
          : 100 - yesProbability
      )
  };
}

function getWeightedScoreFromDistribution(
  distribution,
  criteria
) {
  if (
    !distribution ||
    typeof distribution !== "object"
  ) {
    return null;
  }

  const entries =
    Array.isArray(distribution)
      ? distribution.map(
          (probability, index) => [
            index,
            probability
          ]
        )
      : Object.entries(distribution);

  let weightedTotal = 0;
  let probabilityTotal = 0;

  entries.forEach(
    (
      [levelKey, probability],
      fallbackIndex
    ) => {
      const numericProbability =
        Number(probability);

      if (
        !Number.isFinite(
          numericProbability
        )
      ) {
        return;
      }

      let levelIndex =
        Number(levelKey);

      if (
        !Number.isFinite(levelIndex)
      ) {
        const namedIndex =
          criteria.findIndex(
            (criterion) =>
              String(criterion)
                .trim()
                .toLowerCase() ===
              String(levelKey)
                .trim()
                .toLowerCase()
          );

        levelIndex =
          namedIndex >= 0
            ? namedIndex
            : fallbackIndex;
      }

      weightedTotal += multiply(
        levelIndex,
        numericProbability
      );

      probabilityTotal +=
        numericProbability;
    }
  );

  if (probabilityTotal <= 0) {
    return null;
  }

  return (
    weightedTotal /
    probabilityTotal
  );
}

function normalizeScore(
  answer,
  criteria
) {
  const safeAnswer =
    answer &&
    typeof answer === "object"
      ? answer
      : {};

  const levels =
    Array.isArray(criteria)
      ? criteria
      : [];

  const levelCount =
    Math.max(levels.length, 2);

  const maximumLevelIndex =
    levelCount - 1;

  const distribution =
    getDistribution(safeAnswer);

  let normalizedLevel =
    getWeightedScoreFromDistribution(
      distribution,
      levels
    );

  if (normalizedLevel === null) {
    const rawScore =
      findNumericValue(
        safeAnswer.score,
        safeAnswer.value,
        safeAnswer.answer,
        safeAnswer.mean,
        safeAnswer.expected_value
      );

    if (rawScore === null) {
      normalizedLevel = 0;
    } else if (
      rawScore >= 0 &&
      rawScore <= 1
    ) {
      normalizedLevel = multiply(
        rawScore,
        maximumLevelIndex
      );
    } else if (
      rawScore >= 0 &&
      rawScore <= maximumLevelIndex
    ) {
      normalizedLevel = rawScore;
    } else if (
      rawScore >= 0 &&
      rawScore <= levelCount
    ) {
      normalizedLevel =
        Math.max(rawScore - 1, 0);
    } else {
      normalizedLevel =
        multiply(
          clamp(rawScore) / 100,
          maximumLevelIndex
        );
    }
  }

  normalizedLevel = clamp(
    normalizedLevel,
    0,
    maximumLevelIndex
  );

  const selectedLevelIndex =
    Math.round(normalizedLevel);

  const percentage =
    maximumLevelIndex > 0
      ? clamp(
          multiply(
            normalizedLevel /
              maximumLevelIndex,
            100
          )
        )
      : 0;

  const selectedLabel =
    levels[selectedLevelIndex] ||
    levels[0] ||
    "Unknown";

  const directConfidence =
    toPercentage(
      safeAnswer.confidence
    );

  const confidence =
    directConfidence ||
    getMaximumProbability(safeAnswer);

  return {
    type: "score",
    value:
      Math.round(percentage),
    level:
      selectedLevelIndex,
    label:
      selectedLabel,
    confidence:
      Math.round(confidence),
    distribution:
      distribution || null
  };
}

function normalizeAnswer(
  question,
  answer
) {
  if (question.type === "choice") {
    return normalizeChoice(answer);
  }

  if (question.type === "noul") {
    return normalizeNoul(answer);
  }

  if (question.type === "score") {
    return normalizeScore(
      answer,
      question.criteria
    );
  }

  throw new Error(
    `Unsupported JEV question type: ${question.type}`
  );
}

function buildEmailState(email) {
  return {
    source: "gmail",
    message_id: email.id,
    thread_id: email.threadId,
    sender_name: email.sender,
    sender_email: email.email,
    subject: email.subject,
    received_at: email.receivedAt,
    unread: Boolean(email.unread),
    snippet: email.snippet || "",
    body:
      email.body ||
      email.snippet ||
      ""
  };
}

function buildQuestionMap(questions) {
  return Object.fromEntries(
    questions.map((question) => {
      const requestQuestion = {
        type: question.type,
        instructions:
          question.instructions
      };

      if (question.criteria) {
        requestQuestion.criteria =
          question.criteria;
      }

      return [
        question.id,
        requestQuestion
      ];
    })
  );
}

async function parseJevResponse(
  response
) {
  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `JEV returned HTTP ${response.status}: ${responseText}`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(
      `JEV returned invalid JSON: ${responseText.slice(
        0,
        500
      )}`
    );
  }
}

export async function analyzeEmail(
  email,
  questions
) {
  const apiKey =
    process.env.TYPESAFE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "TYPESAFE_API_KEY is missing in backend/.env"
    );
  }

  if (
    !Array.isArray(questions) ||
    questions.length === 0
  ) {
    throw new Error(
      "Create at least one Choice, Score, or Noul question."
    );
  }

  const payload = {
    model:
      process.env.JEV_MODEL ||
      "jev-latest",

    state:
      buildEmailState(email),

    questions:
      buildQuestionMap(questions)
  };

  let response;

  try {
    response = await fetch(
      JEV_ENDPOINT,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${apiKey}`,
          "Content-Type":
            "application/json",
          Accept:
            "application/json"
        },

        body:
          JSON.stringify(payload),

        signal:
          AbortSignal.timeout(
            120000
          )
      }
    );
  } catch (error) {
    if (
      error.name === "TimeoutError" ||
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "JEV request timed out after 120 seconds."
      );
    }

    throw new Error(
      `Unable to connect to JEV: ${error.message}`
    );
  }

  const responseData =
    await parseJevResponse(response);

  const rawAnswers =
    responseData.answers || {};

  const normalizedResults =
    Object.fromEntries(
      questions.map((question) => {
        const rawAnswer =
          rawAnswers[question.id];

        return [
          question.id,
          normalizeAnswer(
            question,
            rawAnswer
          )
        ];
      })
    );

  return {
    results:
      normalizedResults,

    model:
      responseData.model ||
      process.env.JEV_MODEL ||
      "jev-latest",

    usage:
      responseData.usage ||
      null,

    analyzedAt:
      new Date().toISOString()
  };
}

export async function analyzeEmails(
  emails,
  questions,
  concurrency = 3,
  onProgress = () => {}
) {
  if (!Array.isArray(emails)) {
    throw new Error(
      "The emails argument must be an array."
    );
  }

  if (!Array.isArray(questions)) {
    throw new Error(
      "The questions argument must be an array."
    );
  }

  if (emails.length === 0) {
    return [];
  }

  const output =
    new Array(emails.length);

  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const currentIndex =
        nextIndex;

      nextIndex += 1;

      if (
        currentIndex >=
        emails.length
      ) {
        break;
      }

      const email =
        emails[currentIndex];

      try {
        const analysis =
          await analyzeEmail(
            email,
            questions
          );

        output[currentIndex] = {
          ...email,
          ...analysis,
          analysisError: null
        };
      } catch (error) {
        console.error(
          `JEV failed for email "${email.subject}":`,
          error.message
        );

        output[currentIndex] = {
          ...email,
          results:
            email.results || {},
          analysisError:
            error.message,
          analyzedAt:
            new Date().toISOString()
        };
      }

      completed += 1;

      try {
        onProgress({
          completed,
          total: emails.length,
          email:
            output[currentIndex]
        });
      } catch (progressError) {
        console.error(
          "JEV progress callback failed:",
          progressError.message
        );
      }
    }
  }

  const requestedConcurrency =
    Number(concurrency);

  const validConcurrency =
    Number.isFinite(
      requestedConcurrency
    )
      ? requestedConcurrency
      : 1;

  const workerCount =
    Math.min(
      Math.max(
        validConcurrency,
        1
      ),
      emails.length
    );

  const workers =
    Array.from(
      {
        length: workerCount
      },
      () => worker()
    );

  await Promise.all(workers);

  return output;
}