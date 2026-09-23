let emails = [];
let questions = [];

let activeFilter = "all";
let sortDescending = true;
let analysisRunning = false;
let pollingTimer = null;

const list =
  document.querySelector("#email-list");

const empty =
  document.querySelector("#empty-state");

const search =
  document.querySelector("#search-input");

const connectButton =
  document.querySelector("#connect-button");

const runButton =
  document.querySelector("#run-button");

const questionOverlay =
  document.querySelector("#question-overlay");

const questionList =
  document.querySelector("#question-list");

const questionEmptyMessage =
  document.querySelector(
    "#question-empty-message"
  );

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

async function apiRequest(
  url,
  options = {}
) {
  const response = await fetch(url, {
    ...options,

    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response
    .json()
    .catch(() => ({
      error:
        `Server returned ${response.status}`
    }));

  if (!response.ok) {
    const error = new Error(
      data.error || "Request failed."
    );

    error.status = response.status;
    error.code = data.code;

    throw error;
  }

  return data;
}

function showToast(message) {
  const toast =
    document.querySelector("#toast");

  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timeout);

  showToast.timeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

function filteredEmails() {
  const query =
    search?.value
      .trim()
      .toLowerCase() || "";

  return emails
    .filter((email) => {
      const priority =
        getEmailPriority(email);

      const isLead =
        Object.values(
          email.results || {}
        ).some((result) => {
          return (
            result.type === "choice" &&
            /lead|sales|revenue|opportunity/i.test(
              result.value || ""
            )
          );
        });

      const matchesFilter =
        activeFilter === "all" ||
        (
          activeFilter === "priority" &&
          priority >= 80
        ) ||
        (
          activeFilter === "unread" &&
          email.unread
        ) ||
        (
          activeFilter === "lead" &&
          isLead
        );

      const searchableText = [
        email.sender,
        email.email,
        email.subject,
        email.snippet
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query ||
        searchableText.includes(query);

      return (
        matchesFilter &&
        matchesSearch
      );
    })
    .sort((first, second) => {
      const firstPriority =
        getEmailPriority(first);

      const secondPriority =
        getEmailPriority(second);

      return sortDescending
        ? secondPriority - firstPriority
        : firstPriority - secondPriority;
    });
}

function getEmailPriority(email) {
  const scoreResults =
    Object.values(
      email.results || {}
    ).filter((result) => {
      return result.type === "score";
    });

  if (!scoreResults.length) {
    return 0;
  }

  const total =
    scoreResults.reduce(
      (currentTotal, result) => {
        return (
          currentTotal +
          Number(result.value || 0)
        );
      },
      0
    );

  return Math.round(
    total / scoreResults.length
  );
}

function isLeadEmail(email) {
  return Object.values(
    email.results || {}
  ).some((result) => {
    return (
      result.type === "choice" &&
      /lead|sales|revenue|opportunity/i.test(
        result.value || ""
      )
    );
  });
}

function renderTableHeader() {
  const header =
    document.querySelector(
      "#email-table-header"
    );

  if (!header) {
    return;
  }

  header.innerHTML = `
    <th class="check-col">
      <input
        type="checkbox"
        id="select-all"
        aria-label="Select all emails"
      >
    </th>

    <th>EMAIL</th>

    ${questions
      .map((question) => {
        return `
          <th
            class="dynamic-question-column ${question.type}"
            title="${escapeHtml(
              question.instructions
            )}"
          >
            ${escapeHtml(question.name)}
            <span class="sort-mark">
              ↕
            </span>
          </th>
        `;
      })
      .join("")}

    <th>RECEIVED</th>
    <th></th>
  `;

  const selectAll =
    header.querySelector("#select-all");

  selectAll?.addEventListener(
    "change",
    (event) => {
      document
        .querySelectorAll(
          ".email-checkbox"
        )
        .forEach((checkbox) => {
          checkbox.checked =
            event.target.checked;
        });
    }
  );
}

function renderResult(
  question,
  email
) {
  if (email.analysisError) {
    return `
      <div
        class="result-error"
        title="${escapeHtml(
          email.analysisError
        )}"
      >
        Analysis failed
      </div>
    `;
  }

  const result =
    email.results?.[question.id];

  if (!result) {
    return `
      <span class="result-pending">
        Not analyzed
      </span>
    `;
  }

  if (result.type === "choice") {
    return `
      <div class="dynamic-result">
        <span class="result-choice">
          ${escapeHtml(
            result.value || "Unknown"
          )}
        </span>

        <div class="result-detail">
          Confidence
          ${Math.round(
            result.confidence || 0
          )}%
        </div>
      </div>
    `;
  }

  if (result.type === "score") {
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          result.value || 0
        )
      )
    );

    return `
      <div class="result-score">
        <div class="result-score-top">
          <span
            class="result-score-track"
          >
            <i
              style="width:${score}%"
            ></i>
          </span>

          <strong>${score}</strong>
        </div>

        <div
          class="result-score-label"
        >
          ${escapeHtml(
            result.label || ""
          )}
        </div>

        ${
          result.confidence !== undefined
            ? `
              <div class="result-detail">
                Confidence
                ${Math.round(
                  result.confidence || 0
                )}%
              </div>
            `
            : ""
        }
      </div>
    `;
  }

  const probability = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        result.value || 0
      )
    )
  );

  const isYes =
    result.label === "Yes";

  return `
    <div class="result-noul">
      <div class="result-noul-top">
        <span
          class="result-noul-badge ${
            isYes ? "yes" : "no"
          }"
        >
          ${isYes ? "Yes" : "No"}
        </span>

        <span
          class="result-noul-track"
        >
          <i
            class="${
              isYes ? "yes" : "no"
            }"
            style="width:${probability}%"
          ></i>
        </span>
      </div>

      <div class="result-detail">
        Yes probability
        ${probability}%
      </div>
    </div>
  `;
}

