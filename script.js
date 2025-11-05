// Simple beginner-friendly chat script that:
// - Captures user input
// - Sends messages to a Cloudflare Worker proxy (recommended) or falls back to OpenAI (development only)
// - Displays responses in the chat window, preserving line breaks
// - System message instructs the assistant to refuse off-topic requests politely

// Get DOM elements once (guard if HTML structure is missing)
const chatForm = document.getElementById("chatForm");
let userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
let sendBtn = document.getElementById("sendBtn");

// If the expected input/button are missing in the page (common student typo), create them so the UI still works.
if (!chatForm) {
  console.error("Missing #chatForm in the page — script cannot initialize.");
}
if (!userInput) {
  // Create a simple input and append to the form so students with a missing id still get a working UI
  userInput = document.createElement("input");
  userInput.id = "userInput";
  userInput.required = true;
  if (chatForm) chatForm.appendChild(userInput);
}
if (!sendBtn) {
  sendBtn = document.createElement("button");
  sendBtn.id = "sendBtn";
  sendBtn.type = "submit";
  sendBtn.textContent = "Send";
  if (chatForm) chatForm.appendChild(sendBtn);
}

// Use the Cloudflare Worker proxy URL (ensure the worker is configured to allow CORS).
// Keep the trailing slash if your worker expects it.
const workerUrl = "https://loreal-worker.gaz9.workers.dev/";

// Helper: escape HTML then preserve newlines as <br>
function formatMessageForDisplay(text) {
  if (!text) return "";
  const escaped = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\r\n|\r|\n/g, "<br>");
}

// Append a message to chatWindow. role = "bot" or "user"
function appendMessage(role, text) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.innerHTML = formatMessageForDisplay(text);
  if (chatWindow) {
    chatWindow.appendChild(el);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
  return el;
}

