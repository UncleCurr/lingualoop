// LinguaLoop — English conversation coach with Firebase AI Logic.
// Hybrid split: quick single-turn grammar checks run ON-DEVICE (Gemini Nano);
// the multi-turn conversation runs IN THE CLOUD (Gemini), because the
// on-device model does not support multi-turn chat. Firebase AI Logic
// routes each request to the right place with one SDK.
// ---------------------------------------------------------------------------
import { initializeApp } from "firebase/app";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const chatEl = $("chat");
const typingEl = $("typing");
const msgInput = $("msgInput");
const sendBtn = $("sendBtn");
const micBtn = $("micBtn");
const speakToggle = $("speakToggle");
const newBtn = $("newBtn");
const grammarPanel = $("grammarPanel");
const grammarBadge = $("grammarBadge");
const scenarioDesc = $("scenarioDesc");
const demoBanner = $("demoBanner");
const engineBadge = $("engineBadge");

let firebaseApp = null;
let ai = null;
let currentScenario = "food";
let history = []; // { role: "user" | "ai", text: string }
let demoStep = 0;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const SCENARIOS = {
  food: {
    label: "Ordering food",
    desc: "You are at a restaurant. Order a meal, ask about the menu, and handle the bill — in English.",
    role: "You are a friendly waiter at a casual restaurant. The user is practicing English. Respond naturally in 1-3 sentences, stay in character, and ask a follow-up question. Do not correct the user's grammar in your reply.",
    greeting: "Hi there! Welcome to our restaurant. Can I get you something to drink first, or would you like to see the menu?",
    demoReplies: [
      "Great choice! Would you like that with rice or with fries?",
      "Of course. Anything else for you today — maybe a dessert or another drink?",
      "Perfect. I will bring that right out. Can I get you anything else while you wait?",
      "No problem at all. Your total is twenty-four dollars. Would you like to pay by card or cash?",
    ],
  },
  interview: {
    label: "Job interview",
    desc: "You are being interviewed for a job. Answer questions about yourself, your experience, and your strengths.",
    role: "You are a friendly hiring manager interviewing the user for a job. Ask one interview question at a time, respond naturally in 1-3 sentences, and ask a follow-up question. Do not correct the user's grammar in your reply.",
    greeting: "Hello, thanks for coming in. Please, have a seat. Could you start by telling me a little about yourself?",
    demoReplies: [
      "That is interesting. Can you tell me about a challenge you faced at work and how you handled it?",
      "Good example. What would you say is your greatest strength?",
      "Thank you. Do you have any questions for me about the role or the team?",
      "Great, thank you for your time today. We will be in touch within the week.",
    ],
  },
  smalltalk: {
    label: "Small talk",
    desc: "Casual chat — the weather, the weekend, hobbies. Keep it light and natural.",
    role: "You are a friendly colleague making small talk with the user. Chat casually in 1-3 sentences, ask a follow-up question, and keep the tone light. Do not correct the user's grammar in your reply.",
    greeting: "Hey! How is your day going so far?",
    demoReplies: [
      "Nice! What did you get up to last weekend?",
      "That sounds fun. Do you have any plans for this weekend?",
      "I know what you mean. By the way, have you watched anything good lately?",
      "Ha, exactly. Well, it was nice chatting with you — catch you later!",
    ],
  },
  travel: {
    label: "Travel & hotel",
    desc: "You are at a hotel front desk. Check in, ask about your room, and sort out a small problem.",
    role: "You are a helpful hotel receptionist. The user is a guest practicing English. Respond naturally in 1-3 sentences, stay in character, and ask a follow-up question. Do not correct the user's grammar in your reply.",
    greeting: "Good afternoon! Welcome to the Riverside Hotel. Do you have a reservation with us?",
    demoReplies: [
      "Perfect, I found your booking. Your room is on the third floor. Would you like help with your bags?",
      "Breakfast is served from 7 to 10 in the morning, on the ground floor. Is there anything else you need?",
      "I am sorry about that. I will send someone to fix it right away. Anything else I can help with?",
      "You are very welcome. Enjoy your stay, and let us know if you need anything.",
    ],
  },
  directions: {
    label: "Asking directions",
    desc: "You are lost in a city. Ask a passerby how to get to the station, a museum, or a restaurant.",
    role: "You are a friendly local helping a visitor who is lost. Give clear, simple directions in 1-3 sentences and ask a follow-up question. Do not correct the user's grammar in your reply.",
    greeting: "Hi! You look a little lost. Where are you trying to get to?",
    demoReplies: [
      "Sure. Go straight ahead for two blocks, then turn left at the traffic light. You will see it on your right.",
      "It is about a ten-minute walk from here. Would you like me to show you on the map?",
      "No problem. If you get lost again, just ask anyone — people here are friendly.",
      "You are welcome! Have a great day.",
    ],
  },
};

