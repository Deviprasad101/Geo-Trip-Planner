/**
 * GeoTrip feature toggles — set a flag to true to re-enable without deleting code.
 * Simplified deployment: AI, chatbot, recommendations panel, QR/check-in off by default.
 */
(function (global) {
    'use strict';

    global.GEOTRIP_FEATURES = {
        /** Master switch — when false, disables all AI/chatbot/Ollama/Gemini UI and APIs */
        ai: false,
        chatbot: false,
        recAgent: false,
        recommendations: false,
        qr: false,
        admin: false,
        aiItinerarySection: false,
    };

    global.geotripFeatureEnabled = function (key) {
        var features = global.GEOTRIP_FEATURES || {};
        if (features.ai === false) {
            if (key === 'ai' || key === 'chatbot' || key === 'recAgent' || key === 'aiItinerarySection') {
                return false;
            }
        }
        if (!(key in features)) return true;
        return features[key] === true;
    };

    var style = document.createElement('style');
    style.id = 'geotrip-feature-styles';
    style.textContent = [
        '.gt-no-ai [data-rec-tab="agent"],',
        '.gt-no-ai .gt-chatbot-btn,',
        '.gt-no-ai .gt-chatbot-window,',
        '.gt-no-ai #gtAiItinerarySection,',
        '.gt-no-ai #gtAiPackagesFooter { display: none !important; visibility: hidden !important; pointer-events: none !important; }',
        '.gt-no-chatbot .gt-chatbot-btn,',
        '.gt-no-chatbot .gt-chatbot-window { display: none !important; visibility: hidden !important; pointer-events: none !important; }',
        '.gt-no-rec-agent [data-rec-tab="agent"] { display: none !important; }',
        '.gt-no-recommendations #recFab,',
        '.gt-no-recommendations #recPanel { display: none !important; visibility: hidden !important; pointer-events: none !important; }',
        '.gt-no-qr #myQrSection,',
        '.gt-no-qr #floatingQr,',
        '.gt-no-qr .floating-qr,',
        '.gt-no-qr #templeStaffScanRoot,',
        '.gt-no-qr #templeStaffToastHost { display: none !important; visibility: hidden !important; }',
        '.gt-no-admin .gt-admin-entry { display: none !important; }',
        '.gt-no-admin #adminFullPanel { display: none !important; }',
        '.gt-no-ai-itinerary #gtAiItinerarySection,',
        '.gt-no-ai-itinerary #gtAiPackagesFooter { display: none !important; }',
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);

    function applyBodyClasses() {
        var body = document.body;
        if (!body) return;
        var f = global.GEOTRIP_FEATURES || {};
        if (f.ai === false) body.classList.add('gt-no-ai');
        if (f.chatbot === false) body.classList.add('gt-no-chatbot');
        if (f.recAgent === false) body.classList.add('gt-no-rec-agent');
        if (f.recommendations === false) body.classList.add('gt-no-recommendations');
        if (f.qr === false) body.classList.add('gt-no-qr');
        if (f.admin === false) body.classList.add('gt-no-admin');
        if (f.aiItinerarySection === false) body.classList.add('gt-no-ai-itinerary');
    }

    function hideAdminEntries() {
        if (global.geotripFeatureEnabled('admin')) return;
        document.querySelectorAll('.login-mobile-admin, button[onclick*="toggleAdminPanel"]').forEach(function (el) {
            el.classList.add('gt-admin-entry');
            el.setAttribute('aria-hidden', 'true');
        });
    }

    function patchAdminPanel() {
        if (global.geotripFeatureEnabled('admin')) return;
        if (global.location && global.location.pathname === '/admin') {
            global.location.replace('/');
            return;
        }
        global.toggleAdminPanel = function (show) {
            if (!show) {
                var panel = document.getElementById('adminFullPanel');
                if (panel) panel.style.display = 'none';
                document.body.style.overflow = '';
            }
        };
    }

    function patchRecommendations() {
        if (global.geotripFeatureEnabled('recommendations')) return;
        global._showRecPanel = function () {};
        global._setRecPanelOpen = function () {};
        var fab = document.getElementById('recFab');
        var panel = document.getElementById('recPanel');
        if (fab) {
            fab.style.display = 'none';
            fab.setAttribute('aria-hidden', 'true');
        }
        if (panel) {
            panel.style.display = 'none';
            panel.setAttribute('aria-hidden', 'true');
        }
    }

    function patchRecAgentTab() {
        if (global.geotripFeatureEnabled('recAgent')) return;
        document.querySelectorAll('[data-rec-tab="agent"]').forEach(function (btn) {
            btn.style.display = 'none';
        });
        global._renderRecAgent = function () {};
        global._callRecAgent = function () {
            return Promise.resolve({ status: 'error', message: 'AI Agent is disabled.' });
        };
    }

    function patchAiRoutes() {
        if (global.geotripFeatureEnabled('ai')) return;
        global.drawAgentRoute = function () {};
    }

    function loadOptionalScripts() {
        var path = (global.location && global.location.pathname) || '';
        if (global.geotripFeatureEnabled('chatbot')) {
            global.geotripLoadScript('/chatbot.js', { defer: true });
        }
        if (path.indexOf('/packages') !== -1 && global.geotripFeatureEnabled('aiItinerarySection')) {
            global.geotripLoadScript('/recommender.js', { defer: true });
        }
    }

    global.geotripLoadScript = function (src, opts) {
        opts = opts || {};
        if (document.querySelector('script[data-geotrip-src="' + src + '"]')) return;
        var s = document.createElement('script');
        s.src = src;
        s.setAttribute('data-geotrip-src', src);
        if (opts.defer) s.defer = true;
        (document.head || document.body).appendChild(s);
    };

    function onReady() {
        applyBodyClasses();
        hideAdminEntries();
        patchAdminPanel();
        patchAiRoutes();
        if (!global.geotripFeatureEnabled('qr')) {
            var path = (global.location && global.location.pathname) || '';
            if (path.indexOf('/user/') === 0) {
                global.location.replace('/dashboard');
            }
        }
        loadOptionalScripts();
    }

    if (document.body) onReady();
    else document.addEventListener('DOMContentLoaded', onReady);

    global.addEventListener('load', function () {
        hideAdminEntries();
        patchAdminPanel();
        patchRecommendations();
        patchRecAgentTab();
        patchAiRoutes();
    });
})(window);