// Typing indicator helpers
function addTypingIndicator() {
  const existing = document.getElementById("typingIndicator");
  if (existing) return;
  const el = document.createElement("div");
  el.className = "message bot typing";
  el.id = "typingIndicator";
  el.textContent = "L'Oréal Advisor is typing…";
  if (chatWindow) {
    chatWindow.appendChild(el);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}
function removeTypingIndicator() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

// System instruction: focus on L'Oréal / beauty and refuse off-topic politely
const systemMessage = {
  role: "system",
  content:
    "You are the L'Oréal Smart Product Advisor. Provide helpful, accurate, and safety-conscious advice about L'Oréal products, skincare, makeup, haircare, routines, and related beauty topics. If a user asks something unrelated to L'Oréal or beauty (for example medical diagnoses, politics, or illegal activities), politely refuse and steer the conversation back to beauty/product guidance. Keep answers friendly, concise, and respectful.",
};

// Conversation history (start with system message)
let messages = [systemMessage];

// Initial greeting shown in UI and added to history
const initialGreeting = "👋 Hello! How can I help you today?";
appendMessage("bot", initialGreeting);
messages.push({ role: "assistant", content: initialGreeting });

// Disable/enable controls while awaiting a response
function setBusy(isBusy) {
  if (isBusy) {
    sendBtn && sendBtn.setAttribute("disabled", "disabled");
    userInput && userInput.setAttribute("disabled", "disabled");
  } else {
    sendBtn && sendBtn.removeAttribute("disabled");
    userInput && userInput.removeAttribute("disabled");
  }
}

// Helper: fetch with timeout using AbortController (simple, beginner-friendly)
async function timeoutFetch(url, opts = {}, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const finalOpts = {
      mode: "cors",
      ...opts,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(opts.headers || {}),
      },
    };
    const res = await fetch(url, finalOpts);
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Try to load a local secrets file if OPENAI_API_KEY is not defined.
// This helps when students accidentally created seret.js or secrets.js with the key.
function loadLocalScript(url) {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

async function ensureApiKeyLoaded() {
  // If already defined, nothing to do
  if (typeof OPENAI_API_KEY !== "undefined" && OPENAI_API_KEY) return true;

  // Try common filenames the student might have created (secrets.js or seret.js)
  const candidates = ["secrets.js", "seret.js"];
  for (const c of candidates) {
    // If the script tag already exists, skip loading again
    if (document.querySelector(`script[src="${c}"]`)) {
      if (typeof OPENAI_API_KEY !== "undefined" && OPENAI_API_KEY) return true;
      continue;
    }
    // Attempt to load the file; it's okay if this fails
    // (students sometimes have typos — we try both names)
    // Note: this only works when files are served by the dev server or Codespace.
    // Loading will fail if the file isn't accessible from the page.
    // We await the result so we can check OPENAI_API_KEY after load.
    // Keep the operation short to avoid blocking UX.
    // eslint-disable-next-line no-await-in-loop
    await loadLocalScript(c);
    if (typeof OPENAI_API_KEY !== "undefined" && OPENAI_API_KEY) return true;
  }
  return false;
}

// Send conversation to the Cloudflare Worker (preferred) or OpenAI directly as fallback.
// Returns assistant text.
async function fetchChatCompletion(conversation) {
  const payloadMessages = conversation.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Try the worker proxy first (if configured)
  if (workerUrl && workerUrl.trim() !== "") {
    try {
      const res = await timeoutFetch(
        workerUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: payloadMessages }),
        },
        8000
      ); // 8s timeout for worker

      // Detect opaque responses (common when CORS is not enabled)
      if (res.type === "opaque") {
        throw new Error(
          "Worker returned an opaque response (likely a CORS issue). Ensure the worker sets Access-Control-Allow-Origin to allow your page's origin."
        );
      }

      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        throw new Error(`Worker returned invalid JSON: ${parseErr.message}`);
      }

      console.debug("Worker response:", res.status, res.statusText, data);

      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        if (data) {
          if (typeof data.error === "string") msg = data.error;
          else if (data.error && data.error.message) msg = data.error.message;
          else if (data.message) msg = data.message;
          else msg = JSON.stringify(data);
        }
        throw new Error(msg);
      }

      // Accept common worker response shapes
      if (data.assistant) return data.assistant;
      if (data.choices && data.choices[0] && data.choices[0].message)
        return data.choices[0].message.content.trim();
      if (data.reply) return data.reply;
      if (data.error) {
        const e = data.error;
        const message =
          (e && e.message) || (typeof e === "string" && e) || JSON.stringify(e);
        throw new Error(message);
      }
      return JSON.stringify(data);
    } catch (workerErr) {
      // Network/CORS/timeout errors often show as TypeError or "Failed to fetch"
      console.warn(
        "Worker request failed, attempting fallback if possible:",
        workerErr
      );

      // Try to load local secrets files (students sometimes forgot to include file)
      const keyAvailable = await ensureApiKeyLoaded();

      if (keyAvailable) {
        console.info(
          "Falling back to direct OpenAI call (development only) because worker failed."
        );
        // fall through to direct OpenAI call below
      } else {
        // No API key available locally -> show readable error to user with concrete next steps
        throw new Error(
          "Unable to contact the proxy service (network/CORS/timeout). To fix: 1) Ensure your Cloudflare Worker URL is correct and the worker sets Access-Control-Allow-Origin (e.g., '*'). 2) Open the browser Network tab to inspect the worker request and CORS preflight. 3) For local development you can add a secrets.js file defining OPENAI_API_KEY or fix the worker. (See console for the worker error.)"
        );
      }
    }
  }

  // ---- Direct OpenAI call (development only) ----
  // Ensure local key is loaded (helps if students had a filename typo)
  if (typeof OPENAI_API_KEY === "undefined" || !OPENAI_API_KEY) {
    const loaded = await ensureApiKeyLoaded();
    if (!loaded) {
      throw new Error(
        "OPENAI_API_KEY is not set. Add a secrets.js file with: const OPENAI_API_KEY = 'sk-...'; (development only)."
      );
    }
  }

  const endpoint = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: "gpt-4o",
    messages: payloadMessages,
    max_tokens: 500,
    temperature: 0.2,
  };

  // Use timeoutFetch for the direct call as well
  const res = await timeoutFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    },
    12000
  ); // 12s timeout for OpenAI

  const data = await res.json();

  if (!res.ok) {
    const errMsg =
      (data && data.error && (data.error.message || data.error)) ||
      (data && data.message) ||
      `HTTP ${res.status} - ${res.statusText}`;
    throw new Error(errMsg);
  }

  const assistantText =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
      ? data.choices[0].message.content.trim()
      : "";

  return assistantText;
}

// Form submit handler: capture input, show user message, call API, display reply
if (chatForm) {
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = (userInput && userInput.value ? userInput.value : "").trim();
    if (!text) return;

    // Append user's message and add to conversation
    appendMessage("user", text);
    messages.push({ role: "user", content: text });

    // Clear input and prepare UI
    if (userInput) userInput.value = "";
    userInput && userInput.focus();

    // Show typing indicator and disable controls
    addTypingIndicator();
    setBusy(true);

    try {
      const assistantText = await fetchChatCompletion(messages);

      // Remove typing indicator
      removeTypingIndicator();

      if (!assistantText) {
        appendMessage(
          "bot",
          "Sorry, I couldn't generate a response. Please try again."
        );
        setBusy(false);
        return;
      }

      // Append assistant message and add to history
      appendMessage("bot", assistantText);
      messages.push({ role: "assistant", content: assistantText });
    } catch (err) {
      removeTypingIndicator();
      // Show a readable error message in the chat (not the console)
      appendMessage(
        "bot",
        `There was an error contacting the API: ${err.message || String(err)}`
      );
      console.error("Chat error:", err);
    } finally {
      setBusy(false);
    }
  });
} else {
  console.error(
    "chatForm not found — please check index.html contains a form with id='chatForm'"
  );
}