function renderEmails() {
  renderTableHeader();

  const visible =
    filteredEmails();

  if (list) {
    list.innerHTML = visible
      .map((email) => {
        return `
          <tr
            class="${
              email.unread
                ? "unread-row"
                : ""
            }"
            data-id="${escapeHtml(
              email.id
            )}"
          >
            <td>
              <input
                type="checkbox"
                class="email-checkbox"
                data-email-id="${escapeHtml(
                  email.id
                )}"
                aria-label="Select ${escapeHtml(
                  email.subject
                )}"
              >
            </td>

            <td>
              <div class="email-cell">
                <div
                  class="avatar-company"
                >
                  ${escapeHtml(
                    email.initials || "?"
                  )}
                </div>

                <div class="sender">
                  <strong>
                    ${escapeHtml(
                      email.sender ||
                      "Unknown sender"
                    )}
                  </strong>

                  <span
                    title="${escapeHtml(
                      email.subject ||
                      "(No subject)"
                    )}"
                  >
                    ${escapeHtml(
                      email.subject ||
                      "(No subject)"
                    )}
                  </span>
                </div>
              </div>
            </td>

            ${questions
              .map((question) => {
                return `
                  <td
                    class="dynamic-answer"
                  >
                    ${renderResult(
                      question,
                      email
                    )}
                  </td>
                `;
              })
              .join("")}

            <td class="received">
              ${escapeHtml(
                email.received || ""
              )}
            </td>

            <td>
              <button
                type="button"
                class="row-more"
                aria-label="More actions"
                title="${
                  email.analysisError
                    ? escapeHtml(
                        email.analysisError
                      )
                    : "Email actions"
                }"
              >
                •••
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  if (empty) {
    empty.style.display =
      visible.length
        ? "none"
        : "block";
  }

  const showingCount =
    document.querySelector(
      "#showing-count"
    );

  if (showingCount) {
    showingCount.textContent =
      visible.length;
  }

  updateCounts();
  updateDashboardMetrics();
}

function updateCounts() {
  const unreadCount =
    emails.filter((email) => {
      return email.unread;
    }).length;

  const priorityCount =
    emails.filter((email) => {
      return (
        getEmailPriority(email) >= 80
      );
    }).length;

  const leadCount =
    emails.filter(isLeadEmail).length;

  const counts = {
    all: emails.length,
    priority: priorityCount,
    unread: unreadCount,
    lead: leadCount
  };

  document
    .querySelectorAll(".filter-tab")
    .forEach((button) => {
      const count =
        button.querySelector("span");

      if (count) {
        count.textContent =
          counts[
            button.dataset.filter
          ] || 0;
      }
    });

  const unreadBadge =
    document.querySelector(
      ".unread-count"
    );

  if (unreadBadge) {
    unreadBadge.textContent =
      `${unreadCount} unread`;
  }

  const sidebarInbox =
    document.querySelector(
      "#sidebar-inbox-count"
    );

  const sidebarPriority =
    document.querySelector(
      "#sidebar-priority-count"
    );

  const sidebarLead =
    document.querySelector(
      "#sidebar-lead-count"
    );

  const sidebarQuestions =
    document.querySelector(
      "#sidebar-question-count"
    );

  if (sidebarInbox) {
    sidebarInbox.textContent =
      emails.length;
  }

  if (sidebarPriority) {
    sidebarPriority.textContent =
      priorityCount;
  }

  if (sidebarLead) {
    sidebarLead.textContent =
      leadCount;
  }

  if (sidebarQuestions) {
    sidebarQuestions.textContent =
      questions.length;
  }
}

function updateDashboardMetrics() {
  const totalEmails =
    emails.length;

  const analyzedEmails =
    emails.filter((email) => {
      return (
        email.results &&
        Object.keys(
          email.results
        ).length > 0
      );
    }).length;

  const highPriorityEmails =
    emails.filter((email) => {
      return (
        getEmailPriority(email) >= 80
      );
    }).length;

  const unreadEmails =
    emails.filter((email) => {
      return email.unread;
    }).length;

  const analysisRate =
    totalEmails > 0
      ? Math.round(
          (
            analyzedEmails /
            totalEmails
          ) * 100
        )
      : 0;

  setElementText(
    "#metric-total-emails",
    totalEmails
  );

  setElementText(
    "#metric-question-count",
    questions.length
  );

  setElementText(
    "#metric-analyzed-emails",
    analyzedEmails
  );

  setElementText(
    "#metric-priority-emails",
    highPriorityEmails
  );

  setElementText(
    "#metric-analysis-rate",
    `${analysisRate}%`
  );

  setElementText(
    "#metric-unread-count",
    `${unreadEmails} unread`
  );

  setElementText(
    "#signal-question-count",
    `${questions.length} question${questions.length === 1 ? "" : "s"}`
  );

  setElementText(
    "#signal-review-count",
    `${highPriorityEmails} to review`
  );

  updateQuestionTypeSummary();
}

function setElementText(
  selector,
  value
) {
  const element =
    document.querySelector(selector);

  if (element) {
    element.textContent = value;
  }
}

function updateQuestionTypeSummary() {
  const summaryElement =
    document.querySelector(
      "#metric-question-types"
    );

  if (!summaryElement) {
    return;
  }

  if (!questions.length) {
    summaryElement.textContent =
      "None";

    return;
  }

  const availableTypes =
    Array.from(
      new Set(
        questions.map((question) => {
          return question.type
            .toUpperCase();
        })
      )
    );

  summaryElement.textContent =
    availableTypes.join(" · ");
}

async function loadQuestions() {
  const response =
    await apiRequest(
      "/api/questions"
    );

  questions =
    response.questions || [];

  renderQuestionForms();
  renderEmails();
  updateDashboardMetrics();
}

async function loadEmails({
  refresh = false,
  quiet = false
} = {}) {
  try {
    const response =
      await apiRequest(
        `/api/emails?refresh=${refresh}`
      );

    emails =
      response.emails || [];

    if (response.questions) {
      questions =
        response.questions;
    }

    renderEmails();
    updateLastSyncTime(
      response.lastSyncAt
    );

    if (!quiet) {
      showToast(
        `${emails.length} real Gmail emails loaded`
      );
    }
  } catch (error) {
    if (error.status === 401) {
      emails = [];
      renderEmails();

      if (!quiet) {
        showToast(
          "Connect Gmail to load emails"
        );
      }

      return;
    }

    showToast(
      `Gmail error: ${error.message}`
    );
  }
}

async function checkConnection() {
  try {
    const status =
      await apiRequest(
        "/api/health"
      );

    if (status.gmailConnected) {
      if (connectButton) {
        connectButton.innerHTML = `
          <span>✓</span>
          ${escapeHtml(
            status.gmailAddress ||
            "Gmail connected"
          )}
        `;

        connectButton.classList.add(
          "connected"
        );
      }
    } else if (connectButton) {
      connectButton.innerHTML = `
        <span>↗</span>
        Connect Gmail
      `;

      connectButton.classList.remove(
        "connected"
      );
    }

    updateConnectionInterface(
      status
    );

    return status;
  } catch (error) {
    showToast(
      `Backend unavailable: ${error.message}`
    );

    return null;
  }
}

function updateConnectionInterface(
  status
) {
  setElementText(
    "#engine-model",
    status.jevModel || "jev-latest"
  );

  if (status.gmailConnected) {
    setElementText(
      "#sync-status-text",
      "Gmail connected"
    );

    setElementText(
      "#sync-description",
      "Watching the inbox for new messages."
    );

    setElementText(
      "#live-status-label",
      "LIVE"
    );

    setElementText(
      "#page-sync-status",
      "CONNECTED"
    );

    setElementText(
      "#metric-sync-state",
      "Live"
    );
  } else {
    setElementText(
      "#sync-status-text",
      "Gmail disconnected"
    );

    setElementText(
      "#sync-description",
      "Connect Gmail to load real inbox messages."
    );

    setElementText(
      "#live-status-label",
      "OFFLINE"
    );

    setElementText(
      "#page-sync-status",
      "NOT CONNECTED"
    );

    setElementText(
      "#metric-sync-state",
      "Waiting"
    );
  }

  const engineLight =
    document.querySelector(
      "#jev-engine-light"
    );

  if (engineLight) {
    engineLight.style.background =
      status.jevConfigured
        ? "var(--green)"
        : "var(--coral)";
  }
}

function updateLastSyncTime(
  syncValue = null
) {
  const lastSyncElement =
    document.querySelector(
      "#last-sync-time"
    );

  if (!lastSyncElement) {
    return;
  }

  const syncDate =
    syncValue
      ? new Date(syncValue)
      : new Date();

  if (
    Number.isNaN(
      syncDate.getTime()
    )
  ) {
    lastSyncElement.textContent =
      "Just now";

    return;
  }

  lastSyncElement.textContent =
    syncDate.toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );
}

function openQuestionDrawer() {
  if (!questionOverlay) {
    return;
  }

  questionOverlay.classList.add(
    "open"
  );

  questionOverlay.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.style.overflow =
    "hidden";
}

function closeQuestionDrawer() {
  if (!questionOverlay) {
    return;
  }

  questionOverlay.classList.remove(
    "open"
  );

  questionOverlay.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.style.overflow =
    "";
}

function defaultQuestion(type) {
  if (type === "choice") {
    return {
      id: "",
      type: "choice",
      name: "Email category",
      instructions:
        "What is the primary category of this email?",

      criteria: {
        Sales:
          "Sales, pricing, proposal, lead, contract, or renewal.",

        Support:
          "Product, account, or technical assistance.",

        Internal:
          "Internal company communication.",

        Newsletter:
          "Marketing, newsletter, or automated content.",

        Other:
          "Does not match another option."
      }
    };
  }

  if (type === "score") {
    return {
      id: "",
      type: "score",
      name: "Business priority",

      instructions:
        "How important is this email based on urgency, business value, risk, and actionability?",

      criteria: [
        "Ignore",
        "Low",
        "Normal",
        "High",
        "Critical"
      ]
    };
  }

  return {
    id: "",
    type: "noul",
    name: "Needs reply",

    instructions:
      "Does this email require a reply or action?",

    criteria: {
      true:
        "A response, approval, review, investigation, or action is required.",

      false:
        "The email is informational, automated, or requires no response."
    }
  };
}

function criteriaToText(question) {
  if (question.type === "choice") {
    return Object.entries(
      question.criteria || {}
    )
      .map(
        ([
          option,
          description
        ]) => {
          return (
            `${option} | ` +
            `${description || ""}`
          );
        }
      )
      .join("\n");
  }

  if (question.type === "score") {
    return Array.isArray(
      question.criteria
    )
      ? question.criteria.join("\n")
      : "";
  }

  return "";
}

function renderQuestionCard(
  question,
  temporary = false
) {
  const safeCriteria =
    question.criteria || {};

  let typeHelp = "";

  if (question.type === "choice") {
    typeHelp = `
      <label>
        Choices
      </label>

      <textarea
        class="question-criteria"
        placeholder="Sales | Sales opportunity
Support | Customer support request"
      >${escapeHtml(
        criteriaToText(question)
      )}</textarea>

      <p class="question-form-note">
        Enter one choice per line.
        Use: Choice name | Description
      </p>
    `;
  } else if (
    question.type === "score"
  ) {
    typeHelp = `
      <label>
        Ordered score levels
      </label>

      <textarea
        class="question-criteria"
        placeholder="Ignore
Low
Normal
High
Critical"
      >${escapeHtml(
        criteriaToText(question)
      )}</textarea>

      <p class="question-form-note">
        Enter one level per line,
        from lowest to highest.
      </p>
    `;
  } else {
    typeHelp = `
      <label>
        Yes means
      </label>

      <textarea
        class="question-yes"
      >${escapeHtml(
        safeCriteria.true || ""
      )}</textarea>

      <label>
        No means
      </label>

      <textarea
        class="question-no"
      >${escapeHtml(
        safeCriteria.false || ""
      )}</textarea>
    `;
  }

  return `
    <article
      class="question-form-card ${
        question.type
      }"
      data-question-id="${escapeHtml(
        question.id
      )}"
      data-question-type="${escapeHtml(
        question.type
      )}"
      data-temporary="${temporary}"
    >
      <div class="question-card-title">
        <span
          class="type-badge ${
            question.type
          }"
        >
          ${question.type.toUpperCase()}
        </span>

        <strong>
          ${
            temporary
              ? "New JEV question"
              : escapeHtml(
                  question.name
                )
          }
        </strong>
      </div>

      <label>
        Table column name
      </label>

      <input
        class="question-name"
        value="${escapeHtml(
          question.name
        )}"
        placeholder="For example: Email category"
      >

      <label>
        Question for JEV
      </label>

      <textarea
        class="question-instructions"
        placeholder="What should JEV determine?"
      >${escapeHtml(
        question.instructions
      )}</textarea>

      ${typeHelp}

      <div class="question-card-actions">
        ${
          temporary
            ? `
              <button
                type="button"
                class="question-delete-button cancel-question"
              >
                Cancel
              </button>
            `
            : `
              <button
                type="button"
                class="question-delete-button delete-question"
              >
                Delete
              </button>
            `
        }

        <button
          type="button"
          class="question-save-button save-question"
        >
          Save question
        </button>
      </div>
    </article>
  `;
}

function renderQuestionForms() {
  if (!questionList) {
    return;
  }

  if (questionEmptyMessage) {
    questionEmptyMessage.style.display =
      questions.length
        ? "none"
        : "block";
  }

  questionList.innerHTML =
    questions
      .map((question) => {
        return renderQuestionCard(
          question
        );
      })
      .join("");

  attachQuestionFormEvents();
}

function attachQuestionFormEvents() {
  if (!questionList) {
    return;
  }

  questionList
    .querySelectorAll(
      ".save-question"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        saveQuestionFromCard
      );
    });

  questionList
    .querySelectorAll(
      ".delete-question"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        deleteQuestionFromCard
      );
    });

  questionList
    .querySelectorAll(
      ".cancel-question"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          button
            .closest(
              ".question-form-card"
            )
            ?.remove();

          const hasCards =
            questionList.querySelector(
              ".question-form-card"
            );

          if (
            !hasCards &&
            questionEmptyMessage
          ) {
            questionEmptyMessage
              .style.display = "block";
          }
        }
      );
    });
}

function parseQuestionCard(card) {
  const type =
    card.dataset.questionType;

  const name =
    card
      .querySelector(
        ".question-name"
      )
      .value
      .trim();

  const instructions =
    card
      .querySelector(
        ".question-instructions"
      )
      .value
      .trim();

  let criteria;

  if (type === "choice") {
    criteria = {};

    card
      .querySelector(
        ".question-criteria"
      )
      .value
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .filter(Boolean)
      .forEach((line) => {
        const [
          option,
          ...descriptionParts
        ] = line.split("|");

        const cleanOption =
          option.trim();

        if (cleanOption) {
          criteria[cleanOption] =
            descriptionParts
              .join("|")
              .trim() || null;
        }
      });
  } else if (
    type === "score"
  ) {
    criteria =
      card
        .querySelector(
          ".question-criteria"
        )
        .value
        .split("\n")
        .map((line) => {
          return line.trim();
        })
        .filter(Boolean);
  } else {
    criteria = {
      true:
        card
          .querySelector(
            ".question-yes"
          )
          .value
          .trim(),

      false:
        card
          .querySelector(
            ".question-no"
          )
          .value
          .trim()
    };
  }

  return {
    type,
    name,
    instructions,
    criteria
  };
}

async function saveQuestionFromCard(
  event
) {
  const button =
    event.currentTarget;

  const card =
    button.closest(
      ".question-form-card"
    );

  if (!card) {
    return;
  }

  const questionId =
    card.dataset.questionId;

  const temporary =
    card.dataset.temporary ===
    "true";

  const originalText =
    button.textContent;

  try {
    button.disabled = true;
    button.textContent =
      "Saving...";

    const payload =
      parseQuestionCard(card);

    if (temporary) {
      await apiRequest(
        "/api/questions",
        {
          method: "POST",
          body:
            JSON.stringify(payload)
        }
      );
    } else {
      await apiRequest(
        `/api/questions/${encodeURIComponent(
          questionId
        )}`,
        {
          method: "PUT",
          body:
            JSON.stringify(payload)
        }
      );
    }

    await loadQuestions();

    showToast(
      `${payload.type.toUpperCase()} question saved`
    );
  } catch (error) {
    showToast(
      `Unable to save question: ${error.message}`
    );

    button.disabled = false;
    button.textContent =
      originalText;
  }
}

async function deleteQuestionFromCard(
  event
) {
  const card =
    event.currentTarget.closest(
      ".question-form-card"
    );

  if (!card) {
    return;
  }

  const questionId =
    card.dataset.questionId;

  try {
    await apiRequest(
      `/api/questions/${encodeURIComponent(
        questionId
      )}`,
      {
        method: "DELETE"
      }
    );

    await loadQuestions();

    showToast(
      "Question deleted"
    );
  } catch (error) {
    showToast(
      `Unable to delete: ${error.message}`
    );
  }
}

function addTemporaryQuestion(type) {
  if (!questionList) {
    return;
  }

  questionList.insertAdjacentHTML(
    "afterbegin",
    renderQuestionCard(
      defaultQuestion(type),
      true
    )
  );

  if (questionEmptyMessage) {
    questionEmptyMessage.style.display =
      "none";
  }

  attachQuestionFormEvents();

  const firstTemporaryCard =
    questionList.querySelector(
      '.question-form-card[data-temporary="true"]'
    );

  firstTemporaryCard
    ?.querySelector(
      ".question-name"
    )
    ?.focus();
}

function selectedEmailIds() {
  return Array.from(
    document.querySelectorAll(
      ".email-checkbox:checked"
    )
  ).map((checkbox) => {
    return checkbox.dataset.emailId;
  });
}

async function runAnalysis() {
  if (analysisRunning) {
    return;
  }

  if (!questions.length) {
    openQuestionDrawer();

    showToast(
      "Add a Choice, Score, or Noul question first"
    );

    return;
  }

  if (!emails.length) {
    showToast(
      "No Gmail emails are loaded"
    );

    return;
  }

  analysisRunning = true;

  if (runButton) {
    runButton.disabled = true;

    runButton.innerHTML = `
      <span>✦</span>
      JEV analyzing...
    `;
  }

  updateAnalysisProgress(
    0,
    selectedEmailIds().length ||
    emails.length
  );

  try {
    const emailIds =
      selectedEmailIds();

    const response =
      await apiRequest(
        "/api/analyze",
        {
          method: "POST",

          body: JSON.stringify({
            emailIds
          })
        }
      );

    emails =
      response.emails || emails;

    renderEmails();

    showToast(
      `JEV analyzed ${response.processed} emails`
    );
  } catch (error) {
    showToast(
      `JEV analysis failed: ${error.message}`
    );
  } finally {
    analysisRunning = false;

    if (runButton) {
      runButton.disabled = false;

      runButton.innerHTML = `
        <span>✦</span>
        Run analysis
        <span class="shortcut">
          Ctrl ↵
        </span>
      `;
    }
  }
}

function updateAnalysisProgress(
  completed,
  total
) {
  const progressElement =
    document.querySelector(
      "#analysis-progress"
    );

  const statusElement =
    document.querySelector(
      "#live-analysis-text"
    );

  if (progressElement) {
    progressElement.classList.add(
      "visible"
    );

    progressElement.textContent =
      `JEV analyzed ${completed} of ${total} emails`;
  }

  if (statusElement) {
    statusElement.textContent =
      `Analyzing ${completed}/${total}`;
  }
}

function finishAnalysisProgress(
  total
) {
  const progressElement =
    document.querySelector(
      "#analysis-progress"
    );

  const statusElement =
    document.querySelector(
      "#live-analysis-text"
    );

  if (progressElement) {
    progressElement.classList.add(
      "visible"
    );

    progressElement.textContent =
      `JEV completed ${total} emails`;

    setTimeout(() => {
      progressElement.classList.remove(
        "visible"
      );
    }, 3500);
  }

  if (statusElement) {
    statusElement.textContent =
      "JEV ready";
  }
}

function animateUpdatedEmail(
  emailId
) {
  requestAnimationFrame(() => {
    const rows =
      document.querySelectorAll(
        "#email-list tr"
      );

    const updatedRow =
      Array.from(rows).find(
        (row) => {
          return (
            row.dataset.id ===
            String(emailId)
          );
        }
      );

    if (!updatedRow) {
      return;
    }

    updatedRow.classList.remove(
      "row-updated"
    );

    void updatedRow.offsetWidth;

    updatedRow.classList.add(
      "row-updated"
    );

    setTimeout(() => {
      updatedRow.classList.remove(
        "row-updated"
      );
    }, 1000);
  });
}

function connectRealTimeEvents() {
  const eventSource =
    new EventSource("/api/events");

  eventSource.addEventListener(
    "connected",
    () => {
      setElementText(
        "#live-analysis-text",
        "JEV ready"
      );
    }
  );

  eventSource.addEventListener(
    "analysis-started",
    (event) => {
      const data =
        JSON.parse(event.data);

      analysisRunning = true;

      if (runButton) {
        runButton.disabled = true;

        runButton.innerHTML = `
          <span>✦</span>
          Starting JEV...
        `;
      }

      updateAnalysisProgress(
        0,
        data.total
      );

      showToast(
        `JEV started ${data.questions} questions across ${data.total} emails`
      );
    }
  );

  eventSource.addEventListener(
    "analysis-progress",
    (event) => {
      const data =
        JSON.parse(event.data);

      const index =
        emails.findIndex(
          (email) => {
            return (
              email.id ===
              data.email.id
            );
          }
        );

      if (index >= 0) {
        emails[index] =
          data.email;
      }

      renderEmails();

      animateUpdatedEmail(
        data.email.id
      );

      updateAnalysisProgress(
        data.completed,
        data.total
      );

      if (runButton) {
        runButton.innerHTML = `
          <span>✦</span>
          ${data.completed} / ${data.total}
        `;
      }
    }
  );

  eventSource.addEventListener(
    "analysis-completed",
    (event) => {
      const data =
        JSON.parse(event.data);

      emails =
        data.emails || emails;

      renderEmails();

      updateLastSyncTime(
        data.lastSyncAt
      );

      analysisRunning = false;

      if (runButton) {
        runButton.disabled = false;

        runButton.innerHTML = `
          <span>✦</span>
          Run analysis
          <span class="shortcut">
            Ctrl ↵
          </span>
        `;
      }

      finishAnalysisProgress(
        data.total
      );

      showToast(
        `JEV completed ${data.total} emails`
      );
    }
  );

  eventSource.addEventListener(
    "analysis-error",
    (event) => {
      const data =
        JSON.parse(event.data);

      analysisRunning = false;

      if (runButton) {
        runButton.disabled = false;

        runButton.innerHTML = `
          <span>✦</span>
          Run analysis
          <span class="shortcut">
            Ctrl ↵
          </span>
        `;
      }

      const progressElement =
        document.querySelector(
          "#analysis-progress"
        );

      if (progressElement) {
        progressElement.classList.add(
          "visible"
        );

        progressElement.textContent =
          `JEV error: ${data.error}`;
      }

      showToast(
        `JEV error: ${data.error}`
      );
    }
  );

  eventSource.addEventListener(
    "questions-updated",
    (event) => {
      const data =
        JSON.parse(event.data);

      questions =
        data.questions || [];

      renderQuestionForms();
      renderEmails();
      updateDashboardMetrics();
    }
  );

  eventSource.addEventListener(
    "emails-updated",
    (event) => {
      const data =
        JSON.parse(event.data);

      emails =
        data.emails || [];

      renderEmails();

      updateLastSyncTime(
        data.lastSyncAt
      );
    }
  );

  eventSource.onerror = () => {
    console.warn(
      "Real-time connection temporarily unavailable."
    );

    setElementText(
      "#live-analysis-text",
      "Reconnecting..."
    );
  };
}

function installButtonAnimations() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const button =
        event.target.closest(
          "button"
        );

      if (
        !button ||
        button.disabled
      ) {
        return;
      }

      const rectangle =
        button.getBoundingClientRect();

      const diameter =
        Math.max(
          rectangle.width,
          rectangle.height
        );

      const ripple =
        document.createElement(
          "span"
        );

      ripple.className =
        "button-ripple";

      ripple.style.width =
        `${diameter}px`;

      ripple.style.height =
        `${diameter}px`;

      ripple.style.left =
        `${event.clientX -
          rectangle.left}px`;

      ripple.style.top =
        `${event.clientY -
          rectangle.top}px`;

      button.appendChild(ripple);

      ripple.addEventListener(
        "animationend",
        () => {
          ripple.remove();
        },
        {
          once: true
        }
      );
    }
  );
}

function installOptionalButtonHandlers() {
  const configureButton =
    document.querySelector(
      "#configure-questions-button"
    );

  const doneButton =
    document.querySelector(
      "#drawer-done-button"
    );

  const topSearchButton =
    document.querySelector(
      "#top-search-button"
    );

  const clearDraftsButton =
    document.querySelector(
      "#clear-question-drafts"
    );

  configureButton?.addEventListener(
    "click",
    openQuestionDrawer
  );

  doneButton?.addEventListener(
    "click",
    closeQuestionDrawer
  );

  topSearchButton?.addEventListener(
    "click",
    () => {
      search?.focus();
    }
  );

  clearDraftsButton?.addEventListener(
    "click",
    () => {
      document
        .querySelectorAll(
          '.question-form-card[data-temporary="true"]'
        )
        .forEach((card) => {
          card.remove();
        });

      if (questionEmptyMessage) {
        questionEmptyMessage.style.display =
          questions.length
            ? "none"
            : "block";
      }

      showToast(
        "Unsaved question drafts cleared"
      );
    }
  );
}

document
  .querySelectorAll(".filter-tab")
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        document
          .querySelectorAll(
            ".filter-tab"
          )
          .forEach((item) => {
            item.classList.remove(
              "active"
            );
          });

        button.classList.add(
          "active"
        );

        activeFilter =
          button.dataset.filter;

        renderEmails();
      }
    );
  });

search?.addEventListener(
  "input",
  renderEmails
);

document
  .querySelector("#sort-button")
  ?.addEventListener(
    "click",
    () => {
      sortDescending =
        !sortDescending;

      const sortLabel =
        document.querySelector(
          "#sort-button strong"
        );

      if (sortLabel) {
        sortLabel.textContent =
          sortDescending
            ? "Priority"
            : "Priority (low)";
      }

      renderEmails();
    }
  );

connectButton?.addEventListener(
  "click",
  () => {
    window.location.href =
      "/api/auth/google";
  }
);

runButton?.addEventListener(
  "click",
  runAnalysis
);

document
  .querySelector(
    "#close-question-drawer"
  )
  ?.addEventListener(
    "click",
    closeQuestionDrawer
  );

questionOverlay?.addEventListener(
  "click",
  (event) => {
    if (
      event.target ===
      questionOverlay
    ) {
      closeQuestionDrawer();
    }
  }
);

document
  .querySelectorAll(
    "[data-new-question]"
  )
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        addTemporaryQuestion(
          button.dataset
            .newQuestion
        );
      }
    );
  });

document
  .querySelectorAll(".nav-item")
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        const view =
          button.dataset.view;

        if (
          view === "Questions" ||
          view === "Settings"
        ) {
          openQuestionDrawer();
          return;
        }

        document
          .querySelectorAll(
            ".nav-item"
          )
          .forEach((item) => {
            item.classList.remove(
              "active"
            );
          });

        button.classList.add(
          "active"
        );

        setElementText(
          "#page-title",
          view
        );

        if (view === "Inbox") {
          activeFilter = "all";
        }

        if (view === "Priority") {
          activeFilter =
            "priority";
        }

        if (view === "Leads") {
          activeFilter = "lead";
        }

        if (view === "Rules") {
          showToast(
            "Rules workspace is not implemented yet"
          );
        }

        if (view === "Analytics") {
          showToast(
            "Analytics workspace is not implemented yet"
          );
        }

        document
          .querySelectorAll(
            ".filter-tab"
          )
          .forEach((tab) => {
            tab.classList.toggle(
              "active",
              tab.dataset.filter ===
                activeFilter
            );
          });

        renderEmails();
      }
    );
  });

document.addEventListener(
  "keydown",
  (event) => {
    if (
      (
        event.ctrlKey ||
        event.metaKey
      ) &&
      event.key === "Enter"
    ) {
      event.preventDefault();
      runAnalysis();
    }

    if (event.key === "Escape") {
      closeQuestionDrawer();
    }
  }
);

async function startApplication() {
  renderEmails();
  connectRealTimeEvents();

  const parameters =
    new URLSearchParams(
      window.location.search
    );

  if (
    parameters.get("gmail") ===
    "connected"
  ) {
    showToast(
      "Gmail connected successfully"
    );

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );
  }

  if (
    parameters.get("gmail") ===
    "error"
  ) {
    showToast(
      `Gmail connection failed: ${
        parameters.get("message") ||
        "Unknown OAuth error"
      }`
    );
  }

  try {
    await loadQuestions();
  } catch (error) {
    showToast(
      `Unable to load questions: ${error.message}`
    );
  }

  const status =
    await checkConnection();

  if (status?.gmailConnected) {
    await loadEmails({
      refresh: true
    });
  }

  clearInterval(pollingTimer);

  pollingTimer = setInterval(
    async () => {
      const currentStatus =
        await checkConnection();

      if (
        currentStatus
          ?.gmailConnected &&
        !analysisRunning
      ) {
        await loadEmails({
          refresh: true,
          quiet: true
        });
      }
    },
    30000
  );
}

installButtonAnimations();
installOptionalButtonHandlers();
startApplication();