# LinguaVerse — Phase 1 (OpenRouter Conversation Engine)

Phase 1 replaces the old `HTTPServer` + TF-IDF-only chat response with a FastAPI backend connected to OpenRouter. The existing UI is retained for now; a visual redesign is intentionally deferred until the core engine is verified.

## Features in this phase

- Open-ended LLM conversation, not restricted to uploaded grammar documents.
- Ten learning languages: Spanish, French, German, Italian, Portuguese, Russian, Japanese, Mandarin Chinese, Hindi and English.
- Per-session conversation memory held by the backend (bounded to the latest messages).
- Beginner / intermediate / advanced tutor prompt support.
- API key stays on the backend in `.env`.
- Health endpoint and readable API error messages.
- Session reset endpoint.
- LLM-generated quiz endpoint based on the current conversation (early Phase 1 implementation).
- Existing browser speech recognition and speech synthesis remain available where supported by the browser.

## Requirements

- Python 3.10 or newer (Python 3.11 is recommended).
- An OpenRouter account and API key with available credits / a configured spending limit.
- Internet connection.

## Windows setup (PowerShell)

1. Extract this folder and open PowerShell inside `LinguaVerse_Phase1`.
2. Create a virtual environment:

   ```powershell
   py -3.11 -m venv .venv
   ```

3. Activate it:

   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```

   If PowerShell blocks activation, use this instead without activating:

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

4. Install dependencies:

   ```powershell
   python -m pip install --upgrade pip
   python -m pip install -r requirements.txt
   ```

5. Create your local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

6. Open `.env`, replace the placeholder with your actual OpenRouter key, and optionally change `OPENROUTER_MODEL` to a model ID available in your OpenRouter account. Never put the key in `app.js`, HTML, or a public GitHub repository.

7. Start the server:

   ```powershell
   python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
   ```

8. Open `http://127.0.0.1:8000`.

## Verify the backend

Open `http://127.0.0.1:8000/api/health`. It should return `status: ok`, `provider: openrouter`, and `api_key_configured: true`.

## Model selection

Set `OPENROUTER_MODEL` in `.env`. The default is `openai/gpt-4o-mini` as a configurable example; model availability and price depend on OpenRouter and the account. Check the current model catalogue at https://openrouter.ai/models.

## API

- `GET /api/health` — server and key configuration status (does not reveal the key).
- `GET /api/languages` — supported language list.
- `POST /api/chat` — `{ "utterance": "...", "language": "fr", "session_id": "...", "level": "beginner" }`.
- `POST /api/reset` — `{ "session_id": "..." }`.
- `POST /api/generate_quiz` — quiz generation from supplied session turns.

## Important Phase 1 boundaries

- Session history is in RAM and will be lost when the server restarts. It is not a persistent user-account memory system.
- The live grammar sidecard is not implemented in Phase 1. The chat response intentionally returns `has_error: false`; independent correction analysis is Phase 2.
- Browser speech recognition support varies by browser and operating system. This phase uses the browser's native speech APIs rather than a server-side Whisper pipeline.
- Do not deploy this development server publicly as-is. Production deployment needs authentication, rate limiting, persistent storage, stricter origin configuration, and per-user session isolation.


## Language accuracy score

The session summary calculates a word-weighted estimate from analyzed learner messages: correctly written words contribute to the score, while words inside detected incorrect snippets reduce it. If grammar analysis was unavailable for every turn, the score displays `N/A` rather than a misleading `0%`. This is a grammar/spelling accuracy estimate, not a complete measure of speaking fluency, pronunciation, or communicative ability.

## Learning Hub additions

The Learning Hub adds four features while retaining the existing conversation, correction sidecard, session summary, quiz, onboarding, and responsive chat layout:

- **Vocabulary flashcards:** Find useful vocabulary in the current conversation using OpenRouter, save words with meanings/examples, reveal cards for revision, and delete cards. Saved vocabulary is stored locally in `linguaverse_data.sqlite3` and separated by learning language.
- **Learning streaks:** A day is counted when at least one chat turn is successfully processed. The dashboard shows consecutive practice days, days/messages this week, and saved vocabulary. Practice history is stored locally in SQLite. (The current version tracks activity days and message counts, not verified wall-clock study duration.)
- **Pronunciation practice:** Uses browser speech synthesis to play the target sentence and browser speech recognition to transcribe the learner. The score is a text similarity estimate between the target and recognized words; it is **not** phoneme-level pronunciation, accent, or prosody scoring. Chrome support and microphone permission are required for speech recognition.
- **Conversation topics:** Provides language-specific topic prompts to launch a conversation.

The Learning Hub uses the currently selected language. Vocabulary and practice history persist across server restarts in the local SQLite database. Keep `.env` private and do not share your OpenRouter API key.


## Google account sign-in (optional)

LinguaVerse supports **Sign in with Google** using Google OAuth 2.0 / OpenID Connect. Users can still open the app as a guest when Google credentials have not been configured. When signed in, vocabulary flashcards and learning streak records are stored separately for each Google account in the local SQLite database. The app stores the Google account ID, email, display name and profile image URL; it does not ask for or store a Google password.

### Configure Google OAuth for local development

1. Open the [Google Cloud Console](https://console.cloud.google.com/). Create or select a project.
2. Configure the OAuth consent screen. For local testing, add your Google account as a test user if the app is in Testing mode.
3. Create an OAuth Client ID with application type **Web application**.
4. Add this exact **Authorized redirect URI**:

   `http://127.0.0.1:8000/auth/callback`

5. Copy the Client ID and Client Secret into your local `.env` file:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   SESSION_SECRET=paste-a-long-random-secret-here
   COOKIE_SECURE=false
   ```

6. Generate a random session secret in PowerShell if needed:

   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

7. Restart the server and click **Continue with Google**.

Use the same hostname consistently: if the redirect URI is registered for `127.0.0.1`, open the app at `http://127.0.0.1:8000`, not `http://localhost:8000`. If you change the host or port, update the Google Authorized redirect URI to match exactly.

### Account and data behaviour

- Guests can continue using the app without signing in; their local data is stored under the guest profile on that computer.
- Signed-in accounts have separate vocabulary flashcards and practice-day/streak records.
- Signing out returns the browser to guest mode. It does not delete the account's saved database records.
- Chat turns and active conversation memory are currently held in server memory and are not yet a cross-device, persistent chat-history feature.
- For a public HTTPS deployment, set a strong unique `SESSION_SECRET`, set `COOKIE_SECURE=true`, configure the exact HTTPS callback URI in Google Cloud, and add production protections such as HTTPS, rate limiting, backups and deployment-specific trusted-host/origin settings. Never commit `.env` or expose the Google client secret.

### Authentication endpoints

- `GET /auth/login` — begin Google sign-in.
- `GET /auth/callback` — Google OAuth callback.
- `POST /auth/logout` — sign out.
- `GET /api/me` — current sign-in status and safe profile fields.
