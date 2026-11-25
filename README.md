# LinguaLoop — English Conversation Coach

Practice real English conversation with an AI partner — ordering food, a job
interview, small talk, travel, or asking directions. Get instant grammar
fixes and a natural reply, every turn. Built with **Firebase AI Logic
hybrid inference**.

## What it does

- Pick a situation (Ordering food, Job interview, Small talk, Travel & hotel,
  Asking directions). The AI plays the other person.
- Type (or speak, in Chrome) your reply in English.
- Every turn you get two things:
  1. **A grammar fix** — a quick single-turn check that runs **on-device**
     with Gemini Nano (private, fast, free).
  2. **A conversation reply** — the AI answers in character and asks a
     follow-up question. This runs **in the cloud** with Gemini, because
     on-device inference does not support multi-turn chat.
- Optional: read replies aloud (text-to-speech) and dictate with the
  microphone (Chrome speech recognition).
- Each message shows where it was generated (on-device or cloud).

## How it uses Firebase AI Logic

- `app.js` initializes Firebase and the AI service with the **Gemini
  Developer API** backend:
  `getAI(firebaseApp, { backend: new GoogleAIBackend() })`.
- **Grammar check** (`checkGrammarLive`): a single-turn call created on the
  Send click with `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE })`,
  so it uses Gemini Nano when available and falls back to the cloud. The
  response's `inferenceSource` is shown as a badge.
- **Conversation reply** (`getReplyLive`): a multi-turn conversation carried
  in the prompt, run with `getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD })`
  and the Gemini cloud model — on-device inference cannot do multi-turn
  chat, so the cloud handles it. This split is the point of the demo: one
  SDK, each job on the right engine.
- Both calls are made in parallel per turn (`Promise.all`), so the
  correction and the reply arrive together.
- App Check is set up in `initFirebase()` (debug token accepted for local
  development — register the token printed in the console under
  Firebase console > App Check > your web app > Manage debug tokens).

## Run it

No build step. Serve the folder over HTTP (required for ES modules) and open
it in Chrome (desktop, v139+ for on-device inference):

```bash
# from this folder
python3 -m http.server 8081
# then open http://localhost:8081
```

Enable the on-device model in Chrome once:
`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled,
then restart Chrome.

## Connect your Firebase project (2 minutes)

1. Go to https://console.firebase.google.com and create a project (free).
2. Open **Firebase AI Logic**, click **Get started**, choose the
   **Gemini Developer API** provider.
3. In Project settings, add a **Web app** and copy its `firebaseConfig`.
4. Paste the values into `firebase-config.js`, replacing the `YOUR_...`
   placeholders.
5. Reload the page — the banner switches from Demo Mode to Live.

Without a config the app runs in **Demo Mode** with built-in sample replies
so the interface can be explored; live AI requires a real Firebase project.
Text inference with Firebase AI Logic is free within usage limits.

## Tech

- Firebase AI Logic JS SDK v13 (`firebase/app`, `firebase/ai`,
  `firebase/app-check`) via CDN import map — no bundler.
- Vanilla HTML/CSS/JS. Web Speech API for microphone input and spoken
  replies. No data leaves the device except the prompts sent to the models
  you choose.

## License

Apache License 2.0 — see `LICENSE`.
