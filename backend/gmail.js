import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIRECTORY = path.resolve(__dirname, "..");
const CREDENTIALS_PATH = path.join(ROOT_DIRECTORY, "credentials.json");
const TOKEN_PATH = path.join(ROOT_DIRECTORY, "token.json");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly"
];

function readCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `credentials.json was not found at ${CREDENTIALS_PATH}`
    );
  }

  const parsed = JSON.parse(
    fs.readFileSync(CREDENTIALS_PATH, "utf8")
  );

  const credentials = parsed.web || parsed.installed;

  if (!credentials) {
    throw new Error(
      "credentials.json must contain either a web or installed OAuth client."
    );
  }

  return credentials;
}

function createOAuthClient() {
  const credentials = readCredentials();

  const redirectUri =
    process.env.GMAIL_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || "http://localhost:3000"}/api/auth/google/callback`;

  return new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    redirectUri
  );
}

export function hasStoredToken() {
  return fs.existsSync(TOKEN_PATH);
}

export async function getAuthenticatedClient() {
  if (!hasStoredToken()) {
    throw new Error("GMAIL_NOT_CONNECTED");
  }

  const oauthClient = createOAuthClient();
  const storedToken = JSON.parse(
    fs.readFileSync(TOKEN_PATH, "utf8")
  );

  oauthClient.setCredentials(storedToken);

  oauthClient.on("tokens", (tokens) => {
    const existing = fs.existsSync(TOKEN_PATH)
      ? JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"))
      : {};

    fs.writeFileSync(
      TOKEN_PATH,
      JSON.stringify(
        {
          ...existing,
          ...tokens
        },
        null,
        2
      )
    );
  });

  try {
    await oauthClient.getAccessToken();
    return oauthClient;
  } catch (error) {
    fs.rmSync(TOKEN_PATH, { force: true });
    throw new Error(
      `Gmail authorization has expired or was revoked: ${error.message}`
    );
  }
}

export function getAuthorizationUrl() {
  const oauthClient = createOAuthClient();

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    include_granted_scopes: true
  });
}

export async function exchangeAuthorizationCode(code) {
  const oauthClient = createOAuthClient();

  const { tokens } = await oauthClient.getToken(code);

  if (!tokens.refresh_token && fs.existsSync(TOKEN_PATH)) {
    const existing = JSON.parse(
      fs.readFileSync(TOKEN_PATH, "utf8")
    );

    tokens.refresh_token = existing.refresh_token;
  }

  fs.writeFileSync(
    TOKEN_PATH,
    JSON.stringify(tokens, null, 2),
    {
      mode: 0o600
    }
  );

  return tokens;
}

export function disconnectGmail() {
  fs.rmSync(TOKEN_PATH, { force: true });
}

function decodeBase64Url(value = "") {
  if (!value) {
    return "";
  }

  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  return Buffer.from(normalized, "base64").toString("utf8");
}

function removeHtml(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractEmailBody(payload) {
  let plainText = "";
  let htmlText = "";

  function visit(part) {
    if (!part) {
      return;
    }

    const mimeType = part.mimeType || "";
    const data = part.body?.data;

    if (data && mimeType === "text/plain") {
      plainText += `\n${decodeBase64Url(data)}`;
    }

    if (data && mimeType === "text/html") {
      htmlText += `\n${removeHtml(decodeBase64Url(data))}`;
    }

    for (const child of part.parts || []) {
      visit(child);
    }
  }

  visit(payload);

  return (plainText.trim() || htmlText.trim()).slice(0, 20000);
}

function getHeader(headers, name) {
  return (
    headers.find(
      (header) =>
        header.name?.toLowerCase() === name.toLowerCase()
    )?.value || ""
  );
}

function splitSender(fromHeader) {
  const match = fromHeader.match(
    /^(?:"?([^"]*)"?\s)?<?([^<>@\s]+@[^<>\s]+)>?$/
  );

  if (!match) {
    return {
      sender: fromHeader || "Unknown sender",
      email: fromHeader || ""
    };
  }

  return {
    sender:
      match[1]?.trim() ||
      match[2]?.split("@")[0] ||
      "Unknown sender",
    email: match[2] || ""
  };
}

function createInitials(sender) {
  return String(sender)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function formatReceived(internalDate) {
  const timestamp = Number(internalDate);

  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);
  const difference = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (difference < minute) {
    return "Just now";
  }

  if (difference < hour) {
    return `${Math.floor(difference / minute)} min ago`;
  }

  if (difference < day) {
    return `${Math.floor(difference / hour)} hrs ago`;
  }

  if (difference < 2 * day) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short"
  });
}

function normalizeMessage(message) {
  const headers = message.payload?.headers || [];

  const from = getHeader(headers, "From");
  const subject = getHeader(headers, "Subject") || "(No subject)";
  const senderDetails = splitSender(from);
  const body = extractEmailBody(message.payload);

  return {
    id: message.id,
    threadId: message.threadId,
    sender: senderDetails.sender,
    email: senderDetails.email,
    initials: createInitials(senderDetails.sender),
    subject,
    snippet: message.snippet || "",
    body: body || message.snippet || "",
    received: formatReceived(message.internalDate),
    receivedAt: Number(message.internalDate),
    unread: (message.labelIds || []).includes("UNREAD"),
    labelIds: message.labelIds || []
  };
}

export async function getGmailProfile() {
  const auth = await getAuthenticatedClient();
  const gmail = google.gmail({
    version: "v1",
    auth
  });

  const response = await gmail.users.getProfile({
    userId: "me"
  });

  return response.data;
}

export async function fetchInboxEmails({
  maxResults = 25,
  query = "in:inbox"
} = {}) {
  const auth = await getAuthenticatedClient();

  const gmail = google.gmail({
    version: "v1",
    auth
  });

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults: Math.min(Math.max(maxResults, 1), 100),
    q: query
  });

  const messageReferences = response.data.messages || [];

  const messages = await Promise.all(
    messageReferences.map(async ({ id }) => {
      const messageResponse =
        await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full"
        });

      return normalizeMessage(messageResponse.data);
    })
  );

  return messages.sort(
    (first, second) =>
      second.receivedAt - first.receivedAt
  );
}