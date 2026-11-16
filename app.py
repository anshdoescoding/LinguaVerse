"""LinguaVerse Phase 2: OpenRouter conversation + independent grammar analysis + grammar quiz."""
import os, json, logging, re, sqlite3
from typing import Dict, List, Optional
from uuid import uuid4
from datetime import date, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware
from authlib.integrations.starlette_client import OAuth

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("linguaverse")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini").strip()
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "24"))
MAX_USER_CHARS = int(os.getenv("MAX_USER_CHARS", "5000"))
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
SESSION_SECRET = os.getenv("SESSION_SECRET", "").strip() or "CHANGE_THIS_SESSION_SECRET_BEFORE_DEPLOYMENT"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
LANGUAGES = {"es":"Spanish", "fr":"French", "de":"German", "it":"Italian", "pt":"Portuguese", "ru":"Russian", "ja":"Japanese", "zh":"Mandarin Chinese", "hi":"Hindi", "en":"English"}
LEVELS = {"beginner", "intermediate", "advanced"}
app = FastAPI(title="LinguaVerse API", version="2.1.0")
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, session_cookie="linguaverse_session", same_site="lax", https_only=COOKIE_SECURE)
oauth = OAuth()
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    oauth.register(name="google", client_id=GOOGLE_CLIENT_ID, client_secret=GOOGLE_CLIENT_SECRET, server_metadata_url="https://accounts.google.com/.well-known/openid-configuration", client_kwargs={"scope": "openid email profile"})
app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")
SESSIONS: Dict[str, dict] = {}
DB_PATH = os.path.join(BASE_DIR, "linguaverse_data.sqlite3")

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT DEFAULT '', picture TEXT DEFAULT '', created_at TEXT NOT NULL, last_login TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS vocabulary (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL DEFAULT 'guest', language TEXT NOT NULL, word TEXT NOT NULL, meaning TEXT DEFAULT '', example TEXT DEFAULT '', created_at TEXT NOT NULL, UNIQUE(user_id, language, word))")
        conn.execute("CREATE TABLE IF NOT EXISTS practice_days (user_id TEXT NOT NULL DEFAULT 'guest', day TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 0, turns INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day))")
        # Migrate databases created by earlier Learning Hub builds.
        vcols = {r[1] for r in conn.execute("PRAGMA table_info(vocabulary)").fetchall()}
        if "user_id" not in vcols:
            conn.execute("ALTER TABLE vocabulary RENAME TO vocabulary_legacy")
            conn.execute("CREATE TABLE vocabulary (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL DEFAULT 'guest', language TEXT NOT NULL, word TEXT NOT NULL, meaning TEXT DEFAULT '', example TEXT DEFAULT '', created_at TEXT NOT NULL, UNIQUE(user_id, language, word))")
            conn.execute("INSERT OR IGNORE INTO vocabulary(id,user_id,language,word,meaning,example,created_at) SELECT id,'guest',language,word,meaning,example,created_at FROM vocabulary_legacy")
            conn.execute("DROP TABLE vocabulary_legacy")
        pcols = {r[1] for r in conn.execute("PRAGMA table_info(practice_days)").fetchall()}
        if "user_id" not in pcols:
            conn.execute("ALTER TABLE practice_days RENAME TO practice_days_legacy")
            conn.execute("CREATE TABLE practice_days (user_id TEXT NOT NULL DEFAULT 'guest', day TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 0, turns INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day))")
            conn.execute("INSERT OR IGNORE INTO practice_days(user_id,day,minutes,turns) SELECT 'guest',day,minutes,turns FROM practice_days_legacy")
            conn.execute("DROP TABLE practice_days_legacy")
init_db()

def current_user_id(request: Request) -> str:
    user = request.session.get("user")
    return user.get("id", "guest") if user else "guest"


class ChatRequest(BaseModel):
    utterance: str = Field(min_length=1, max_length=MAX_USER_CHARS)
    language: str = "es"
    session_id: Optional[str] = None
    level: str = "intermediate"
class ResetRequest(BaseModel): session_id: str = Field(min_length=1, max_length=128)
class QuizRequest(BaseModel):
    turns: List[dict] = Field(default_factory=list)
    language: str = "es"
    level: str = "intermediate"


