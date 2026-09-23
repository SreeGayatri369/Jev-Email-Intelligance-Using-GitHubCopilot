import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import {
  disconnectGmail,
  exchangeAuthorizationCode,
  fetchInboxEmails,
  getAuthorizationUrl,
  getGmailProfile,
  hasStoredToken
} from "./gmail.js";

import {
  analyzeEmails
} from "./jev.js";

import {
  createQuestion,
  getQuestions,
  removeQuestion,
  updateQuestion
} from "./questions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIRECTORY = path.resolve(
  __dirname,
  ".."
);

const app = express();
const port = Number(process.env.PORT || 3000);

let emailCache = [];
let lastSyncAt = null;
let analysisRunning = false;

const eventClients = new Set();

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.static(ROOT_DIRECTORY, {
    extensions: ["html"]
  })
);

function sendError(response, error, status = 500) {
  console.error(error);

  response.status(status).json({
    ok: false,
    error:
      error.message ||
      "Unexpected server error."
  });
}

function broadcast(eventName, data) {
  const message =
    `event: ${eventName}\n` +
    `data: ${JSON.stringify(data)}\n\n`;

  for (const client of eventClients) {
    client.write(message);
  }
}

function mergeAnalyzedEmail(analyzedEmail) {
  const index = emailCache.findIndex(
    (email) => email.id === analyzedEmail.id
  );

  if (index >= 0) {
    emailCache[index] = analyzedEmail;
  } else {
    emailCache.push(analyzedEmail);
  }
}

app.get("/api/health", async (request, response) => {
  let gmailProfile = null;

  if (hasStoredToken()) {
    try {
      gmailProfile = await getGmailProfile();
    } catch (error) {
      console.error(
        "Gmail health check failed:",
        error.message
      );
    }
  }

  response.json({
    ok: true,
    server: "connected",
    gmailConnected: Boolean(gmailProfile),
    gmailAddress:
      gmailProfile?.emailAddress || null,
    jevConfigured: Boolean(
      process.env.TYPESAFE_API_KEY
    ),
    jevModel:
      process.env.JEV_MODEL || "jev-latest",
    analysisRunning,
    cachedEmails: emailCache.length,
    questionCount: getQuestions().length,
    lastSyncAt
  });
});

app.get("/api/events", (request, response) => {
  response.setHeader(
    "Content-Type",
    "text/event-stream"
  );

  response.setHeader(
    "Cache-Control",
    "no-cache"
  );

  response.setHeader(
    "Connection",
    "keep-alive"
  );

  response.setHeader(
    "X-Accel-Buffering",
    "no"
  );

  response.flushHeaders();

  response.write(
    `event: connected\ndata: ${JSON.stringify({
      ok: true
    })}\n\n`
  );

  eventClients.add(response);

  const heartbeat = setInterval(() => {
    response.write(
      `event: heartbeat\ndata: ${JSON.stringify({
        time: Date.now()
      })}\n\n`
    );
  }, 20000);

  request.on("close", () => {
    clearInterval(heartbeat);
    eventClients.delete(response);
  });
});

app.get("/api/auth/google", (request, response) => {
  try {
    response.redirect(getAuthorizationUrl());
  } catch (error) {
    sendError(response, error);
  }
});

app.get(
  "/api/auth/google/callback",
  async (request, response) => {
    try {
      if (request.query.error) {
        return response.redirect(
          `/?gmail=error&message=${encodeURIComponent(
            String(request.query.error)
          )}`
        );
      }

      if (!request.query.code) {
        return response.status(400).send(
          "Missing Google authorization code."
        );
      }

      await exchangeAuthorizationCode(
        String(request.query.code)
      );

      response.redirect("/?gmail=connected");
    } catch (error) {
      console.error(error);

      response.redirect(
        `/?gmail=error&message=${encodeURIComponent(
          error.message
        )}`
      );
    }
  }
);

app.post(
  "/api/auth/google/disconnect",
  (request, response) => {
    disconnectGmail();

    emailCache = [];
    lastSyncAt = null;

    response.json({
      ok: true
    });
  }
);

app.get("/api/questions", (request, response) => {
  response.json({
    ok: true,
    questions: getQuestions()
  });
});

app.post("/api/questions", (request, response) => {
  try {
    const question = createQuestion(
      request.body
    );

    const questions = getQuestions();

    broadcast("questions-updated", {
      questions
    });

    response.status(201).json({
      ok: true,
      question,
      questions
    });
  } catch (error) {
    sendError(response, error, 400);
  }
});

app.put(
  "/api/questions/:id",
  (request, response) => {
    try {
      const question = updateQuestion(
        request.params.id,
        request.body
      );

      const questions = getQuestions();

      broadcast("questions-updated", {
        questions
      });

      response.json({
        ok: true,
        question,
        questions
      });
    } catch (error) {
      sendError(response, error, 400);
    }
  }
);

