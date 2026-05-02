(function() {
    // Inject CSS
    const style = document.createElement('style');
    style.innerHTML = `
        .gt-chatbot-btn {
            position: fixed;
            bottom: 88px;
            right: 24px;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, #ea580c, #b45309);
            color: white;
            border: none;
            box-shadow: 0 4px 15px rgba(180, 83, 9, 0.4);
            cursor: pointer;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .gt-chatbot-btn:hover {
            transform: scale(1.05);
            box-shadow: 0 6px 20px rgba(180, 83, 9, 0.5);
        }
        .gt-chatbot-btn .material-symbols-outlined {
            font-size: 30px;
        }
        .gt-chatbot-window {
            position: fixed;
            bottom: 160px;
            right: 24px;
            width: 420px;
            max-height: 750px;
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
            border: 1px solid rgba(251, 191, 36, 0.3);
            display: flex;
            flex-direction: column;
            z-index: 9999;
            opacity: 0;
            pointer-events: none;
            transform: translateY(20px);
            transition: all 0.3s ease;
            overflow: hidden;
            font-family: 'Outfit', sans-serif;
        }
        .gt-chatbot-window.is-open {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
        }
        .gt-chatbot-header {
            background: linear-gradient(135deg, #ea580c, #b45309);
            color: white;
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
            color: white;
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
            background: #fafaf9;
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
            background: #fff;
            color: #44403c;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            border: 1px solid #e7e5e4;
        }
        .gt-chat-msg.user {
            background: #fef3c7;
            color: #92400e;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
            border: 1px solid #fde68a;
        }
        .gt-chat-msg.bot a {
            color: #d97706;
            text-decoration: underline;
            font-weight: 600;
        }
        .gt-chatbot-options {
            padding: 16px;
            background: #fff;
            border-top: 1px solid #e7e5e4;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-height: 220px;
            overflow-y: auto;
        }
        .gt-chatbot-option-btn {
            background: #fff;
            border: 1px solid #d97706;
            color: #b45309;
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
            background: #fffbeb;
        }
        @media (max-width: 480px) {
            .gt-chatbot-window {
                width: calc(100% - 48px);
            }
        }
    `;
    document.head.appendChild(style);

    const qs = [
        { q: "Show me quick links to all pages", a: "Here are the direct links to navigate around the project:<br><br>🏠 <a href='main_page.html'>Home / Main Page</a><br>📦 <a href='packages.html'>Tour Packages</a><br>🗺️ <a href='budget_calculator.html'>Map & Budget Planner</a><br>🍕 <a href='budget_splitter.html'>Smart Budget Splitter</a><br>🎟️ <a href='booking.html'>Official Booking</a>" },
        { q: "What is GeoTrip Planner?", a: "GeoTrip Planner is a comprehensive travel planning tool designed specifically for Tirupati and Tirumala. It helps you discover local spots, plan darshan days, find accommodations, and split your budget efficiently." },
        { q: "How do I use the Budget Splitter?", a: "You can find it via the <a href='budget_splitter.html'>Smart Budget Splitter</a> page. Simply enter your total trip budget, number of people, and trip duration. It will automatically calculate an ideal budget split for stay, food, transport, and activities based on your preferred trip style." },
        { q: "How does the Map Planner work?", a: "The <a href='budget_calculator.html'>Map Planner</a> lets you view and filter places like temples, food joints, wildlife spots, and adventure activities. You can click on any location to get directions and see the live trip summary updating as you explore." },
        { q: "Can I book my journey directly?", a: "Yes! Visit the <a href='booking.html'>Booking</a> page. We provide an official booking interface to select bus, cab, or train modes, and you can continue to partner booking portals with a seamless workflow." },
        { q: "How to explore Tour Packages?", a: "Go to the <a href='packages.html'>Packages</a> page to explore a variety of curated tour packages for Tirupati. You can filter them by category, budget, and duration to find the perfect match for your trip." }
    ];

    // Create UI
    const container = document.createElement('div');
    container.innerHTML = `
        <button class="gt-chatbot-btn" id="gtChatBtn" aria-label="Open Chat">
            <span class="material-symbols-outlined">chat</span>
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
                ${qs.map((item, idx) => `<button class="gt-chatbot-option-btn" data-idx="${idx}">${item.q}</button>`).join('')}
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
            const item = qs[idx];
            
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
})();
