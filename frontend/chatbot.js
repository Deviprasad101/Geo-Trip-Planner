(function() {
    if (window.geotripFeatureEnabled && !window.geotripFeatureEnabled('chatbot')) {
        return;
    }

    // Inject CSS
    const style = document.createElement('style');
    style.innerHTML = `
        .gt-chatbot-btn {
            position: fixed;
            bottom: 150px;
            right: 24px;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, #d4af37, #735c00);
            color: #ffffff;
            border: none;
            box-shadow: 0 4px 15px rgba(115, 92, 0, 0.35);
            cursor: pointer;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .gt-chatbot-btn:hover {
            transform: scale(1.05);
            box-shadow: 0 6px 20px rgba(115, 92, 0, 0.45);
        }
        .gt-chatbot-btn .material-symbols-outlined {
            font-size: 30px;
        }
        .gt-chatbot-window {
            position: fixed;
            bottom: 220px;
            right: 24px;
            width: 420px;
            max-height: 750px;
            background: #ffffff;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(212, 175, 55, 0.45);
            display: flex;
            flex-direction: column;
            z-index: 9999;
            opacity: 0;
            pointer-events: none;
            transform: translateY(20px);
            transition: all 0.3s ease;
            overflow: hidden;
            font-family: "Public Sans", system-ui, sans-serif;
        }
        .gt-chatbot-window.is-open {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
        }
        .gt-chatbot-header {
            background: linear-gradient(135deg, #d4af37, #735c00);
            color: #ffffff;
            padding: 20px;
            font-weight: 700;
            font-size: 1.3rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .gt-chatbot-header button {
            background: transparent;
            border: none;
            color: #ffffff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .gt-chatbot-body {
            padding: 20px;
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 14px;
            background: #f9f9fc;
            height: 500px;
        }
        .gt-chat-msg {
            max-width: 85%;
            padding: 12px 16px;
            border-radius: 12px;
            font-size: 1.05rem;
            line-height: 1.45;
        }
        .gt-chat-msg.bot {
            background: #ffffff;
            color: #1a1c1e;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            border: 1px solid #e2e2e5;
        }
        .gt-chat-msg.user {
            background: linear-gradient(135deg, #fffefb, #fff4d6);
            color: #554300;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
            border: 1px solid #e5cf8a;
        }
        .gt-chat-msg.bot a {
            color: #735c00;
            text-decoration: underline;
            font-weight: 600;
        }
        .gt-chat-msg--thinking {
            opacity: 0.75;
            font-style: italic;
        }
        .gt-chatbot-options {
            padding: 16px;
            background: #ffffff;
            border-top: 1px solid #e2e2e5;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-height: 220px;
            overflow-y: auto;
            transition: max-height 0.25s ease, opacity 0.25s ease, padding 0.25s ease;
        }
        .gt-chatbot-options.is-hidden {
            display: none !important;
        }
        .gt-chatbot-body.is-ollama-mode {
            min-height: 420px;
            height: auto;
            flex: 1 1 auto;
        }
        .gt-chatbot-option-btn {
            background: #ffffff;
            border: 1px solid #d4af37;
            color: #554300;
            padding: 10px 14px;
            border-radius: 20px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            text-align: left;
            transition: all 0.2s;
            font-family: inherit;
        }
        .gt-chatbot-option-btn:hover {
            background: #fffefb;
        }
        .gt-chatbot-cat-title {
            font-size: 0.85rem;
            font-weight: 700;
            color: #735c00;
            margin-top: 10px;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .gt-chatbot-quick-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
            padding-bottom: 12px;
            border-bottom: 1px dashed rgba(212, 175, 55, 0.55);
        }
        .gt-chatbot-quick-btn {
            background: linear-gradient(135deg, #ffffff, #fff8e6);
            border: 1px solid #d4af37;
            color: #554300;
            padding: 8px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            text-align: center;
            transition: all 0.2s;
            font-family: inherit;
        }
        .gt-chatbot-quick-btn:hover {
            background: #ffe088;
            transform: translateY(-1px);
        }
        .gt-chatbot-ollama-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: #f9f9fc;
            border-top: 1px solid #e2e2e5;
            font-size: 0.8rem;
            color: #4d4635;
            cursor: pointer;
            user-select: none;
        }
        .gt-chatbot-ollama-toggle input {
            width: 16px;
            height: 16px;
            accent-color: #735c00;
            cursor: pointer;
            flex-shrink: 0;
        }
        .gt-chatbot-ollama-toggle span.gt-chatbot-ollama-label {
            font-weight: 600;
            color: #554300;
        }
        .gt-chatbot-ollama-toggle.is-on {
            background: linear-gradient(180deg, #fffbeb, #fff4d6);
            border-top-color: #e5cf8a;
        }
        .gt-chatbot-provider-wrap {
            display: none;
            padding: 0 12px 8px;
            font-size: 0.72rem;
            color: #554300;
            background: linear-gradient(180deg, #fff4d6, #fffbeb);
            border-top: 1px solid #f3e8c0;
        }
        .gt-chatbot-provider-wrap.is-visible {
            display: block;
        }
        .gt-chatbot-provider-wrap select {
            width: 100%;
            margin-top: 4px;
            padding: 6px 8px;
            border-radius: 8px;
            border: 1px solid #d0c5af;
            font-size: 0.75rem;
            background: #fff;
            font-family: inherit;
        }
        .gt-chatbot-input-area {
            display: flex;
            padding: 12px;
            background: #ffffff;
            border-top: 1px solid #e2e2e5;
            gap: 8px;
        }
        .gt-chatbot-input-area input {
            flex: 1;
            padding: 10px 14px;
            border: 1px solid #d0c5af;
            border-radius: 20px;
            outline: none;
            font-family: inherit;
            font-size: 0.95rem;
        }
        .gt-chatbot-input-area input:focus {
            border-color: #735c00;
        }
        .gt-chatbot-input-area button {
            background: linear-gradient(135deg, #d4af37, #735c00);
            color: #ffffff;
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .gt-chatbot-input-area button:hover {
            transform: scale(1.05);
        }
        .gt-chatbot-action-btn {
            display: inline-block;
            margin: 4px 4px 0 0;
            padding: 4px 10px;
            font-size: 0.72rem;
            font-weight: 700;
            border-radius: 999px;
            border: 1px solid #e5cf8a;
            background: #fffbeb;
            color: #735c00;
            cursor: pointer;
        }
        .gt-chatbot-action-btn:hover { background: #ffe088; }
        @media (max-width: 480px) {
            .gt-chatbot-window {
                width: calc(100% - 48px);
            }
        }
    `;
    document.head.appendChild(style);

    const faqData = [
        {
            category: "Basic / General",
            items: [
                { q: "Hello / Hi", a: "Hello! Welcome to GeoTrip Planner. I am here to help you plan your Tirupati trip efficiently." },
                { q: "What can you do?", a: "I can help you explore tour packages, plan trips on the GeoTrip map dashboard, and guide you to official booking portals." },
                { q: "How does this app work?", a: "GeoTrip Planner combines an interactive map on the dashboard, curated trip packages, and official booking links for a complete Tirupati experience." }
            ]
        },
        {
            category: "Trip Planning",
            items: [
                { q: "How do I plan a trip?", a: "Open the <a href='/dashboard'>GeoTrip dashboard</a>, pick a theme, set your outing details, and use <strong>Show map</strong> to explore temples, food, and sights." },
                { q: "Suggest places to visit", a: "Tirupati offers the main Sri Venkateswara Temple, ISKCON, Talakona Waterfalls, and SV Zoological Park. Check the <a href='packages.html'>Packages</a> page for curated lists!" },
                { q: "Show nearby attractions", a: "You can find nearby attractions on the <a href='/dashboard'>dashboard map</a> by choosing a category and tapping map pins." },
                { q: "How to create itinerary?", a: "Use <a href='packages.html'>Trip packages</a> to build a routed itinerary with QR sharing, or explore stops on the <a href='/dashboard'>dashboard map</a>." }
            ]
        },
        {
            category: "Trip budget",
            items: [
                { q: "How to split expenses?", a: "Choose a <a href='packages.html'>trip package</a> tier that matches your group size and budget range, then plan stops on the map from the dashboard." },
                { q: "Add members to trip", a: "On <a href='packages.html'>Packages</a>, set the number of travellers when building your trip before applying the route to the map." },
                { q: "Calculate total budget", a: "Each package tier shows a budget range (Basic through Elite). Pick the tier that fits your group on the <a href='packages.html'>Packages</a> page." },
                { q: "Who owes how much?", a: "Package pricing is shown per tier for your group size. Divide the quoted range by the number of travellers for a rough per-person estimate." }
            ]
        },
        {
            category: "Booking",
            items: [
                { q: "How to book bus/train/cab?", a: "Go to the <a href='booking.html'>Official Booking</a> page, select your transport mode, and continue to verified partner portals." },
                { q: "Show available transport options", a: "The Booking page currently supports redirecting you to official portals for Bus (APSRTC), Train (IRCTC), and verified Cab services." },
                { q: "Go to booking page", a: "Click here to <a href='booking.html'>Open Booking Page</a>." },
                { q: "How to confirm booking?", a: "Bookings are confirmed directly on the official partner portals (like APSRTC or IRCTC). Check your email or SMS for their confirmation." }
            ]
        },
        {
            category: "Checklist Feature",
            items: [
                { q: "What should I pack?", a: "Essential items include comfortable traditional wear for darshan, ID proofs, walking shoes, and any personal medication." },
                { q: "Show travel checklist", a: "We are currently integrating a checklist feature. For now, remember your ID cards, traditional clothes, and booking tickets!" },
                { q: "Add items to checklist", a: "A personalized checklist feature is coming soon to the planner dashboard." }
            ]
        },
        {
            category: "Navigation / App Help",
            items: [
                { q: "Go to planner page", a: "Click here: <a href='/dashboard'>GeoTrip dashboard</a>" },
                { q: "Open budget splitter", a: "Trip budgets are set via <a href='packages.html'>package tiers</a>. Open the dashboard map to plan your route." },
                { q: "Open booking page", a: "Click here: <a href='booking.html'>Official Booking</a>" },
                { q: "How to use this feature?", a: "Select any query from this menu, and I will guide you with details or direct links!" }
            ]
        },
        {
            category: "Emergency / Extra",
            items: [
                { q: "Show nearby hospitals", a: "The <a href='packages.html'>Packages</a> and Map pages have an 'Emergency' button at the bottom right to instantly show the 3 nearest hospitals." },
                { q: "Emergency contacts", a: "In Tirupati, Dial 100 for Police, 108 for Ambulance. Hospital details are mapped via the Emergency button on the map pages." }
            ]
        }
    ];

    let flatQs = [];
    let htmlOptions = `
        <div class="gt-chatbot-quick-actions">
            <button class="gt-chatbot-quick-btn" onclick="window.location.href='packages.html'">📦 Packages</button>
            <button class="gt-chatbot-quick-btn" onclick="window.location.href='/dashboard'">🗺️ GeoTrip map</button>
            <button class="gt-chatbot-quick-btn" onclick="window.location.href='booking.html'">🚆 Booking</button>
            <button class="gt-chatbot-quick-btn" onclick="window.location.href='/dashboard'">🏠 Home</button>
        </div>
    `;

    faqData.forEach(group => {
        htmlOptions += `<div class="gt-chatbot-cat-title">${group.category}</div>`;
        group.items.forEach(item => {
            let idx = flatQs.length;
            flatQs.push(item);
            htmlOptions += `<button class="gt-chatbot-option-btn" data-idx="${idx}">${item.q}</button>`;
        });
    });

    // Create UI
    const container = document.createElement('div');
    container.innerHTML = `
        <button class="gt-chatbot-btn" id="gtChatBtn" aria-label="Open Chat">
            <span class="material-symbols-outlined">smart_toy</span>
        </button>
        <div class="gt-chatbot-window" id="gtChatWindow">
            <div class="gt-chatbot-header">
                <div>GeoTrip Assistant</div>
                <button id="gtChatClose"><span class="material-symbols-outlined">close</span></button>
            </div>
            <div class="gt-chatbot-body" id="gtChatBody">
                <div class="gt-chat-msg bot">Hello! I am your GeoTrip Assistant. Ask me anything about planning your trip!</div>
            </div>
            <div class="gt-chatbot-options" id="gtChatOptions">
                ${htmlOptions}
            </div>
            <label class="gt-chatbot-ollama-toggle" id="gtAgentToggleLabel" for="gtUseAgent">
                <input type="checkbox" id="gtUseAgent" aria-describedby="gtAgentHint" />
                <span class="gt-chatbot-ollama-label">Use GeoTrip Agent</span>
                <span id="gtAgentHint" class="text-slate-500" style="font-weight:400;font-size:0.72rem;">(off = FAQ)</span>
            </label>
            <div class="gt-chatbot-provider-wrap" id="gtAgentProviderWrap">
                <label for="gtAgentProvider">Agent engine</label>
                <select id="gtAgentProvider" aria-label="Choose agent engine">
                    <option value="gemini">Gemini ADK (cloud API key)</option>
                    <option value="ollama">Ollama Gemma3 (local, no API key)</option>
                </select>
            </div>
            <div class="gt-chatbot-input-area">
                <input type="text" id="gtChatInput" placeholder="Type your question..." autocomplete="off" />
                <button id="gtChatSend" aria-label="Send Message"><span class="material-symbols-outlined">send</span></button>
            </div>
        </div>
    `;
    document.body.appendChild(container);

    const btn = document.getElementById('gtChatBtn');
    const win = document.getElementById('gtChatWindow');
    const closeBtn = document.getElementById('gtChatClose');
    const body = document.getElementById('gtChatBody');
    const options = document.getElementById('gtChatOptions');

    btn.addEventListener('click', () => win.classList.toggle('is-open'));
    closeBtn.addEventListener('click', () => win.classList.remove('is-open'));

    options.addEventListener('click', (e) => {
        if(e.target.classList.contains('gt-chatbot-option-btn')) {
            const idx = e.target.getAttribute('data-idx');
            const item = flatQs[idx];
            
            // Add user msg
            const uMsg = document.createElement('div');
            uMsg.className = 'gt-chat-msg user';
            uMsg.innerText = item.q;
            body.appendChild(uMsg);

            // Scroll down
            body.scrollTop = body.scrollHeight;

            // Add bot msg after delay
            setTimeout(() => {
                const bMsg = document.createElement('div');
                bMsg.className = 'gt-chat-msg bot';
                bMsg.innerHTML = item.a;
                body.appendChild(bMsg);
                body.scrollTop = body.scrollHeight;
            }, 400);
        }
    });

    const chatInput = document.getElementById('gtChatInput');
    const chatSend = document.getElementById('gtChatSend');
    const useAgentCheckbox = document.getElementById('gtUseAgent');
    const agentToggleLabel = document.getElementById('gtAgentToggleLabel');
    const agentProviderWrap = document.getElementById('gtAgentProviderWrap');
    const agentProviderSelect = document.getElementById('gtAgentProvider');
    const AGENT_PREF_KEY = 'gtChatUseAgent';
    const AGENT_PROVIDER_KEY = 'gtChatAgentProvider';
    let agentSessionId = sessionStorage.getItem('geotrip_agent_session') || '';

    function getAgentProvider() {
        return (agentProviderSelect && agentProviderSelect.value) || 'gemini';
    }

    function isAgentEnabled() {
        return useAgentCheckbox && useAgentCheckbox.checked;
    }

    const agentHint = document.getElementById('gtAgentHint');

    function applyChatAgentActions(actions) {
        if (!actions || !actions.length) return;
        actions.forEach(function(act) {
            if (!act || !act.type) return;
            if (act.type === 'open_map') {
                window.location.href = '/dashboard';
            } else if (act.type === 'show_package') {
                window.location.href = act.url || '/packages.html';
            } else if (act.type === 'show_qr') {
                if (typeof window.showFloatingTempleQr === 'function') window.showFloatingTempleQr();
            } else if (act.type === 'show_emergency_map') {
                var emFab = document.getElementById('emergencyFab');
                if (emFab) emFab.click();
            } else if (act.type === 'show_route') {
                if (typeof window.drawAgentRoute === 'function') {
                    window.drawAgentRoute(act);
                } else {
                    try { sessionStorage.setItem('geotrip_pending_route', JSON.stringify(act)); } catch (e) {}
                    window.location.href = '/dashboard';
                }
            }
        });
    }

    function syncAgentToggleUi() {
        const on = isAgentEnabled();
        if (agentToggleLabel) {
            agentToggleLabel.classList.toggle('is-on', on);
        }
        if (agentProviderWrap) {
            agentProviderWrap.classList.toggle('is-visible', on);
        }
        if (options) {
            options.classList.toggle('is-hidden', on);
        }
        if (body) {
            body.classList.toggle('is-ollama-mode', on);
        }
        const provider = getAgentProvider();
        if (agentHint) {
            agentHint.textContent = on
                ? (provider === 'ollama'
                    ? '(Ollama Gemma3 local — FAQ hidden)'
                    : '(Gemini ADK cloud — FAQ hidden)')
                : '(off = quick FAQ answers)';
        }
        if (chatInput) {
            chatInput.placeholder = on
                ? (provider === 'ollama'
                    ? 'Ask Gemma3 (local) about your trip…'
                    : 'Ask GeoTrip Agent (Gemini)…')
                : 'Type your question (FAQ mode)…';
        }
    }

    if (useAgentCheckbox) {
        const saved = localStorage.getItem(AGENT_PREF_KEY);
        useAgentCheckbox.checked = saved === '1';
        if (agentProviderSelect) {
            const savedProvider = localStorage.getItem(AGENT_PROVIDER_KEY);
            if (savedProvider === 'ollama' || savedProvider === 'gemini') {
                agentProviderSelect.value = savedProvider;
            }
        }
        syncAgentToggleUi();
        useAgentCheckbox.addEventListener('change', () => {
            localStorage.setItem(AGENT_PREF_KEY, useAgentCheckbox.checked ? '1' : '0');
            syncAgentToggleUi();
        });
    }
    if (agentProviderSelect) {
        agentProviderSelect.addEventListener('change', () => {
            localStorage.setItem(AGENT_PROVIDER_KEY, agentProviderSelect.value);
            syncAgentToggleUi();
        });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function findFaqAnswer(text) {
        const lowerText = text.toLowerCase();
        for (let item of flatQs) {
            if (lowerText.includes(item.q.toLowerCase()) || item.q.toLowerCase().includes(lowerText)) {
                return item.a;
            }
        }
        return null;
    }

    function appendBotMessage(html, isThinking, actions) {
        const bMsg = document.createElement('div');
        bMsg.className = 'gt-chat-msg bot' + (isThinking ? ' gt-chat-msg--thinking' : '');
        bMsg.innerHTML = html;
        if (actions && actions.length) {
            const wrap = document.createElement('div');
            wrap.style.marginTop = '6px';
            actions.forEach(function(act) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'gt-chatbot-action-btn';
                btn.textContent = act.type === 'open_map' ? 'Open map'
                    : act.type === 'show_package' ? 'Packages'
                    : act.type === 'show_qr' ? 'Show QR'
                    : act.type === 'show_emergency_map' ? 'Emergency map'
                    : act.type === 'show_route' ? 'View route on map'
                    : 'Open';
                btn.onclick = function() { applyChatAgentActions([act]); };
                wrap.appendChild(btn);
            });
            bMsg.appendChild(wrap);
        }
        body.appendChild(bMsg);
        body.scrollTop = body.scrollHeight;
        return bMsg;
    }

    function getAgentCoords() {
        if (typeof window.getMainGpsCoords === 'function') {
            var gps = window.getMainGpsCoords();
            if (gps && gps.lat != null && gps.lng != null) {
                return { lat: gps.lat, lng: gps.lng };
            }
        }
        if (window.mainGpsCoords && window.mainGpsCoords.lat != null) {
            return { lat: window.mainGpsCoords.lat, lng: window.mainGpsCoords.lng };
        }
        if (window._mainLastStartLat != null && window._mainLastStartLng != null) {
            return { lat: window._mainLastStartLat, lng: window._mainLastStartLng };
        }
        return { lat: 13.6288, lng: 79.4192 };
    }

    async function handleManualInput() {
        const text = chatInput.value.trim();
        if (!text) return;

        const useAgent = isAgentEnabled();
        chatInput.value = '';
        chatSend.disabled = true;

        const uMsg = document.createElement('div');
        uMsg.className = 'gt-chat-msg user';
        uMsg.innerText = text;
        body.appendChild(uMsg);
        body.scrollTop = body.scrollHeight;

        let answer = null;
        let actions = [];
        let thinkingEl = null;

        if (useAgent) {
            thinkingEl = appendBotMessage(
                getAgentProvider() === 'ollama' ? 'Gemma3 (local) is thinking…' : 'GeoTrip Agent is thinking…',
                true
            );
            try {
                const coords = getAgentCoords();
                const bodyPayload = {
                    message: text,
                    session_id: agentSessionId || undefined,
                    lat: coords.lat,
                    lng: coords.lng,
                    provider: getAgentProvider(),
                };
                const res = await fetch('/api/agent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(bodyPayload),
                });
                const data = await res.json();
                if (data.session_id) {
                    agentSessionId = data.session_id;
                    try { sessionStorage.setItem('geotrip_agent_session', agentSessionId); } catch (e) {}
                }
                if (data.status === 'success' && data.reply) {
                    answer = escapeHtml(data.reply).replace(/\n/g, '<br>');
                    if (data.warning) answer += '<br><small>' + escapeHtml(data.warning) + '</small>';
                    actions = data.actions || [];
                } else if (data.message) {
                    answer = escapeHtml(data.message);
                }
            } catch (err) {
                console.warn('GeoTrip Agent unavailable:', err);
            }
            if (thinkingEl) thinkingEl.remove();
        } else {
            answer = findFaqAnswer(text);
        }

        if (!answer) {
            answer = useAgent
                ? 'I could not reach GeoTrip Agent. Check that the server is running and your Gemini API key is set in <code>backend/.env</code>.'
                : "I don't have a specific FAQ answer for that. Turn on <strong>Use GeoTrip Agent</strong> below for AI trip help, or pick a suggested question above.";
        }

        appendBotMessage(answer, false, actions);
        actions.filter(function(a) { return a && a.type === 'show_route'; }).forEach(function(act) {
            applyChatAgentActions([act]);
        });
        chatSend.disabled = false;
        chatInput.focus();
    }

    chatSend.addEventListener('click', () => { handleManualInput(); });
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleManualInput();
    });
})();
