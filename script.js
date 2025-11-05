// Simple beginner-friendly chat script that:
// - Captures user input
// - Sends messages to a Cloudflare Worker proxy (recommended) or falls back to OpenAI (not recommended in browser)
// - Displays responses in the chat window, preserving line breaks
// - System message instructs the assistant to refuse off-topic requests politely

// Get DOM elements once
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");

// Use empty workerUrl to force direct calls from this Codespace (uses secrets.js).
// In production you should use a worker/proxy instead to keep your key secret.
const workerUrl = ""; // was "https://loreal-worker.gaz9.workers.dev/";

// Helper: escape HTML then preserve newlines as <br>
function formatMessageForDisplay(text) {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\r\n|\r|\n/g, "<br>");
}

// Append a message to chatWindow. role = "bot" or "user"
function appendMessage(role, text) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  // Use innerHTML after escaping + newline -> <br> conversion so spacing is preserved
  el.innerHTML = formatMessageForDisplay(text);
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return el;
}

// Typing indicator helpers
function addTypingIndicator() {
  const el = document.createElement("div");
  el.className = "message bot typing";
  el.id = "typingIndicator";
  el.textContent = "L'Oréal Advisor is typing…";
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
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
    sendBtn.setAttribute("disabled", "disabled");
    userInput.setAttribute("disabled", "disabled");
  } else {
    sendBtn.removeAttribute("disabled");
    userInput.removeAttribute("disabled");
  }
}

// Send conversation to the Cloudflare Worker (preferred) or OpenAI directly as fallback.
// Returns assistant text.
async function fetchChatCompletion(conversation) {
  // Always send the full conversation history (safe copy)
  const payloadMessages = conversation.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Try worker proxy only when configured (empty => skip)
  if (workerUrl && workerUrl.trim() !== "") {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: payloadMessages }),
    });

    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(`Worker returned non-JSON response: ${err.message}`);
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
  }

  // ---- Direct OpenAI call (development only) ----
  // Ensure the local secrets.js defines: const OPENAI_API_KEY = "sk-...";
  if (typeof OPENAI_API_KEY === "undefined" || !OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add your key to secrets.js in the Codespace."
    );
  }

  const endpoint = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: "gpt-4o",
    messages: payloadMessages,
    max_tokens: 500,
    temperature: 0.2,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  // Better error message extraction so errors like "Incorrect API key provided: undefined"
  // surface the real message instead of [object Object].
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
chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  // Append user's message and add to conversation
  appendMessage("user", text);
  messages.push({ role: "user", content: text });

  // Clear input and prepare UI
  userInput.value = "";
  userInput.focus();

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