def call_openrouter(messages: List[dict], temperature=0.4, max_tokens=1200) -> str:
    if not API_KEY:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY is missing. Add it to .env and restart the server.")
    try:
        from openrouter import OpenRouter
        with OpenRouter(api_key=API_KEY, x_open_router_title="LinguaVerse") as client:
            response = client.chat.send(model=DEFAULT_MODEL, messages=messages, temperature=temperature, max_tokens=max_tokens, stream=False)
        content = response.choices[0].message.content
        if isinstance(content, list): content = "\n".join(x.get("text", "") if isinstance(x, dict) else str(x) for x in content)
        if not isinstance(content, str) or not content.strip(): raise RuntimeError("Empty model response")
        return content.strip()
    except HTTPException: raise
    except Exception as exc:
        logger.exception("OpenRouter request failed")
        msg = str(exc)
        if "401" in msg or "Unauthorized" in msg: detail = "OpenRouter rejected the API key. Check your .env key."
        elif "402" in msg or "credit" in msg.lower(): detail = "OpenRouter reports insufficient credits or a spending limit."
        elif "404" in msg: detail = f"Model unavailable: {DEFAULT_MODEL}. Change OPENROUTER_MODEL in .env."
        else: detail = "OpenRouter request failed. Check internet, model availability and API account."
        raise HTTPException(status_code=502, detail=detail) from exc

def parse_json(raw: str):
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < start: raise ValueError("No JSON object returned")
    return json.loads(raw[start:end+1])

def conversation_prompt(lang, level):
    return f"""You are LinguaPartner inside LinguaVerse. The learner is practising {lang} at {level} level. Have a natural, unrestricted conversation about any appropriate topic. Respond primarily in {lang}; answer questions meaningfully, maintain context, and ask a natural follow-up when useful. Adjust vocabulary and complexity to {level}. Do not turn the conversation reply into a grammar lecture; a separate system analyzes mistakes. Be warm and realistic."""

def analyze_utterance(text, lang, level):
    prompt = f'''Analyze this learner utterance written in {lang}. Learner level: {level}.
Find genuine spelling, grammar, punctuation, agreement, conjugation, word-order and unnatural-phrasing errors. Do not invent errors. If correct, return an empty errors array. Return ONLY JSON:
{{"errors":[{{"error_type":"Grammar / Spelling / Word choice / Punctuation","original_snippet":"exact incorrect words","corrected_snippet":"corrected words","rule_explanation":"short explanation in simple language","category":"Noun / Pronoun / Verb / Tense / Adjective / Adverb / Article / Preposition / Agreement / Spelling / Punctuation / Word order / Other"}}]}}
Each distinct issue should be one item. Avoid duplicate overlapping errors. Input: {json.dumps(text, ensure_ascii=False)}'''
    try:
        data = parse_json(call_openrouter([{"role":"system","content":"You are a precise multilingual language error analyzer. Never hallucinate errors. Output JSON only."},{"role":"user","content":prompt}], temperature=0.1, max_tokens=1000))
        errors = data.get("errors", [])
        return errors if isinstance(errors, list) else []
    except Exception:
        logger.exception("Grammar analysis failed")
        # Keep conversation usable if analysis stream fails; expose status to UI.
        return None

@app.get("/")
async def home(): return FileResponse(os.path.join(BASE_DIR, "index.html"))

@app.get("/auth/login")
async def google_login(request: Request):
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET):
        raise HTTPException(503, "Google login is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.")
    redirect_uri = request.url_for("google_callback")
    return await oauth.google.authorize_redirect(request, redirect_uri, prompt="select_account")

@app.get("/auth/callback", name="google_callback")
async def google_callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
        profile = token.get("userinfo")
        if not profile:
            profile = await oauth.google.userinfo(token=token)
        if not profile or not profile.get("sub") or not profile.get("email") or profile.get("email_verified") is not True:
            raise HTTPException(400, "Google did not return a verified account email.")
        user = {"id": str(profile["sub"]), "email": profile["email"], "name": profile.get("name", "Learner"), "picture": profile.get("picture", "")}
        with db() as conn:
            conn.execute("INSERT INTO users(id,email,name,picture,created_at,last_login) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,picture=excluded.picture,last_login=excluded.last_login", (user["id"], user["email"], user["name"], user["picture"], date.today().isoformat(), date.today().isoformat()))
        request.session.clear()
        request.session["user"] = user
        return RedirectResponse("/", status_code=303)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Google OAuth callback failed")
        raise HTTPException(400, "Google sign-in failed. Please try again.") from exc

@app.post("/auth/logout")
async def google_logout(request: Request):
    request.session.clear()
    return {"status": "signed_out"}

@app.get("/api/me")
async def get_current_user(request: Request):
    user = request.session.get("user")
    return {"authenticated": bool(user), "user": user or None, "google_login_configured": bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)}
