/**
 * LinguaVerse Universal Multilingual AI Application — Client Engine
 */

document.addEventListener('DOMContentLoaded', () => {
    // Session State
    const session = {
        language: 'es',
        level: 'intermediate',
        sessionId: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `lv-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        inputMode: 'text', // 'text' | 'voice'
        active: false,
        startTime: Date.now(),
        turns: [],
        errors: [],
        speechRecognition: null,
        isRecording: false
    };

    // DOM Elements
    const languageSelect = document.getElementById('languageSelect');
    const levelSelect = document.getElementById('levelSelect');
    const btnModeText = document.getElementById('btnModeText');
    const btnModeVoice = document.getElementById('btnModeVoice');
    const btnEndSession = document.getElementById('btnEndSession');

    // Screens
    const screenConversation = document.getElementById('screen-conversation');
    const screenSummary = document.getElementById('screen-summary');
    const screenQuiz = document.getElementById('screen-quiz');

    // Conversation Pane Elements
    const partnerFlag = document.getElementById('partnerFlag');
    const partnerName = document.getElementById('partnerName');
    const initialGreeting = document.getElementById('initialGreeting');
    const chatTimeline = document.getElementById('chatTimeline');
    const sidecardFeed = document.getElementById('sidecardFeed');
    const utteranceForm = document.getElementById('utteranceForm');
    const utteranceInput = document.getElementById('utteranceInput');
    const btnSubmitTurn = document.getElementById('btnSubmitTurn');
    const btnMicTrigger = document.getElementById('btnMicTrigger');
    const voiceVisualizer = document.getElementById('voiceVisualizer');
    const voiceStatusText = document.getElementById('voiceStatusText');

    // Summary Elements
    const summaryDuration = document.getElementById('summaryDuration');
    const summaryTurns = document.getElementById('summaryTurns');
    const summaryErrors = document.getElementById('summaryErrors');
    const summaryAccuracy = document.getElementById('summaryAccuracy');
    const summaryErrorsList = document.getElementById('summaryErrorsList');
    const btnStartQuiz = document.getElementById('btnStartQuiz');
    const btnNewSession = document.getElementById('btnNewSession');

    // Quiz Elements
    const quizScoreBadge = document.getElementById('quizScoreBadge');
    const quizQuestionsList = document.getElementById('quizQuestionsList');
    const btnSubmitQuiz = document.getElementById('btnSubmitQuiz');
    const btnBackToSummary = document.getElementById('btnBackToSummary');

    // Supported Languages Metadata
    const languages = {
        es: { name: "Spanish", flag: "🇪🇸", greeting: "¡Hola! ¿Cómo estás hoy? ¿De qué te gustaría hablar en nuestra sesión?", langTag: "es-ES" },
        fr: { name: "French", flag: "🇫🇷", greeting: "Bonjour! Comment allez-vous aujourd'hui? De quoi aimeriez-vous parler?", langTag: "fr-FR" },
        de: { name: "German", flag: "🇩🇪", greeting: "Hallo! Wie geht es Ihnen heute? Worüber möchten Sie sprechen?", langTag: "de-DE" },
        it: { name: "Italian", flag: "🇮🇹", greeting: "Ciao! Come stai oggi? Di cosa vorresti parlare?", langTag: "it-IT" },
        pt: { name: "Portuguese", flag: "🇧🇷", greeting: "Olá! Como você está hoje? Sobre o que gostaria de falar?", langTag: "pt-BR" },
        ru: { name: "Russian", flag: "🇷🇺", greeting: "Привет! Как ваши дела сегодня? О чем бы вы хотели поговорить?", langTag: "ru-RU" },
        ja: { name: "Japanese", flag: "🇯🇵", greeting: "こんにちは！今日はどのようなことについて話しましょうか？", langTag: "ja-JP" },
        zh: { name: "Mandarin", flag: "🇨🇳", greeting: "你好！你今天过得怎么样？你想聊些什么呢？", langTag: "zh-CN" },
        hi: { name: "Hindi", flag: "🇮🇳", greeting: "नमस्ते! आज आप कैसे हैं? आप किस विषय पर बात करना चाहेंगे?", langTag: "hi-IN" },
        en: { name: "English", flag: "🇬🇧", greeting: "Hello! How are you doing today? What would you like to talk about?", langTag: "en-US" }
    };

    // Initialize Application
    init();

    function init() {
        setupSpeechRecognition();
        bindEvents();
        updateLanguageUI(session.language);
        document.getElementById('btnBeginLearning').addEventListener('click', beginLearning);
        bindLearningHub();
        initializeAccount();
        document.getElementById('onboardingLanguage').value = session.language;
        document.getElementById('onboardingLevel').value = session.level;
    }

    async function initializeAccount() {
        const loginButton = document.getElementById('btnGoogleLogin');
        const userBox = document.getElementById('accountUser');
        const nameBox = document.getElementById('accountName');
        const avatar = document.getElementById('accountAvatar');
        try {
            const response = await fetch('/api/me');
            const data = await response.json();
            if (data.authenticated && data.user) {
                loginButton.hidden = true;
                userBox.hidden = false;
                nameBox.textContent = data.user.name || data.user.email;
                if (data.user.picture) { avatar.src = data.user.picture; avatar.hidden = false; }
                else { avatar.hidden = true; }
            } else {
                loginButton.hidden = false;
                userBox.hidden = true;
                loginButton.onclick = () => {
                    if (!data.google_login_configured) {
                        alert('Google login is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file. See README.md for setup instructions.');
                        return;
                    }
                    window.location.href = '/auth/login';
                };
            }
        } catch (error) {
            loginButton.hidden = false;
            loginButton.title = 'Account service unavailable';
        }
        document.getElementById('btnSignOut').addEventListener('click', async () => {
            try { await fetch('/auth/logout', {method:'POST'}); window.location.reload(); }
            catch (error) { alert('Could not sign out. Please try again.'); }
        });
    }

    function beginLearning() {
        session.language = document.getElementById('onboardingLanguage').value;
        session.level = document.getElementById('onboardingLevel').value;
        languageSelect.value = session.language;
        levelSelect.value = session.level;
        session.active = true;
        session.startTime = Date.now();
        updateLanguageUI(session.language);
        document.getElementById('onboardingOverlay').style.display = 'none';
    }

    function bindEvents() {
        // Language Selector
        languageSelect.addEventListener('change', (e) => {
            session.language = e.target.value;
            updateLanguageUI(session.language);
        });

        levelSelect.addEventListener('change', (e) => { session.level = e.target.value; });

        // Mode Toggle Buttons
        btnModeText.addEventListener('click', () => setInputMode('text'));
        btnModeVoice.addEventListener('click', () => setInputMode('voice'));

        // Form Submission
        utteranceForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = utteranceInput.value.trim();
            if (text) {
                processUserTurn(text);
                utteranceInput.value = '';
            }
        });

        // Mic Button
        btnMicTrigger.addEventListener('click', toggleSpeechRecording);

        // End Session Button
        btnEndSession.addEventListener('click', endSessionAndShowSummary);

        // Summary Actions
        btnStartQuiz.addEventListener('click', generateAndShowQuiz);
        btnNewSession.addEventListener('click', resetSession);

        // Quiz Actions
        btnSubmitQuiz.addEventListener('click', evaluateQuizAnswers);
        btnBackToSummary.addEventListener('click', () => showScreen(screenSummary));
    }

    function setInputMode(mode) {
        session.inputMode = mode;
        if (mode === 'text') {
            btnModeText.classList.add('active');
            btnModeVoice.classList.remove('active');
            voiceVisualizer.style.display = 'none';
        } else {
            btnModeVoice.classList.add('active');
            btnModeText.classList.remove('active');
            voiceVisualizer.style.display = 'flex';
            voiceStatusText.textContent = 'Voice Mode active. Speak or click microphone icon.';
        }
    }

    function updateLanguageUI(code) {
        const info = languages[code] || languages.es;
        partnerFlag.textContent = info.flag;
        partnerName.textContent = `LinguaPartner (${info.name})`;
        initialGreeting.textContent = info.greeting;
        utteranceInput.placeholder = `Type or speak in ${info.name}...`;
    }

    // Speech-to-Text Setup
    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            session.speechRecognition = new SpeechRecognition();
            session.speechRecognition.continuous = false;
            session.speechRecognition.interimResults = false;

            session.speechRecognition.onstart = () => {
                session.isRecording = true;
                btnMicTrigger.classList.add('recording');
                voiceStatusText.textContent = '🎙️ Listening to your speech... Speak now!';
            };

            session.speechRecognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                utteranceInput.value = transcript;
                processUserTurn(transcript);
                utteranceInput.value = '';
            };

            session.speechRecognition.onerror = (event) => {
                console.warn('Speech recognition error:', event.error);
                stopSpeechRecording();
            };

            session.speechRecognition.onend = () => {
                stopSpeechRecording();
            };
        }
    }

    function toggleSpeechRecording() {
        if (!session.speechRecognition) {
            alert('Speech recognition is supported natively in Chrome, Edge, and Safari. Please use text input or open in Chrome.');
            return;
        }
        if (session.isRecording) {
            session.speechRecognition.stop();
        } else {
            const info = languages[session.language] || languages.es;
            session.speechRecognition.lang = info.langTag;
            session.speechRecognition.start();
        }
    }

    function stopSpeechRecording() {
        session.isRecording = false;
        btnMicTrigger.classList.remove('recording');
        voiceStatusText.textContent = 'Voice Mode active. Speak or click microphone icon.';
    }

    // Text-to-Speech Output
    function speakText(text, langCode) {
        if (!('speechSynthesis' in window)) return;
        const info = languages[langCode] || languages.es;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = info.langTag;
        utterance.rate = 0.95;
        window.speechSynthesis.speak(utterance);
    }

    // Phase 1: OpenRouter-powered conversation. Session history is maintained by the backend.
    async function processUserTurn(text) {
        if (!session.active) return;
        appendChatBubble('You', text, 'user-bubble');
        btnSubmitTurn.disabled = true;
        btnSubmitTurn.dataset.originalLabel = btnSubmitTurn.innerHTML;
        btnSubmitTurn.textContent = 'Thinking...';

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    utterance: text,
                    language: session.language,
                    level: session.level,
                    session_id: session.sessionId
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || data.error || 'The AI request failed.');
            if (data.session_id) session.sessionId = data.session_id;
            handleTurnResult(text, data);
        } catch (err) {
            appendChatBubble('LinguaVerse', `Unable to get an AI response: ${err.message}. Check the backend, .env API key, model name, and internet connection, then try again.`, 'partner-bubble');
        } finally {
            btnSubmitTurn.disabled = false;
            btnSubmitTurn.innerHTML = btnSubmitTurn.dataset.originalLabel || 'Send';
        }
    }

    function handleTurnResult(originalText, data) {
        appendChatBubble('LinguaPartner', data.bot_reply, 'partner-bubble');
        if (session.inputMode === 'voice') speakText(data.bot_reply, session.language);
        session.turns.push({ user_utterance: originalText, bot_reply: data.bot_reply, timestamp: new Date().toLocaleTimeString() });
        (data.errors || []).forEach(details => {
            const errorRecord = { error_details: details };
            session.errors.push(errorRecord);
            appendSidecardError(details);
        });
        if (data.analysis_available === false) {
            appendAnalysisNotice('Grammar analysis was unavailable for this turn. Your conversation continued, but this turn was not included in the mistake count.');
        }
    }

    function appendAnalysisNotice(message) {
        const note = document.createElement('div');
        note.className = 'sidecard-card';
        note.textContent = message;
        sidecardFeed.prepend(note);
    }

    function handleTurnResultFallback(originalText) {
        const fallbackReply = "¡Entendido! Me parece muy interesante lo que dices. ¿Qué más hiciste hoy?";
        appendChatBubble('LinguaPartner', fallbackReply, 'partner-bubble');
        if (session.inputMode === 'voice') {
            speakText(fallbackReply, session.language);
        }

        session.turns.push({
            user_utterance: originalText,
            bot_reply: fallbackReply,
            timestamp: new Date().toLocaleTimeString()
        });
    }

    function appendChatBubble(sender, text, cssClass) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${cssClass}`;
        bubble.innerHTML = `
            <div class="bubble-sender">${escapeHtml(sender)}</div>
            <div class="bubble-text">${escapeHtml(text)}</div>
        `;
        chatTimeline.appendChild(bubble);
        chatTimeline.scrollTop = chatTimeline.scrollHeight;
    }

    function appendSidecardError(details) {
        // Remove empty state placeholder if present
        const emptyState = sidecardFeed.querySelector('.empty-feed-state');
        if (emptyState) emptyState.remove();

        const card = document.createElement('div');
        card.className = 'sidecard-card';
        card.innerHTML = `
            <div class="sidecard-card-header">
                <span class="err-badge">Live Correction</span>
                <span class="err-type">${escapeHtml(details.error_type)}</span>
            </div>
            <div class="sidecard-before-after">
                <div><span style="color:#EF4444; font-weight:700;">❌ Your Utterance:</span> "${escapeHtml(details.original_snippet)}"</div>
                <div><span style="color:#10B981; font-weight:700;">✅ Suggested Form:</span> "${escapeHtml(details.corrected_snippet)}"</div>
            </div>
            <div class="sidecard-rule">
                💡 <strong>Grammar explanation:</strong> ${escapeHtml(details.rule_explanation)}
            </div>
        `;
        sidecardFeed.prepend(card); // Show newest errors at top
    }

    // End Session & Render Summary Screen
    async function endSessionAndShowSummary() {
        session.active = false;
        let allErrors = session.errors.slice();
        let serverFluencyScore = null;
        try {
            const response = await fetch('/api/session_summary', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({session_id:session.sessionId}) });
            if (response.ok) {
                const summary = await response.json();
                allErrors = (summary.errors || []).map(e => ({error_details:e}));
                session.errors = allErrors;
                serverFluencyScore = summary.fluency_score;
            }
        } catch (e) { console.warn('Could not retrieve server-side session summary', e); }
        const durationSeconds = Math.round((Date.now() - session.startTime) / 1000);
        summaryDuration.textContent = `${String(Math.floor(durationSeconds / 60)).padStart(2,'0')}:${String(durationSeconds % 60).padStart(2,'0')}`;
        summaryTurns.textContent = session.turns.length;
        summaryErrors.textContent = allErrors.length;
        // Prefer the backend's word-weighted grammar/spelling accuracy score.
        // Unlike errors-per-message, this rewards correct words and sentences.
        summaryAccuracy.textContent = serverFluencyScore === null
            ? 'N/A'
            : `${serverFluencyScore}%`;
        summaryErrorsList.innerHTML = '';
        if (!allErrors.length) {
            summaryErrorsList.innerHTML = '<div style="text-align:center;padding:30px;color:#9CA3AF">No mistakes were recorded. If you expected corrections, check whether grammar analysis was available during the session.</div>';
        } else {
            allErrors.forEach((err, idx) => {
                const d = err.error_details || {};
                const item = document.createElement('div'); item.className = 'summary-error-item';
                item.innerHTML = `<div style="font-weight:700;color:#EF4444;font-size:.85rem">Mistake #${idx+1} — ${escapeHtml(d.error_type || d.category || 'Language error')}</div><div style="font-size:.9rem;line-height:1.5"><p><strong>Original:</strong> "${escapeHtml(d.original_snippet || '')}"</p><p style="color:#10B981"><strong>Recommended:</strong> "${escapeHtml(d.corrected_snippet || '')}"</p><p style="color:#06B6D4;font-size:.8rem;margin-top:4px"><strong>Rule:</strong> ${escapeHtml(d.rule_explanation || '')}</p></div>`;
                summaryErrorsList.appendChild(item);
            });
        }
        showScreen(screenSummary);
    }

    // Generate & Show Dynamic Session AI Quiz
    async function generateAndShowQuiz() {
        quizQuestionsList.innerHTML = '<div style="text-align:center; padding:40px; color:#9CA3AF;">Building a grammar quiz from the language structures used in your session...</div>';
        showScreen(screenQuiz);

        try {
            const res = await fetch('/api/generate_quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    errors: session.errors,
                    turns: session.turns,
                    language: session.language,
                    level: session.level
                })
            });

            if (res.ok) {
                const data = await res.json();
                renderQuizQuestions(data.questions);
            } else {
                renderQuizFallback();
            }
        } catch (err) {
            renderQuizFallback();
        }
    }

    function renderQuizQuestions(questions) {
        quizQuestionsList.innerHTML = '';
        quizScoreBadge.textContent = `Score: 0 / ${questions.length}`;

        questions.forEach((q, qIdx) => {
            const card = document.createElement('div');
            card.className = 'quiz-card';
            card.dataset.questionId = q.id;
            card.dataset.correctIndex = q.correct_option_index;

            const optionsHtml = q.options.map((opt, oIdx) => `
                <button type="button" class="quiz-option-btn" data-opt-idx="${oIdx}">
                    ${escapeHtml(opt)}
                </button>
            `).join('');

            card.innerHTML = `
                <div class="quiz-q-title">Question ${qIdx + 1}: ${escapeHtml(q.question)}</div>
                <div class="quiz-options-group">${optionsHtml}</div>
                <div class="quiz-explanation" style="display:none; font-size:0.82rem; color:#06B6D4; background:rgba(6,182,212,0.1); padding:10px; border-radius:6px;">
                    💡 <strong>Explanation:</strong> ${escapeHtml(q.explanation)}
                </div>
            `;

            // Option selection handlers
            const optBtns = card.querySelectorAll('.quiz-option-btn');
            optBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    optBtns.forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                });
            });

            quizQuestionsList.appendChild(card);
        });
    }

    function renderQuizFallback() {
        const fallbackQ = [{
            id: 'q1',
            question: 'Which verb form correctly completes completed past actions in Spanish? "Ayer, yo _____ (ir) a la biblioteca."',
            options: ['A) fui', 'B) ir', 'C) vaya'],
            correct_option_index: 0,
            explanation: 'ChromaDB Grounded Rule: Pretérito Indefinito requires simple past form "fui" for first-person completed action.'
        }];
        renderQuizQuestions(fallbackQ);
    }

    function evaluateQuizAnswers() {
        const cards = quizQuestionsList.querySelectorAll('.quiz-card');
        let correctCount = 0;

        cards.forEach(card => {
            const correctIdx = parseInt(card.dataset.correctIndex);
            const selectedBtn = card.querySelector('.quiz-option-btn.selected');
            const expDiv = card.querySelector('.quiz-explanation');

            if (expDiv) expDiv.style.display = 'block';

            if (selectedBtn) {
                const selectedIdx = parseInt(selectedBtn.dataset.optIdx);
                if (selectedIdx === correctIdx) {
                    selectedBtn.classList.add('correct');
                    correctCount++;
                } else {
                    selectedBtn.classList.add('incorrect');
                    // Highlight correct option
                    const correctBtn = card.querySelector(`.quiz-option-btn[data-opt-idx="${correctIdx}"]`);
                    if (correctBtn) correctBtn.classList.add('correct');
                }
            } else {
                // User skipped option, show correct answer
                const correctBtn = card.querySelector(`.quiz-option-btn[data-opt-idx="${correctIdx}"]`);
                if (correctBtn) correctBtn.classList.add('correct');
            }
        });

        quizScoreBadge.textContent = `Score: ${correctCount} / ${cards.length}`;
        alert(`Quiz Completed! Your Score: ${correctCount} out of ${cards.length}`);
    }

    async function resetSession() {
        const previousSessionId = session.sessionId;
        session.sessionId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `lv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        try {
            await fetch('/api/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: previousSessionId })
            });
        } catch (err) {
            console.warn('Could not clear previous server session:', err);
        }
        session.startTime = Date.now();
        session.turns = [];
        session.errors = [];
        session.active = true;
        document.getElementById('onboardingOverlay').style.display = 'none';

        // Reset Timeline
        chatTimeline.innerHTML = `
            <div class="chat-bubble partner-bubble">
                <div class="bubble-sender">LinguaPartner</div>
                <div class="bubble-text" id="initialGreeting">${escapeHtml(languages[session.language].greeting)}</div>
            </div>
        `;

        // Reset Sidecard
        sidecardFeed.innerHTML = `
            <div class="empty-feed-state">
                <div class="empty-icon">💡</div>
                <h4>Conversation Flows Uninterrupted</h4>
                <p>As you speak or type, Stream 2 detects grammar mistakes and displays corrections in real time without stopping your conversation.</p>
            </div>
        `;

        showScreen(screenConversation);
    }

    function showScreen(targetScreen) {
        [screenConversation, screenSummary, screenQuiz].forEach(s => s.classList.remove('active'));
        targetScreen.classList.add('active');
    }


    function bindLearningHub() {
        const overlay = document.getElementById('premiumOverlay');
        document.getElementById('btnPremiumHub').addEventListener('click', () => { overlay.classList.add('open'); overlay.setAttribute('aria-hidden','false'); loadVocabulary(); loadStats(); loadTopics(); });
        document.getElementById('btnCloseHub').addEventListener('click', closeLearningHub);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeLearningHub(); });
        document.querySelectorAll('.hub-tab').forEach(tab => tab.addEventListener('click', () => {
            document.querySelectorAll('.hub-tab').forEach(x => x.classList.toggle('active', x === tab));
            document.querySelectorAll('.hub-section').forEach(x => x.classList.toggle('active', x.id === `hub-${tab.dataset.hub}`));
        }));
        document.getElementById('vocabForm').addEventListener('submit', async e => {
            e.preventDefault();
            await saveVocabulary({word:document.getElementById('vocabWord').value, meaning:document.getElementById('vocabMeaning').value, example:document.getElementById('vocabExample').value});
            e.target.reset();
        });
        document.getElementById('btnExtractWords').addEventListener('click', extractVocabulary);
        document.getElementById('btnHearTarget').addEventListener('click', () => speakText(document.getElementById('pronunciationTarget').value, session.language));
        document.getElementById('btnRecordPronunciation').addEventListener('click', recordPronunciation);
    }

    function closeLearningHub() {
        const overlay = document.getElementById('premiumOverlay'); overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true');
    }

    async function loadVocabulary() {
        const holder = document.getElementById('flashcardList'); holder.innerHTML = '<p class="hub-status">Loading saved words…</p>';
        try {
            const res = await fetch(`/api/vocabulary?language=${encodeURIComponent(session.language)}`); const data = await res.json();
            holder.innerHTML = '';
            if (!data.items.length) { holder.innerHTML = '<p class="hub-status">No flashcards yet. Save a word manually or find vocabulary from your chat.</p>'; return; }
            data.items.forEach(item => {
                const card = document.createElement('button'); card.type = 'button'; card.className = 'flashcard';
                card.innerHTML = `<span class="flashcard-label">TAP TO REVEAL</span><strong>${escapeHtml(item.word)}</strong><span class="flashcard-back">${escapeHtml(item.meaning || 'Meaning not added')}<br><small>${escapeHtml(item.example || '')}</small></span><span class="flashcard-delete" title="Delete">✕</span>`;
                card.addEventListener('click', e => { if (e.target.classList.contains('flashcard-delete')) { e.stopPropagation(); deleteVocabulary(item.id); } else card.classList.toggle('revealed'); });
                holder.appendChild(card);
            });
        } catch (e) { holder.innerHTML = '<p class="hub-status">Could not load flashcards. Check that the server is running.</p>'; }
    }

    async function saveVocabulary(item) {
        try {
            const res = await fetch('/api/vocabulary', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item, language:session.language})});
            if (!res.ok) throw new Error((await res.json()).detail || 'Could not save word');
            await loadVocabulary();
        } catch (e) { alert(e.message); }
    }

    async function deleteVocabulary(id) {
        try { await fetch(`/api/vocabulary/${id}`, {method:'DELETE'}); await loadVocabulary(); } catch(e) { alert('Could not delete this flashcard.'); }
    }

    async function extractVocabulary() {
        const box = document.getElementById('vocabSuggestions');
        if (!session.turns.length) { box.innerHTML = '<p class="hub-status">Have a conversation first, then find useful words here.</p>'; return; }
        box.innerHTML = '<p class="hub-status">Finding useful vocabulary from your conversation…</p>';
        try {
            const res = await fetch('/api/vocabulary/suggest', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({turns:session.turns,language:session.language,level:session.level})});
            const data = await res.json(); if (!res.ok) throw new Error(data.detail || 'Vocabulary extraction failed');
            box.innerHTML = '';
            if (!data.suggestions.length) { box.textContent = 'No additional vocabulary found in this conversation.'; return; }
            data.suggestions.forEach(item => {
                const row = document.createElement('div'); row.className = 'suggested-word';
                row.innerHTML = `<div><strong>${escapeHtml(item.word)}</strong><span>${escapeHtml(item.meaning)}</span><small>${escapeHtml(item.example)}</small></div><button class="btn btn-secondary">＋ Save</button>`;
                row.querySelector('button').addEventListener('click', async () => { await saveVocabulary(item); row.querySelector('button').textContent = '✓ Saved'; row.querySelector('button').disabled = true; }); box.appendChild(row);
            });
        } catch(e) { box.innerHTML = `<p class="hub-status">${escapeHtml(e.message)}</p>`; }
    }

    async function loadStats() {
        const holder = document.getElementById('streakStats');
        try {
            const res = await fetch('/api/learning_stats'); const d = await res.json();
            holder.innerHTML = `<div class="streak-big"><strong>🔥 ${d.streak}</strong><span>day streak</span></div><div class="streak-metrics"><div><strong>${d.practice_days_this_week}/7</strong><span>practice days this week</span></div><div><strong>${d.turns_this_week}</strong><span>messages this week</span></div><div><strong>${d.saved_words}</strong><span>saved vocabulary words</span></div></div><div class="week-dots">${['M','T','W','T','F','S','S'].map((day,i)=>`<span class="${d.today_practiced && i === ((new Date().getDay()+6)%7) ? 'done' : ''}">${day}</span>`).join('')}</div>`;
        } catch(e) { holder.textContent = 'Could not load learning statistics.'; }
    }

    async function loadTopics() {
        const holder = document.getElementById('topicGrid'); holder.innerHTML = '<p class="hub-status">Loading topics…</p>';
        try {
            const res = await fetch(`/api/topics?language=${encodeURIComponent(session.language)}`); const data = await res.json(); holder.innerHTML = '';
            data.topics.forEach((topic,i) => { const b=document.createElement('button'); b.className='topic-card'; b.innerHTML=`<span>${['✈️','🍽️','👋','💼','🏡','🛍️','🎨','🧳','🩺','💻'][i%10]}</span><strong>${escapeHtml(topic)}</strong><small>Start a conversation →</small>`; b.addEventListener('click',()=>{ closeLearningHub(); showScreen(screenConversation); processUserTurn(`Let's practise a conversation about: ${topic}. Please start by asking me a natural question.`); }); holder.appendChild(b); });
        } catch(e) { holder.textContent = 'Could not load conversation topics.'; }
    }

    function recordPronunciation() {
        const target = document.getElementById('pronunciationTarget').value.trim(); const status = document.getElementById('pronunciationStatus'); const result = document.getElementById('pronunciationResult');
        if (!target) { status.textContent = 'Enter a target sentence first.'; return; }
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) { status.textContent = 'Speech recognition is not supported in this browser. Try the latest version of Chrome.'; return; }
        const recognition = new Recognition(); recognition.lang = (languages[session.language] || languages.es).langTag; recognition.interimResults = false; recognition.maxAlternatives = 1;
        status.textContent = 'Listening… speak the sentence now.'; result.innerHTML = '';
        recognition.onresult = async event => {
            const transcript = event.results[0][0].transcript; status.textContent = `Recognized: “${transcript}”`;
            try {
                const res = await fetch('/api/pronunciation/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,transcript,language:session.language})}); const data = await res.json();
                result.innerHTML = `<div class="pron-score"><strong>${data.score}%</strong><span>speech text-match score</span></div><p>${escapeHtml(data.feedback)}</p><p><b>Expected:</b> ${escapeHtml(data.expected)}</p><p><b>Recognized:</b> ${escapeHtml(data.recognized)}</p>`;
            } catch(e) { status.textContent = 'Could not evaluate this attempt. Please try again.'; }
        };
        recognition.onerror = event => { status.textContent = `Microphone error: ${event.error}. Check browser microphone permission.`; };
        recognition.onend = () => { if (status.textContent.startsWith('Listening')) status.textContent = 'No speech was detected. Please try again.'; };
        try { recognition.start(); } catch(e) { status.textContent = 'Could not start microphone. Try again.'; }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
});