app.delete(
  "/api/questions/:id",
  (request, response) => {
    try {
      const questions = removeQuestion(
        request.params.id
      );

      broadcast("questions-updated", {
        questions
      });

      response.json({
        ok: true,
        questions
      });
    } catch (error) {
      sendError(response, error, 404);
    }
  }
);

app.get("/api/emails", async (request, response) => {
  try {
    if (!hasStoredToken()) {
      return response.status(401).json({
        ok: false,
        code: "GMAIL_NOT_CONNECTED",
        error:
          "Connect Gmail before loading emails."
      });
    }

    const refresh =
      request.query.refresh === "true";

    if (refresh || emailCache.length === 0) {
      const existingAnalysis = new Map(
        emailCache.map((email) => [
          email.id,
          {
            results: email.results,
            model: email.model,
            usage: email.usage,
            analyzedAt: email.analyzedAt,
            analysisError: email.analysisError
          }
        ])
      );

      const latestEmails =
        await fetchInboxEmails({
          maxResults: Number(
            process.env.GMAIL_MAX_RESULTS || 25
          )
        });

      emailCache = latestEmails.map(
        (email) => ({
          ...email,
          ...(existingAnalysis.get(email.id) || {})
        })
      );

      lastSyncAt = new Date().toISOString();

      broadcast("emails-updated", {
        emails: emailCache,
        lastSyncAt
      });
    }

    response.json({
      ok: true,
      emails: emailCache,
      questions: getQuestions(),
      lastSyncAt
    });
  } catch (error) {
    sendError(response, error);
  }
});

app.post(
  "/api/analyze",
  async (request, response) => {
    if (analysisRunning) {
      return response.status(409).json({
        ok: false,
        error:
          "A JEV analysis job is already running."
      });
    }

    if (!hasStoredToken()) {
      return response.status(401).json({
        ok: false,
        error:
          "Connect Gmail before running analysis."
      });
    }

    if (!process.env.TYPESAFE_API_KEY) {
      return response.status(500).json({
        ok: false,
        error:
          "TYPESAFE_API_KEY is missing."
      });
    }

    const questions = getQuestions();

    if (!questions.length) {
      return response.status(400).json({
        ok: false,
        error:
          "Create at least one Choice, Score, or Noul question."
      });
    }

    analysisRunning = true;

    try {
      if (!emailCache.length) {
        emailCache = await fetchInboxEmails({
          maxResults: Number(
            process.env.GMAIL_MAX_RESULTS || 25
          )
        });
      }

      const requestedIds = Array.isArray(
        request.body?.emailIds
      )
        ? request.body.emailIds
        : [];

      const selectedEmails =
        requestedIds.length > 0
          ? emailCache.filter((email) =>
              requestedIds.includes(email.id)
            )
          : emailCache;

      broadcast("analysis-started", {
        total: selectedEmails.length,
        questions: questions.length
      });

      const analyzedEmails =
        await analyzeEmails(
          selectedEmails,
          questions,
          Number(
            process.env
              .ANALYSIS_CONCURRENCY || 3
          ),
          (progress) => {
            mergeAnalyzedEmail(progress.email);

            broadcast(
              "analysis-progress",
              progress
            );
          }
        );

      for (const email of analyzedEmails) {
        mergeAnalyzedEmail(email);
      }

      lastSyncAt = new Date().toISOString();

      broadcast("analysis-completed", {
        total: analyzedEmails.length,
        emails: emailCache,
        lastSyncAt
      });

      response.json({
        ok: true,
        processed: analyzedEmails.length,
        questions,
        emails: emailCache,
        lastSyncAt
      });
    } catch (error) {
      broadcast("analysis-error", {
        error: error.message
      });

      sendError(response, error);
    } finally {
      analysisRunning = false;
    }
  }
);

app.get("*", (request, response) => {
  response.sendFile(
    path.join(ROOT_DIRECTORY, "index.html")
  );
});

app.listen(port, "0.0.0.0", () => {
  const codespaceName =
    process.env.CODESPACE_NAME;

  const forwardingDomain =
    process.env
      .GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;

  const applicationUrl =
    codespaceName && forwardingDomain
      ? `https://${codespaceName}-${port}.${forwardingDomain}`
      : `http://localhost:${port}`;

  console.log("");
  console.log(
    "JEV Mail Intelligence is running."
  );
  console.log(`Open: ${applicationUrl}`);
  console.log(
    `Gmail connected: ${
      hasStoredToken() ? "Yes" : "No"
    }`
  );
  console.log(
    `JEV configured: ${
      process.env.TYPESAFE_API_KEY
        ? "Yes"
        : "No"
    }`
  );
  console.log(
    `JEV questions: ${getQuestions().length}`
  );
  console.log("");
});