@app.get("/styles.css")
async def css(): return FileResponse(os.path.join(BASE_DIR, "styles.css"), media_type="text/css")
@app.get("/app.js")
async def js(): return FileResponse(os.path.join(BASE_DIR, "app.js"), media_type="application/javascript")
@app.get("/api/health")
async def health(): return {"status":"ok","provider":"openrouter","model":DEFAULT_MODEL,"api_key_configured":bool(API_KEY),"google_login_configured":bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET),"phase":2}
@app.get("/api/languages")
async def languages(): return {k:{"name":v} for k,v in LANGUAGES.items()}

@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request):
    text = payload.utterance.strip()
    if not text: raise HTTPException(400, "Please enter a message.")
    if payload.language not in LANGUAGES: raise HTTPException(400, "Unsupported learning language.")
    level = payload.level if payload.level in LEVELS else "intermediate"
    sid = payload.session_id or str(uuid4())
    state = SESSIONS.setdefault(sid, {"history":[], "errors":[], "turns":[], "user_id":current_user_id(request)})
    if state.get("user_id") != current_user_id(request):
        raise HTTPException(403, "This conversation belongs to another account. Start a new session.")
    messages = [{"role":"system","content":conversation_prompt(LANGUAGES[payload.language], level)}]
    messages.extend(state["history"][-MAX_HISTORY_MESSAGES:])
    messages.append({"role":"user","content":text})
    reply = await run_in_threadpool(call_openrouter, messages, 0.75, 900)
    errors = await run_in_threadpool(analyze_utterance, text, LANGUAGES[payload.language], level)
    state["history"].extend([{"role":"user","content":text},{"role":"assistant","content":reply}])
    state["history"] = state["history"][-MAX_HISTORY_MESSAGES*2:]
    turn_errors = errors or []
    for item in turn_errors:
        item["turn"] = len(state["turns"])+1
        state["errors"].append(item)
    state["turns"].append({"user_utterance":text,"bot_reply":reply,"errors":turn_errors,"analysis_available":errors is not None})
    with db() as conn:
        uid = current_user_id(request)
        conn.execute("INSERT INTO practice_days(user_id,day,minutes,turns) VALUES(?,?,1,1) ON CONFLICT(user_id,day) DO UPDATE SET minutes=minutes+1, turns=turns+1", (uid, date.today().isoformat()))
    return {"session_id":sid,"bot_reply":reply,"errors":turn_errors,"analysis_available":errors is not None,"error_count":len(state["errors"]),"model":DEFAULT_MODEL}

def calculate_language_accuracy(turns: List[dict]) -> Optional[int]:
    """Estimate written-language accuracy from analyzed words, not errors-per-turn.

    Correctly analyzed words contribute to the score. Each word in a detected
    incorrect snippet is counted once per error record; the result is bounded
    between 0 and 100. This is a grammar/spelling accuracy estimate, not a
    complete measure of speaking fluency or pronunciation.
    """
    analyzed_turns = [turn for turn in turns if turn.get("analysis_available", True)]
    if not analyzed_turns:
        return None
    total_words = 0
    incorrect_words = 0
    for turn in analyzed_turns:
        utterance = turn.get("user_utterance", "") or ""
        words = re.findall(r"\b[\w’'-]+\b", utterance, flags=re.UNICODE)
        total_words += len(words)
        for error in turn.get("errors", []) or []:
            snippet = error.get("original_snippet", "") or ""
            incorrect_words += max(1, len(re.findall(r"\b[\w’'-]+\b", snippet, flags=re.UNICODE))) if snippet.strip() else 0
    if total_words == 0:
        return 100
    return max(0, min(100, round((total_words - min(total_words, incorrect_words)) / total_words * 100)))

@app.post("/api/session_summary")
async def session_summary(payload: ResetRequest):
    state = SESSIONS.get(payload.session_id, {"turns":[],"errors":[]})
    score = calculate_language_accuracy(state["turns"])
    return {"turn_count":len(state["turns"]),"error_count":len(state["errors"]),"errors":state["errors"],"turns":state["turns"],"fluency_score":score,"score_basis":"estimated grammar and spelling accuracy across analyzed words"}

@app.post("/api/reset")
async def reset(payload: ResetRequest):
    SESSIONS.pop(payload.session_id, None)
    return {"status":"reset","session_id":payload.session_id}

