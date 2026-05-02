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
        .gt-chatbot-cat-title {
            font-size: 0.85rem;
            font-weight: 700;
            color: #b45309;
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
            border-bottom: 1px dashed #fcd34d;
        }
        .gt-chatbot-quick-btn {
            background: linear-gradient(135deg, #fffbeb, #fef3c7);
            border: 1px solid #f59e0b;
            color: #92400e;
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
            background: #fde68a;
            transform: translateY(-1px);
        }
        .gt-chatbot-input-area {
            display: flex;
            padding: 12px;
            background: #fff;
            border-top: 1px solid #e7e5e4;
            gap: 8px;
        }
        .gt-chatbot-input-area input {
            flex: 1;
            padding: 10px 14px;
            border: 1px solid #d6d3d1;
            border-radius: 20px;
            outline: none;
            font-family: inherit;
            font-size: 0.95rem;
        }
        .gt-chatbot-input-area input:focus {
            border-color: #d97706;
        }
        .gt-chatbot-input-area button {
            background: linear-gradient(135deg, #ea580c, #b45309);
            color: white;
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
                { q: "What can you do?", a: "I can help you explore tour packages, plan itineraries on the map, split your budget, and guide you to official booking portals." },
                { q: "How does this app work?", a: "GeoTrip Planner combines a Map Planner for finding spots, a Budget Splitter to manage expenses, and curated Packages to give you a complete trip experience." }
            ]
        },
        {
            category: "Trip Planning",
            items: [
                { q: "How do I plan a trip?", a: "Go to the <a href='budget_calculator.html'>Map & Budget Planner</a>, add places like temples or food joints to your route, and see live estimates." },
                { q: "Suggest places to visit", a: "Tirupati offers the main Sri Venkateswara Temple, ISKCON, Talakona Waterfalls, and SV Zoological Park. Check the <a href='packages.html'>Packages</a> page for curated lists!" },
                { q: "Show nearby attractions", a: "You can find nearby attractions directly on the <a href='budget_calculator.html'>Map Planner</a> by clicking on the map pins." },
                { q: "How to create itinerary?", a: "An itinerary is automatically created as you select places on the map in the <a href='budget_calculator.html'>Planner</a> page. It optimizes the route for you." }
            ]
        },
        {
            category: "Budget Splitter",
            items: [
                { q: "How to split expenses?", a: "Use the <a href='budget_splitter.html'>Smart Budget Splitter</a>. Enter your total budget, and it splits into Stay, Food, Transport, and Activities." },
                { q: "Add members to trip", a: "In the Budget Splitter, adjust the 'People' input field. The system automatically recalculates the per-person share." },
                { q: "Calculate total budget", a: "The total budget is entered by you or pulled automatically from your Map Planner session into the Budget Splitter." },
                { q: "Who owes how much?", a: "The Budget Splitter currently assumes equal sharing. It shows the exact equal split amount under the 'Per traveller' section." }
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
                { q: "Go to planner page", a: "Click here: <a href='budget_calculator.html'>Map & Budget Planner</a>" },
                { q: "Open budget splitter", a: "Click here: <a href='budget_splitter.html'>Smart Budget Splitter</a>" },
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
            <button class="gt-chatbot-quick-btn" onclick="window.location.href='budget_calculator.html'">📍 Plan My Trip</button>
            <button class="gt-chatbot-quick-btn" onclick="window.location.href='budget_splitter.html'">💰 Split Budget</button>
            <button class="gt-chatbot-quick-btn" onclick="window.location.href='booking.html'">🚆 Book Tickets</button>
            <button class="gt-chatbot-quick-btn" onclick="alert('Checklist coming soon! Remember IDs & Traditional wear.')">✅ Travel Checklist</button>
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
            <div class="gt-chatbot-input-area">
                <input type="text" id="gtChatInput" placeholder="Type your question manually..." autocomplete="off" />
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

    function handleManualInput() {
        const text = chatInput.value.trim();
        if(!text) return;
        
        chatInput.value = '';
        
        // Add user msg
        const uMsg = document.createElement('div');
        uMsg.className = 'gt-chat-msg user';
        uMsg.innerText = text;
        body.appendChild(uMsg);
        body.scrollTop = body.scrollHeight;

        // Try to find matching answer
        let answer = "I'm sorry, I don't have a specific answer for that. Please try rephrasing or select an option from above.";
        const lowerText = text.toLowerCase();
        
        // Very basic matching based on question keywords
        for(let item of flatQs) {
            if(lowerText.includes(item.q.toLowerCase()) || item.q.toLowerCase().includes(lowerText)) {
                answer = item.a;
                break;
            }
        }

        setTimeout(() => {
            const bMsg = document.createElement('div');
            bMsg.className = 'gt-chat-msg bot';
            bMsg.innerHTML = answer;
            body.appendChild(bMsg);
            body.scrollTop = body.scrollHeight;
        }, 500);
    }

    chatSend.addEventListener('click', handleManualInput);
    chatInput.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') handleManualInput();
    });
})();