// ---------------------------------------------------------------------------
// Demo mode: scripted replies + a tiny local grammar fixer.
// ---------------------------------------------------------------------------
const DEMO_FIXES = [
  [/^i am go\b/i, "I am going"],
  [/\bi is\b/i, "I am"],
  [/\bhe don't\b/i, "he doesn't"],
  [/\bthey is\b/i, "they are"],
  [/\bmore better\b/i, "better"],
  [/\bvery much interesting\b/i, "very interesting"],
];
function demoGrammar(text) {
  let corrected = text;
  const notes = [];
  for (const [re, fix] of DEMO_FIXES) {
    if (re.test(corrected)) {
      corrected = corrected.replace(re, fix);
      notes.push(`Say "${fix}" instead of the matched phrase.`);
    }
  }
  // Capitalize the first letter and add a period if missing.
  corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
  if (!/[.!?]$/.test(corrected)) corrected += ".";
  if (corrected === text || corrected === text.charAt(0).toUpperCase() + text.slice(1) + ".") {
    return { corrected: null, notes: ["Looks good — no clear errors in this sentence."] };
  }
  if (!notes.length) notes.push("Capitalization and punctuation tidied up.");
  return { corrected, notes };
}
function demoReply() {
  const list = SCENARIOS[currentScenario].demoReplies;
  const reply = list[Math.min(demoStep, list.length - 1)];
  demoStep += 1;
  return reply;
}

// ---------------------------------------------------------------------------
// Firebase setup
// ---------------------------------------------------------------------------
function initFirebase() {
  if (!isConfigured) return false;
  try {
    firebaseApp = initializeApp(firebaseConfig);
    try {
      initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaEnterpriseProvider("6Ld4JjMuAAAAAIYZ9eIoz1eMsfraeFWjtYVQPmbk"),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn("App Check setup skipped:", e);
    }
    ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    return true;
  } catch (e) {
    console.error("Firebase init failed:", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// AI calls
// ---------------------------------------------------------------------------
// Single-turn grammar check — runs on-device when possible.
async function checkGrammarLive(text) {
  // NOTE: getGenerativeModel is called here, on the Send click, because the
  // inference mode requires a user interaction.
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: {
      model: "gemini-3.5-flash-lite",
      generationConfig: { maxOutputTokens: 200, temperature: 0.2 },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [
          {
            role: "system",
            content: [{ type: "text", value: "You are a precise English grammar teacher. Correct the sentence and explain briefly." }],
          },
        ],
      },
    },
  });
  const prompt =
    `Correct the grammar of this English sentence. Reply in exactly this format:\n` +
    `Corrected: <the corrected sentence, or "No errors" if it is already correct>\n` +
    `Notes: <one short explanation of the main fix, or "—" if there are no errors>\n\n` +
    `Sentence: ${text}`;
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const raw = response.text();
  const source = response.inferenceSource || "IN_CLOUD";
  const mCorr = raw.match(/Corrected:\s*(.+)/i);
  const mNote = raw.match(/Notes:\s*(.+)/i);
  const corrected = mCorr ? mCorr[1].trim() : null;
  const notes = mNote ? [mNote[1].trim()] : [];
  return { corrected, notes, source };
}

// Multi-turn conversation — runs in the cloud, because on-device inference
// does not support multi-turn chat. We carry the history in the prompt.
async function getReplyLive(userText) {
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: "gemini-3.5-flash-lite",
      generationConfig: { maxOutputTokens: 300, temperature: 0.8 },
    },
  });
  const sc = SCENARIOS[currentScenario];
  const convo = history
    .slice(-8)
    .map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text}`)
    .join("\n");
  const prompt =
    `${sc.role}\n\n` +
    `Conversation so far:\n${convo}\nUser: ${userText}\n\n` +
    `Your reply (1-3 sentences, in character, with a follow-up question):`;
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return { text: response.text().trim(), source: response.inferenceSource || "IN_CLOUD" };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function addMessage(role, text, source) {
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  div.textContent = text;
  if (source) {
    const src = document.createElement("span");
    src.className = "src";
    src.textContent =
      source === "ON_DEVICE" ? "on-device · Gemini Nano" :
      source === "IN_CLOUD" ? "cloud · Gemini" : "demo";
    div.appendChild(src);
  }
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}
function addSystem(text) {
  const div = document.createElement("div");
  div.className = "msg msg-sys";
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}
function renderGrammar(fix) {
  grammarPanel.innerHTML = "";
  grammarBadge.hidden = false;
  grammarBadge.className = "mini-badge";
  if (fix.source === "ON_DEVICE") {
    grammarBadge.textContent = "on-device · Gemini Nano";
    grammarBadge.classList.add("mini-device");
  } else if (fix.source === "IN_CLOUD") {
    grammarBadge.textContent = "cloud · Gemini";
    grammarBadge.classList.add("mini-cloud");
  } else {
    grammarBadge.textContent = "demo";
    grammarBadge.classList.add("mini-demo");
  }
  if (!fix.corrected) {
    const p = document.createElement("p");
    p.className = "fix";
    p.textContent = "✓ No errors — " + (fix.notes[0] || "well said.");
    grammarPanel.appendChild(p);
    return;
  }
  const div = document.createElement("div");
  div.className = "fix";
  div.innerHTML = `<div><span class="orig"></span> → <span class="corr"></span></div><div class="note"></div>`;
  div.querySelector(".orig").textContent = fix.original;
  div.querySelector(".corr").textContent = fix.corrected;
  div.querySelector(".note").textContent = fix.notes.join(" ");
  grammarPanel.appendChild(div);
}
function speak(text) {
  if (!speakToggle.checked || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}
function setBusy(busy) {
  sendBtn.disabled = busy;
  msgInput.disabled = busy;
  typingEl.hidden = !busy;
}

// ---------------------------------------------------------------------------
// Conversation flow
// ---------------------------------------------------------------------------
async function send() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = "";
  addMessage("user", text);
  history.push({ role: "user", text });
  setBusy(true);

  if (!isConfigured || !ai) {
    // Demo mode.
    await new Promise((r) => setTimeout(r, 600));
    const fix = demoGrammar(text);
    renderGrammar({ ...fix, original: text, source: "DEMO" });
    const reply = demoReply();
    history.push({ role: "ai", text: reply });
    addMessage("ai", reply, "DEMO");
    speak(reply);
    setBusy(false);
    msgInput.focus();
    return;
  }

  // Live mode: grammar check (on-device) + reply (cloud) in parallel.
  try {
    const [fix, reply] = await Promise.all([
      checkGrammarLive(text).catch((e) => ({ corrected: null, notes: ["Grammar check unavailable: " + (e.message || e)], source: "IN_CLOUD" })),
      getReplyLive(text),
    ]);
    renderGrammar({ ...fix, original: text });
    history.push({ role: "ai", text: reply.text });
    addMessage("ai", reply.text, reply.source);
    speak(reply.text);
  } catch (e) {
    console.error(e);
    addSystem("Sorry — the AI reply failed. Check your connection and Firebase config, then try again.");
  } finally {
    setBusy(false);
    msgInput.focus();
  }
}

function startScenario(key) {
  currentScenario = key;
  history = [];
  demoStep = 0;
  chatEl.innerHTML = "";
  grammarPanel.innerHTML = '<p class="placeholder">Your grammar fixes will appear here after each message.</p>';
  grammarBadge.hidden = true;
  const sc = SCENARIOS[key];
  scenarioDesc.textContent = sc.desc;
  document.querySelectorAll("[data-scenario]").forEach((b) => {
    b.classList.toggle("chip-active", b.dataset.scenario === key);
  });
  history.push({ role: "ai", text: sc.greeting });
  addMessage("ai", sc.greeting);
  speak(sc.greeting);
  msgInput.focus();
}

// ---------------------------------------------------------------------------
// Wire up UI
// ---------------------------------------------------------------------------
sendBtn.addEventListener("click", send);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});
newBtn.addEventListener("click", () => startScenario(currentScenario));
document.querySelectorAll("[data-scenario]").forEach((b) => {
  b.addEventListener("click", () => startScenario(b.dataset.scenario));
});

// Speech input (Chrome).
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  micBtn.hidden = false;
  micBtn.addEventListener("click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    micBtn.textContent = "● Listening…";
    rec.onresult = (e) => {
      msgInput.value = e.results[0][0].transcript;
      msgInput.focus();
    };
    rec.onend = () => { micBtn.textContent = "🎙️"; };
    rec.onerror = () => { micBtn.textContent = "🎙️"; };
    try { rec.start(); } catch { micBtn.textContent = "🎙️"; }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
if (!isConfigured) {
  demoBanner.hidden = false;
  engineBadge.textContent = "Demo Mode";
} else {
  const ok = initFirebase();
  engineBadge.textContent = ok ? "Firebase AI Logic · Live" : "Demo Mode";
  if (!ok) demoBanner.hidden = false;
}
startScenario("food");