@app.post("/api/generate_quiz")
async def generate_quiz(payload: QuizRequest):
    if not payload.turns: return {"questions":[]}
    transcript = "\n".join(f"Learner: {t.get('user_utterance','')}" for t in payload.turns[-25:])
    prompt = f'''Create 8 multiple-choice grammar identification questions for a learner of {LANGUAGES.get(payload.language,'the selected language')} at {payload.level} level.
IMPORTANT: Do NOT ask what the learner said, remember, discussed, or answer questions about conversation content. Test grammar concepts that appeared in or are relevant to the language used in the transcript: nouns, pronouns, verbs, tenses, adjectives, adverbs, articles, prepositions, conjunctions, subject-verb agreement, word order, spelling and punctuation. Ask the learner to identify parts of speech, choose grammatical forms, classify words in example sentences, or apply a grammar rule. Use fresh example sentences inspired by the grammatical structures, not trivia about the chat. Vary categories. Four options each. Correct index is zero-based. Return JSON only:
{{"questions":[{{"id":"q1","topic":"Pronouns","question":"...","options":["...","...","...","..."],"correct_option_index":0,"explanation":"..."}}]}}
Learner utterances for selecting relevant grammar scope (not for comprehension questions):
{transcript}'''
    raw = await run_in_threadpool(call_openrouter, [{"role":"system","content":"You are a language grammar examiner. Return valid JSON only and obey the quiz constraints."},{"role":"user","content":prompt}], 0.2, 1800)
    try:
        qs = parse_json(raw).get("questions", [])
        if not isinstance(qs, list) or not qs: raise ValueError("No questions")
        return {"questions":qs[:10]}
    except Exception as exc:
        logger.exception("Quiz JSON parsing failed")
        raise HTTPException(502, "The AI returned an invalid quiz. Please try again.") from exc


class VocabularyRequest(BaseModel):
    language: str = "es"
    word: str = Field(min_length=1, max_length=100)
    meaning: str = Field(default="", max_length=500)
    example: str = Field(default="", max_length=500)

@app.get("/api/vocabulary")
async def get_vocabulary(request: Request, language: str = "es"):
    uid = current_user_id(request)
    with db() as conn:
        rows = conn.execute("SELECT id, word, meaning, example, created_at FROM vocabulary WHERE user_id=? AND language=? ORDER BY id DESC", (uid, language)).fetchall()
    return {"items": [dict(r) for r in rows]}

@app.post("/api/vocabulary")
async def save_vocabulary(payload: VocabularyRequest, request: Request):
    uid = current_user_id(request)
    word = payload.word.strip()
    if not word: raise HTTPException(400, "Word is required")
    with db() as conn:
        conn.execute("INSERT INTO vocabulary(user_id,language, word, meaning, example, created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,language, word) DO UPDATE SET meaning=excluded.meaning, example=excluded.example", (uid, payload.language, word, payload.meaning.strip(), payload.example.strip(), date.today().isoformat()))
        row = conn.execute("SELECT id, word, meaning, example, created_at FROM vocabulary WHERE user_id=? AND language=? AND word=?", (uid, payload.language, word)).fetchone()
    return {"item": dict(row)}

@app.delete("/api/vocabulary/{item_id}")
async def delete_vocabulary(item_id: int, request: Request):
    with db() as conn: conn.execute("DELETE FROM vocabulary WHERE id=? AND user_id=?", (item_id, current_user_id(request)))
    return {"deleted": True}

@app.get("/api/learning_stats")
async def learning_stats(request: Request):
    uid = current_user_id(request)
    with db() as conn:
        rows = conn.execute("SELECT day, minutes, turns FROM practice_days WHERE user_id=? ORDER BY day DESC LIMIT 400", (uid,)).fetchall()
        total_words = conn.execute("SELECT COUNT(*) FROM vocabulary WHERE user_id=?", (uid,)).fetchone()[0]
    days = {r["day"]: dict(r) for r in rows}
    today = date.today()
    cursor = today if today.isoformat() in days else today - timedelta(days=1)
    streak = 0
    while cursor.isoformat() in days:
        streak += 1; cursor -= timedelta(days=1)
    week_start = today - timedelta(days=6)
    week = [r for r in rows if r["day"] >= week_start.isoformat()]
    return {"streak": streak, "practice_days_this_week": len(week), "minutes_this_week": sum(r["minutes"] for r in week), "turns_this_week": sum(r["turns"] for r in week), "saved_words": total_words, "today_practiced": today.isoformat() in days, "daily_goal_minutes": 10}

TOPICS = {
 "es": ["Ordering food at a restaurant", "Planning a weekend trip", "Introducing yourself", "Job interviews", "Daily routines", "Shopping and prices", "Talking about hobbies", "At the airport", "Health and appointments", "Technology in everyday life"],
 "fr": ["Commander au restaurant", "Organiser un voyage", "Se présenter", "Un entretien d'embauche", "La routine quotidienne", "Faire les courses", "Les loisirs", "À l'aéroport", "La santé", "La technologie"],
 "de": ["Im Restaurant bestellen", "Eine Reise planen", "Sich vorstellen", "Vorstellungsgespräche", "Der Alltag", "Einkaufen", "Hobbys", "Am Flughafen", "Gesundheit", "Technologie"],
 "it": ["Ordinare al ristorante", "Organizzare un viaggio", "Presentarsi", "Colloqui di lavoro", "La routine quotidiana", "Fare shopping", "Hobby e tempo libero", "In aeroporto", "Salute", "Tecnologia"],
 "pt": ["Pedir comida", "Planejar uma viagem", "Apresentar-se", "Entrevistas de emprego", "Rotina diária", "Fazer compras", "Passatempos", "No aeroporto", "Saúde", "Tecnologia"],
 "ru": ["В ресторане", "Планирование поездки", "Знакомство", "Собеседование", "Повседневная жизнь", "Покупки", "Хобби", "В аэропорту", "Здоровье", "Технологии"],
 "ja": ["レストランで注文する", "旅行を計画する", "自己紹介", "就職面接", "毎日の習慣", "買い物", "趣味", "空港で", "健康", "テクノロジー"],
 "zh": ["在餐厅点餐", "计划旅行", "自我介绍", "求职面试", "日常生活", "购物", "兴趣爱好", "在机场", "健康", "科技"],
 "hi": ["रेस्तरां में खाना ऑर्डर करना", "यात्रा की योजना", "अपना परिचय", "नौकरी का इंटरव्यू", "दैनिक दिनचर्या", "खरीदारी", "शौक", "हवाई अड्डे पर", "स्वास्थ्य", "तकनीक"],
 "en": ["Ordering at a restaurant", "Planning a weekend trip", "Introducing yourself", "Job interviews", "Daily routines", "Shopping", "Hobbies", "At the airport", "Health appointments", "Everyday technology"]
}

@app.get("/api/topics")
async def get_topics(language: str = "es"):
    return {"topics": TOPICS.get(language, TOPICS["en"])}

class PronunciationRequest(BaseModel):
    target: str = Field(min_length=1, max_length=500)
    transcript: str = Field(min_length=1, max_length=500)
    language: str = "es"

@app.post("/api/pronunciation/check")
async def pronunciation_check(payload: PronunciationRequest):
    import difflib
    normalize = lambda value: re.sub(r"[^\w\s]", "", value.lower()).split()
    expected, spoken = normalize(payload.target), normalize(payload.transcript)
    similarity = difflib.SequenceMatcher(None, expected, spoken).ratio()
    score = round(similarity * 100)
    if score >= 90: feedback = "Excellent match. Your recognized words closely match the target sentence."
    elif score >= 70: feedback = "Good attempt. Practise the highlighted differences and try again."
    else: feedback = "Keep practising. Speak slowly and clearly, then try once more."
    return {"score": score, "feedback": feedback, "expected": payload.target, "recognized": payload.transcript, "metric": "speech-recognition text similarity (not a phoneme-level accent assessment)"}


class VocabularySuggestRequest(BaseModel):
    turns: List[dict] = Field(default_factory=list)
    language: str = "es"
    level: str = "intermediate"

@app.post("/api/vocabulary/suggest")
async def suggest_vocabulary(payload: VocabularySuggestRequest):
    if not payload.turns: return {"suggestions": []}
    transcript = "\n".join((str(t.get("user_utterance", "")) + " " + str(t.get("bot_reply", ""))) for t in payload.turns[-20:])
    lang = LANGUAGES.get(payload.language, "the target language")
    prompt = ("From this conversation, select up to 8 useful vocabulary words or short expressions in " + lang + " that a " + payload.level + " learner may want to learn. Prefer meaningful words, avoid names and very basic function words. For each provide a concise English meaning and a short natural example in the target language. Return JSON only: {\"suggestions\":[{\"word\":\"...\",\"meaning\":\"...\",\"example\":\"...\"}]}\nConversation:\n" + transcript)
    raw = await run_in_threadpool(call_openrouter, [{"role":"system","content":"You are a multilingual vocabulary tutor. Return valid JSON only."},{"role":"user","content":prompt}], 0.2, 1200)
    try: return {"suggestions": parse_json(raw).get("suggestions", [])[:8]}
    except Exception as exc: raise HTTPException(502, "Could not extract vocabulary. Please try again.") from exc
