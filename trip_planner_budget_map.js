/**
 * Trip planner map runtime for Budget Calculator: same route logic, OSRM Trip,
 * animated road polyline, gov-style popups, category pins (Material Symbols).
 * Expects Leaflet, #budgetTripMapInner, #budgetTripMapOverlay, sidebar sb* ids,
 * and window.budgetTripRouteApi.getFilteredPlaces().
 */
(function () {
    'use strict';

    var OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
    var OSRM_MAX_WAYPOINTS = 90;
    var OSRM_TRIP_MAX = 25;
    var OSRM_TRIP_BASE = 'https://router.project-osrm.org/trip/v1/driving';
    var MINUTES_BUDGET_PER_STOP = 28;
    var DAY_END = 24 * 60 - 1;

    var map = null;
    var markerLayer = null;
    var routeLayerGroup = null;
    var userLayerGroup = null;
    var routeGeneration = 0;
    var routeAbortCtrl = null;
    var lastOptimizedOrder = null;
    var geoWatchId = null;
    var lastGps = null;
    var geocodeCache = { q: '', lat: null, lng: null, label: '' };
    var gpsRouteTimer = null;
    var filtersApplied = false;

    var iconStartHomeGps = typeof L !== 'undefined' ? L.divIcon({
        className: 'start-home-icon',
        html:
            '<div class="start-home-pin" role="img" aria-label="Starting point (GPS)">' +
            '<span class="material-symbols-outlined">home</span></div>',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -18]
    }) : null;

    var iconStartHomeTyped = typeof L !== 'undefined' ? L.divIcon({
        className: 'start-home-icon',
        html:
            '<div class="start-home-pin start-home-pin--typed" role="img" aria-label="Starting point (address)">' +
            '<span class="material-symbols-outlined">home</span></div>',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -18]
    }) : null;

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function formatNominatimAddressLine(hit) {
        if (!hit) return '';
        var dn = (hit.display_name || '').trim();
        if (dn) return dn;
        var a = hit.address || {};
        var parts = [];
        function first(keys) {
            for (var k = 0; k < keys.length; k++) {
                if (a[keys[k]]) return a[keys[k]];
            }
            return '';
        }
        var p1 = first(['hamlet', 'village', 'neighbourhood', 'suburb', 'quarter']);
        if (p1) parts.push(p1);
        var p2 = first(['city_district', 'town', 'city', 'municipality', 'county']);
        if (p2) parts.push(p2);
        if (a.state) parts.push(a.state);
        if (a.postcode) parts.push(a.postcode);
        if (a.country) parts.push(a.country);
        return parts.filter(Boolean).join(', ');
    }

    function isGeoEnabled() {
        var t = $('sbGeoToggle');
        return t && t.classList.contains('active');
    }

    function timeToMinutes(t) {
        if (!t || typeof t !== 'string') return 24 * 60;
        var m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return 24 * 60;
        var h = parseInt(m[1], 10);
        var min = parseInt(m[2], 10);
        if (h > 23 || min > 59) return 24 * 60;
        return h * 60 + min;
    }

    function parseTimingsSlots(timingsStr) {
        if (!timingsStr || typeof timingsStr !== 'string') return [];
        var out = [];
        var chunks = timingsStr.split('|');
        for (var c = 0; c < chunks.length; c++) {
            var seg = chunks[c].trim();
            var m = seg.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
            if (!m) continue;
            var h1 = parseInt(m[1], 10);
            var mi1 = parseInt(m[2], 10);
            var h2 = parseInt(m[3], 10);
            var mi2 = parseInt(m[4], 10);
            if (h1 > 23 || h2 > 23 || mi1 > 59 || mi2 > 59) continue;
            var ps = h1 * 60 + mi1;
            var pe = h2 * 60 + mi2;
            out.push({ ps: ps, pe: pe, overnight: pe < ps });
        }
        return out;
    }

    function minutesToHHMM(totalM) {
        var h = Math.floor(totalM / 60);
        var m = totalM % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    function deriveVisitDisplayFromTimings(timingsStr, categoryKey) {
        var slots = parseTimingsSlots(timingsStr);
        if (slots.length === 1 && !slots[0].overnight) {
            return {
                visit_start: minutesToHHMM(slots[0].ps),
                visit_end: minutesToHHMM(slots[0].pe)
            };
        }
        var d = {
            temple: ['05:00', '22:00'],
            food: ['06:00', '23:00'],
            adventure: ['09:00', '21:00'],
            sightseeing: ['09:00', '21:00'],
            other: ['09:00', '21:00']
        };
        var pair = d[categoryKey] || d.other;
        return { visit_start: pair[0], visit_end: pair[1] };
    }

    function placeMinuteWindow(p) {
        var ps = timeToMinutes(p.visit_start);
        var pe = timeToMinutes(p.visit_end);
        if (ps >= 24 * 60 || pe >= 24 * 60) return null;
        return { ps: ps, pe: pe, overnight: pe < ps };
    }

    function placeServiceSlots(p) {
        var fromTimings = parseTimingsSlots(p.timings);
        if (fromTimings.length) return fromTimings;
        var w = placeMinuteWindow(p);
        return w ? [w] : [];
    }

    function intervalsOverlapMinutes(a1, a2, b1, b2) {
        return a1 <= b2 && b1 <= a2;
    }

    function getUserTimeSegments() {
        var el1 = $('sbTripStartTime');
        var el2 = $('sbTripEndTime');
        var t1 = el1 && el1.value ? String(el1.value).trim() : '';
        var t2 = el2 && el2.value ? String(el2.value).trim() : '';
        if (!t1 && !t2) return null;
        if (t1 && !t2) {
            var m = timeToMinutes(t1);
            if (m >= 24 * 60) return null;
            return [[m, m]];
        }
        if (!t1 && t2) {
            var m2 = timeToMinutes(t2);
            if (m2 >= 24 * 60) return null;
            return [[m2, m2]];
        }
        var u1 = timeToMinutes(t1);
        var u2 = timeToMinutes(t2);
        if (u1 >= 24 * 60 || u2 >= 24 * 60) return null;
        if (u2 < u1) {
            return [
                [u1, DAY_END],
                [0, u2]
            ];
        }
        return [[u1, u2]];
    }

    function slotOverlapsUserOuting(slot, segs) {
        if (!segs || !segs.length) return true;
        var ps = slot.ps;
        var pe = slot.pe;
        var overnight = slot.overnight;
        for (var s = 0; s < segs.length; s++) {
            var a = segs[s][0];
            var b = segs[s][1];
            if (overnight) {
                if (intervalsOverlapMinutes(a, b, ps, DAY_END) || intervalsOverlapMinutes(a, b, 0, pe)) {
                    return true;
                }
            } else if (intervalsOverlapMinutes(a, b, ps, pe)) {
                return true;
            }
        }
        return false;
    }

    function getOutingDurationMinutes() {
        var segs = getUserTimeSegments();
        if (!segs || !segs.length) return null;
        var t = 0;
        for (var s = 0; s < segs.length; s++) {
            var a = segs[s][0];
            var b = segs[s][1];
            t += Math.max(0, b - a + 1);
        }
        return t;
    }

    function maxStopsForOutingDuration() {
        var d = getOutingDurationMinutes();
        if (d == null) return Infinity;
        return Math.max(1, Math.min(120, Math.floor(d / MINUTES_BUDGET_PER_STOP)));
    }

    function applyOutingDurationCap(ordered) {
        var cap = maxStopsForOutingDuration();
        if (!Number.isFinite(cap) || ordered.length <= cap) {
            return { list: ordered, capped: false, before: ordered.length };
        }
        return { list: ordered.slice(0, cap), capped: true, before: ordered.length };
    }

    function formatPlaceHoursForLegend(p) {
        var segs = getUserTimeSegments();
        var slots = placeServiceSlots(p);
        if (segs && segs.length && slots.length) {
            for (var i = 0; i < slots.length; i++) {
                var sl = slots[i];
                if (!slotOverlapsUserOuting(sl, segs)) continue;
                if (!sl.overnight) {
                    return minutesToHHMM(sl.ps) + ' – ' + minutesToHHMM(sl.pe);
                }
                return minutesToHHMM(sl.ps) + ' – ' + minutesToHHMM(sl.pe) + ' (+overnight)';
            }
        }
        return (p.visit_start || '') + ' – ' + (p.visit_end || '');
    }

    function categoryPinStyle(categoryKey) {
        var styles = {
            food: { bg: '#fff7ed', fg: '#c2410c', sym: 'restaurant' },
            adventure: { bg: '#ecfdf5', fg: '#047857', sym: 'landscape' },
            temple: { bg: '#fffbeb', fg: '#b45309', sym: 'temple_hindu' },
            sightseeing: { bg: '#eff6ff', fg: '#1d4ed8', sym: 'photo_camera' },
            other: { bg: '#f1f5f9', fg: '#475569', sym: 'place' }
        };
        return styles[categoryKey] || styles.other;
    }

    function placeMarkerIconWithOrder(categoryKey, orderNum) {
        var o = categoryPinStyle(categoryKey);
        var html =
            '<div class="place-pin" style="background:' +
            o.bg +
            ';color:' +
            o.fg +
            ';">' +
            '<span class="material-symbols-outlined msym">' +
            o.sym +
            '</span>' +
            '<span class="place-pin-order">' +
            orderNum +
            '</span></div>';
        return L.divIcon({
            className: 'place-pin-icon',
            html: html,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            popupAnchor: [0, -16]
        });
    }

    function normalizeHoursToken(s) {
        return (s || '')
            .replace(/\s/g, '')
            .replace(/–|—/g, '-')
            .replace(/\|/g, '')
            .toLowerCase();
    }

    function placePopupShowDetailedSlots(p, hoursLegendPlain) {
        var slots = (p.timings || '').trim();
        if (!slots) return false;
        if (slots.indexOf('|') >= 0) return true;
        var a = normalizeHoursToken(hoursLegendPlain);
        var b = normalizeHoursToken(slots);
        if (a && b && a === b) return false;
        return true;
    }

    function buildPlacePopupHtml(p, orderNum, o) {
        var hoursPlain = formatPlaceHoursForLegend(p);
        var hours = escapeHtml(hoursPlain);
        var cat = escapeHtml(p.category);
        var name = escapeHtml(p.name);
        var descRaw = (p.description || '').trim();
        var desc =
            descRaw.length > 180 ? escapeHtml(descRaw.slice(0, 180)) + '…' : escapeHtml(descRaw);
        var slotsRaw = (p.timings || '').trim();
        var slotsShort =
            slotsRaw.length > 200 ? escapeHtml(slotsRaw.slice(0, 200)) + '…' : escapeHtml(slotsRaw);
        var chipAccent =
            p.categoryKey === 'temple' || p.categoryKey === 'food' ? ' place-card__chip--accent' : '';
        var accentInk =
            {
                food: '#9a3412',
                temple: '#78350f',
                adventure: '#065f46',
                sightseeing: '#1e40af',
                other: '#334155'
            }[p.categoryKey] || '#334155';
        var slotsBlock =
            slotsRaw && placePopupShowDetailedSlots(p, hoursPlain)
                ? '<div class="place-card__section"><div class="place-card__label">Detailed timings</div><div class="place-card__slots">' +
                  slotsShort +
                  '</div></div>'
                : '';
        return (
            '<div class="place-card" style="--pp-accent:' +
            o.fg +
            ';--pp-soft:' +
            o.bg +
            ';--pp-accent-ink:' +
            accentInk +
            ';">' +
            '<div class="place-card__ribbon">' +
            '<div class="place-card__ribbon-left">' +
            '<span class="place-card__badge">Stop ' +
            orderNum +
            '</span>' +
            '<span class="place-card__status"><strong>Open</strong> · itinerary route</span>' +
            '</div></div>' +
            '<div class="place-card__hero">' +
            '<div class="place-card__icon-ring" aria-hidden="true">' +
            '<span class="material-symbols-outlined" style="color:' +
            o.fg +
            '">' +
            o.sym +
            '</span></div>' +
            '<div class="place-card__title-wrap"><h3 class="place-card__title">' +
            name +
            '</h3></div>' +
            '</div>' +
            '<div class="place-card__body">' +
            '<div class="place-card__meta">' +
            '<span class="place-card__chip' +
            chipAccent +
            '">' +
            cat +
            '</span>' +
            '<span class="place-card__chip">' +
            hours +
            '</span></div>' +
            slotsBlock +
            (descRaw ? '<p class="place-card__desc">' + desc + '</p>' : '') +
            '</div></div>'
        );
    }

    function buildStartPopupHtml(mode, addressHtml, metaLine) {
        var mod = mode === 'typed' ? 'typed' : 'gps';
        var badge = mode === 'typed' ? 'Address' : 'GPS';
        var ribbonTitle =
            mode === 'typed' ? 'Starting point · typed location' : 'Starting point · live location';
        var subtitle =
            mode === 'typed' ? 'Resolved from your search text' : 'Coordinates from your device';
        var footer = metaLine
            ? '<div class="start-place-card__footer">' + escapeHtml(metaLine) + '</div>'
            : '';
        return (
            '<div class="start-place-card start-place-card--' +
            mod +
            '">' +
            '<div class="start-place-card__ribbon">' +
            '<div class="start-place-card__ribbon-left">' +
            '<span class="start-place-card__badge">' +
            badge +
            '</span>' +
            '<span class="start-place-card__ribbon-title">' +
            escapeHtml(ribbonTitle) +
            '</span>' +
            '</div></div>' +
            '<div class="start-place-card__hero">' +
            '<div class="start-place-card__icon-ring" aria-hidden="true">' +
            '<span class="material-symbols-outlined">home</span></div>' +
            '<div class="start-place-card__hero-text">' +
            '<div class="start-place-card__eyebrow">Trip origin</div>' +
            '<div class="start-place-card__subtitle">' +
            escapeHtml(subtitle) +
            '</div>' +
            '</div></div>' +
            '<div class="start-place-card__body">' +
            '<div class="start-place-card__label">Full address</div>' +
            '<div class="start-place-card__addr">' +
            addressHtml +
            '</div>' +
            footer +
            '</div></div>'
        );
    }

    function routeCandidates() {
        var api = window.budgetTripRouteApi;
        if (!api || typeof api.getFilteredPlaces !== 'function') return [];
        return api.getFilteredPlaces();
    }

    function haversineM(aLat, aLng, bLat, bLng) {
        var R = 6371000;
        var toR = Math.PI / 180;
        var dLat = (bLat - aLat) * toR;
        var dLng = (bLng - aLng) * toR;
        var x =
            Math.pow(Math.sin(dLat / 2), 2) +
            Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.pow(Math.sin(dLng / 2), 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
    }

    function orderNearestWithinGroup(places, startLat, startLng) {
        if (!places.length) return [];
        var rem = places.slice();
        var out = [];
        var lat = startLat;
        var lng = startLng;
        if (
            lat == null ||
            lng == null ||
            typeof lat !== 'number' ||
            typeof lng !== 'number' ||
            isNaN(lat) ||
            isNaN(lng)
        ) {
            rem.sort(function (a, b) {
                return (a.name || '').localeCompare(b.name || '');
            });
            var first = rem.shift();
            out.push(first);
            lat = first.lat;
            lng = first.lng;
        }
        while (rem.length) {
            var bestI = 0;
            var bestD = Infinity;
            for (var i = 0; i < rem.length; i++) {
                var d = haversineM(lat, lng, rem[i].lat, rem[i].lng);
                if (d < bestD) {
                    bestD = d;
                    bestI = i;
                }
            }
            var p = rem.splice(bestI, 1)[0];
            out.push(p);
            lat = p.lat;
            lng = p.lng;
        }
        return out;
    }

    function orderPlacesForItinerary(list, startLat, startLng) {
        return orderNearestWithinGroup(list.slice(), startLat, startLng);
    }

    function placeKey(p) {
        return p.name + '@' + p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
    }

    function stopSetSignature(list) {
        return list
            .map(placeKey)
            .sort()
            .join('|');
    }

    function applyCachedRoadOrder(list) {
        if (!lastOptimizedOrder || list.length !== lastOptimizedOrder.ordered.length) return list;
        if (stopSetSignature(list) !== lastOptimizedOrder.signature) return list;
        var byKey = new Map();
        for (var i = 0; i < list.length; i++) {
            byKey.set(placeKey(list[i]), list[i]);
        }
        var rebuilt = [];
        for (var r = 0; r < lastOptimizedOrder.ordered.length; r++) {
            var ref = lastOptimizedOrder.ordered[r];
            var m = byKey.get(placeKey(ref));
            if (!m) return list;
            rebuilt.push(m);
        }
        return rebuilt;
    }

    function ensureMap() {
        if (map) return;
        var el = $('budgetTripMapInner');
        if (!el || typeof L === 'undefined') return;
        map = L.map(el, { zoomControl: true }).setView([13.65, 79.35], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        markerLayer = L.layerGroup().addTo(map);
    }

    function ensureRouteLayers() {
        if (!map) return;
        if (!routeLayerGroup) {
            routeLayerGroup = L.layerGroup().addTo(map);
            userLayerGroup = L.layerGroup().addTo(map);
        }
    }

    function updateMapMarkers(ordered, fitMap) {
        if (fitMap == null) fitMap = true;
        if (!map || !markerLayer) return;
        markerLayer.clearLayers();
        if (!ordered || !ordered.length) {
            map.setView([13.65, 79.35], 10);
            return;
        }
        var bounds = [];
        for (var idx = 0; idx < ordered.length; idx++) {
            var p = ordered[idx];
            var orderNum = idx + 1;
            var o = categoryPinStyle(p.categoryKey);
            var m = L.marker([p.lat, p.lng], {
                icon: placeMarkerIconWithOrder(p.categoryKey, orderNum),
                zIndexOffset: 400 + idx
            });
            m.bindPopup(buildPlacePopupHtml(p, orderNum, o), {
                minWidth: 300,
                maxWidth: 420,
                className: 'place-popup--gov'
            });
            m.addTo(markerLayer);
            bounds.push([p.lat, p.lng]);
        }
        if (fitMap && bounds.length) {
            map.fitBounds(bounds, { padding: [36, 36], maxZoom: 12 });
        }
    }

    async function reverseGeocodeAddress(lat, lng, signal) {
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
        try {
            var url =
                'https://nominatim.openstreetmap.org/reverse?format=json&lat=' +
                encodeURIComponent(String(lat)) +
                '&lon=' +
                encodeURIComponent(String(lng)) +
                '&addressdetails=1&zoom=18';
            var r = await fetch(url, { headers: { Accept: 'application/json' }, signal: signal });
            if (!r.ok) return null;
            var j = await r.json();
            if (!j || j.error) return null;
            return j;
        } catch (e) {
            if (e && e.name === 'AbortError') return null;
            return null;
        }
    }

    async function geocodeAddress(query, signal) {
        var q = (query || '').trim();
        if (!q) return null;
        if (geocodeCache.q === q && geocodeCache.lat != null) {
            return { lat: geocodeCache.lat, lng: geocodeCache.lng, label: geocodeCache.label };
        }
        try {
            var url =
                'https://nominatim.openstreetmap.org/search?format=json&limit=3&addressdetails=1' +
                '&countrycode=in&viewbox=79.0,13.3,79.7,14.0&bounded=0&q=' +
                encodeURIComponent(q);
            var r = await fetch(url, { headers: { Accept: 'application/json' }, signal: signal });
            if (!r.ok) return null;
            var arr = await r.json();
            if (!arr || !arr[0]) return null;
            var inBox = null;
            for (var i = 0; i < arr.length; i++) {
                var x = arr[i];
                var la = parseFloat(x.lat);
                var lo = parseFloat(x.lon);
                if (la >= 13.3 && la <= 14.0 && lo >= 79.0 && lo <= 79.7) {
                    inBox = x;
                    break;
                }
            }
            var hit = inBox || arr[0];
            var lat = parseFloat(hit.lat);
            var lng = parseFloat(hit.lon);
            if (isNaN(lat) || isNaN(lng)) return null;
            var label = formatNominatimAddressLine(hit) || hit.display_name || q;
            geocodeCache = { q: q, lat: lat, lng: lng, label: label };
            return { lat: lat, lng: lng, label: label };
        } catch (e) {
            if (e && e.name === 'AbortError') return null;
            return null;
        }
    }

    async function fetchOsrmTripOrder(points, stableGen, signal) {
        if (!points || points.length < 3 || points.length > OSRM_TRIP_MAX) return null;
        var path = points
            .map(function (p) {
                return p.lng + ',' + p.lat;
            })
            .join(';');
        try {
            var url =
                OSRM_TRIP_BASE +
                '/' +
                path +
                '?source=first&destination=last&roundtrip=false&overview=false';
            var r = await fetch(url, { signal: signal });
            if (!r.ok) return null;
            var j = await r.json();
            if (stableGen !== routeGeneration) return null;
            if (j.code !== 'Ok' || !Array.isArray(j.waypoints)) return null;
            var pairs = [];
            for (var i = 0; i < j.waypoints.length; i++) {
                var wi = j.waypoints[i].waypoint_index;
                if (typeof wi !== 'number') return null;
                pairs.push({ inputIdx: i, visitIdx: wi });
            }
            pairs.sort(function (a, b) {
                return a.visitIdx - b.visitIdx;
            });
            return pairs.map(function (x) {
                return x.inputIdx;
            });
        } catch (e) {
            if (e && e.name === 'AbortError') return null;
            return null;
        }
    }

    async function fetchRoadRouteMulti(points, stableGen, signal) {
        if (!points || points.length < 2) return null;
        var slice = points.slice(0, OSRM_MAX_WAYPOINTS);
        var path = slice
            .map(function (p) {
                return p.lng + ',' + p.lat;
            })
            .join(';');
        try {
            var url = OSRM_BASE + '/' + path + '?overview=full&geometries=geojson';
            var r = await fetch(url, { signal: signal });
            if (!r.ok) return null;
            var j = await r.json();
            if (stableGen !== routeGeneration) return null;
            if (j.code !== 'Ok' || !j.routes || !j.routes[0]) return null;
            return j.routes[0].geometry.coordinates.map(function (c) {
                return [c[1], c[0]];
            });
        } catch (e) {
            if (e && e.name === 'AbortError') return null;
            return null;
        }
    }

    function animatePolylineAlong(latlngs, style, stableGen) {
        if (!routeLayerGroup || latlngs.length < 2) return null;
        var st = { interactive: false };
        for (var key in style) {
            if (Object.prototype.hasOwnProperty.call(style, key)) st[key] = style[key];
        }
        var line = L.polyline([], st).addTo(routeLayerGroup);
        var duration = 900;
        var n = latlngs.length;
        var t0 = performance.now();
        function frame(now) {
            if (stableGen !== routeGeneration) return;
            var e = Math.min(1, (now - t0) / duration);
            var k = Math.max(2, Math.ceil(e * n));
            line.setLatLngs(latlngs.slice(0, k));
            if (e < 1) {
                requestAnimationFrame(frame);
            } else {
                try {
                    var el = typeof line.getElement === 'function' ? line.getElement() : null;
                    if (el) el.style.filter = 'drop-shadow(0 0 3px rgba(0,0,0,.25))';
                } catch (_) {}
            }
        }
        requestAnimationFrame(frame);
        return line;
    }

    async function drawItineraryFromWaypoints(waypoints, stableGen, signal) {
        if (!routeLayerGroup || waypoints.length < 2) return;
        var latlngs = await fetchRoadRouteMulti(waypoints, stableGen, signal);
        if (stableGen !== routeGeneration) return;
        if (!latlngs || latlngs.length < 2) {
            latlngs = waypoints.map(function (w) {
                return [w.lat, w.lng];
            });
        }
        if (stableGen !== routeGeneration) return;
        if (latlngs && latlngs.length >= 2) {
            animatePolylineAlong(
                latlngs,
                { color: '#0f766e', weight: 4, opacity: 0.9 },
                stableGen
            );
        }
    }

    async function refreshRoutesToNearest() {
        if (!map || !filtersApplied) return;
        if (routeAbortCtrl) routeAbortCtrl.abort();
        routeAbortCtrl = new AbortController();
        var signal = routeAbortCtrl.signal;
        var myGen = ++routeGeneration;
        lastOptimizedOrder = null;
        ensureRouteLayers();
        routeLayerGroup.clearLayers();
        userLayerGroup.clearLayers();

        var candidates = routeCandidates();
        if (!candidates.length) {
            updateMapMarkers([], true);
            return;
        }

        var startLat = null;
        var startLng = null;
        if (isGeoEnabled() && lastGps) {
            startLat = lastGps.lat;
            startLng = lastGps.lng;
            var rev = await reverseGeocodeAddress(lastGps.lat, lastGps.lng, signal);
            if (myGen !== routeGeneration) return;
            var addrLine = rev ? formatNominatimAddressLine(rev) : '';
            var addrHtml = addrLine
                ? escapeHtml(addrLine).replace(/,/g, ',<wbr>')
                : '<em>Address lookup unavailable — using GPS coordinates.</em>';
            var meta =
                'GPS · ' +
                lastGps.lat.toFixed(5) +
                ', ' +
                lastGps.lng.toFixed(5) +
                (lastGps.accuracy != null ? ' · ±' + Math.round(lastGps.accuracy) + ' m' : '');
            var m = L.marker([lastGps.lat, lastGps.lng], { icon: iconStartHomeGps, zIndexOffset: 700 })
                .bindPopup(buildStartPopupHtml('gps', addrHtml, meta), {
                    minWidth: 300,
                    maxWidth: 420,
                    className: 'place-popup--gov place-popup--start'
                })
                .addTo(userLayerGroup);
            m.openPopup();
        } else {
            var startLocationInput = $('sbStartLocation');
            var typedQ = startLocationInput && startLocationInput.value ? startLocationInput.value.trim() : '';
            if (typedQ) {
                var geo = await geocodeAddress(typedQ, signal);
                if (myGen !== routeGeneration) return;
                if (geo) {
                    startLat = geo.lat;
                    startLng = geo.lng;
                    var addrLine2 = geo.label || typedQ;
                    var addrHtml2 = escapeHtml(addrLine2).replace(/,/g, ',<wbr>');
                    var meta2 = 'Typed search · ' + geo.lat.toFixed(5) + ', ' + geo.lng.toFixed(5);
                    var m2 = L.marker([geo.lat, geo.lng], { icon: iconStartHomeTyped, zIndexOffset: 600 })
                        .bindPopup(buildStartPopupHtml('typed', addrHtml2, meta2), {
                            minWidth: 300,
                            maxWidth: 420,
                            className: 'place-popup--gov place-popup--start'
                        })
                        .addTo(userLayerGroup);
                    m2.openPopup();
                }
            }
        }

        if (myGen !== routeGeneration) return;

        var ordered = orderPlacesForItinerary(candidates.slice(), startLat, startLng);
        var durCapRes = applyOutingDurationCap(ordered);
        ordered = durCapRes.list;
        if (ordered.length > OSRM_MAX_WAYPOINTS - 5) {
            ordered = ordered.slice(0, OSRM_MAX_WAYPOINTS - 5);
        }

        var hasStart = startLat != null && startLng != null && !isNaN(startLat) && !isNaN(startLng);

        updateMapMarkers(ordered, true);

        var placeholderLine = null;
        if (ordered.length >= 1 && routeLayerGroup) {
            var plPts = [];
            if (hasStart) plPts.push([startLat, startLng]);
            for (var pi = 0; pi < ordered.length; pi++) {
                plPts.push([ordered[pi].lat, ordered[pi].lng]);
            }
            if (plPts.length >= 2) {
                placeholderLine = L.polyline(plPts, {
                    color: '#94a3b8',
                    weight: 3,
                    opacity: 0.4,
                    dashArray: '7 7',
                    interactive: false
                }).addTo(routeLayerGroup);
                var bPts = [];
                for (var bi = 0; bi < ordered.length; bi++) {
                    bPts.push([ordered[bi].lat, ordered[bi].lng]);
                }
                if (hasStart) bPts.push([startLat, startLng]);
                map.fitBounds(bPts, { padding: [40, 40], maxZoom: 13, animate: true });
            }
        }

        var roadOptimized = false;
        var tripPts = [];
        if (hasStart) tripPts.push({ lat: startLat, lng: startLng });
        for (var ti = 0; ti < ordered.length; ti++) {
            tripPts.push({ lat: ordered[ti].lat, lng: ordered[ti].lng });
        }

        if (tripPts.length >= 3 && tripPts.length <= OSRM_TRIP_MAX) {
            var newOrder = await fetchOsrmTripOrder(tripPts, myGen, signal);
            if (myGen !== routeGeneration) return;
            if (newOrder && newOrder.length === tripPts.length) {
                var stopOffset = hasStart ? 1 : 0;
                var stopOrder = newOrder.filter(function (idx) {
                    return idx >= stopOffset;
                });
                if (stopOrder.length === ordered.length) {
                    ordered = stopOrder.map(function (idx) {
                        return ordered[idx - stopOffset];
                    });
                    roadOptimized = true;
                }
            }
        }

        if (roadOptimized) {
            lastOptimizedOrder = { signature: stopSetSignature(ordered), ordered: ordered.slice() };
        } else {
            lastOptimizedOrder = null;
        }
        updateMapMarkers(ordered, false);

        var waypoints = [];
        if (hasStart) waypoints.push({ lat: startLat, lng: startLng });
        for (var wi = 0; wi < ordered.length; wi++) {
            waypoints.push({ lat: ordered[wi].lat, lng: ordered[wi].lng });
        }
        var deduped = waypoints.filter(function (w, i, a) {
            return i === 0 || w.lat !== a[i - 1].lat || w.lng !== a[i - 1].lng;
        });

        if (deduped.length >= 2) {
            if (placeholderLine && routeLayerGroup) {
                routeLayerGroup.removeLayer(placeholderLine);
                placeholderLine = null;
            }
            await drawItineraryFromWaypoints(deduped, myGen, signal);
        }

        if (myGen !== routeGeneration) return;

        var boundsPts = [];
        for (var bj = 0; bj < ordered.length; bj++) {
            boundsPts.push([ordered[bj].lat, ordered[bj].lng]);
        }
        if (hasStart) boundsPts.push([startLat, startLng]);
        if (boundsPts.length) {
            map.fitBounds(boundsPts, { padding: [40, 40], maxZoom: 13, animate: true });
        }
    }

    function stopGeoWatch() {
        if (geoWatchId != null && navigator.geolocation) {
            navigator.geolocation.clearWatch(geoWatchId);
            geoWatchId = null;
        }
        lastGps = null;
    }

    function scheduleRefreshRoutes() {
        if (!filtersApplied || !map) return;
        clearTimeout(gpsRouteTimer);
        gpsRouteTimer = setTimeout(function () {
            refreshRoutesToNearest();
        }, 1500);
    }

    function maybeStartGeoWatch() {
        if (!isGeoEnabled() || !filtersApplied || !map || !navigator.geolocation) return;
        if (geoWatchId != null) return;
        geoWatchId = navigator.geolocation.watchPosition(
            function (pos) {
                lastGps = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
                scheduleRefreshRoutes();
            },
            function () {
                var gpsStatus = $('sbGpsStatus');
                if (gpsStatus) {
                    gpsStatus.textContent = 'GPS on — waiting for position…';
                }
            },
            { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
        );
    }

    function applyFiltersAndShowMap() {
        filtersApplied = true;
        var ov = $('budgetTripMapOverlay');
        if (ov) ov.classList.add('hidden');
        ensureMap();
        var list = routeCandidates();
        updateMapMarkers(list, true);
        window.setTimeout(function () {
            if (map) map.invalidateSize();
            refreshRoutesToNearest();
            maybeStartGeoWatch();
        }, 80);
    }

    function show() {
        if (typeof L === 'undefined') return;
        var api = window.budgetTripRouteApi;
        if (!api || typeof api.getFilteredPlaces !== 'function') return;
        geocodeCache = { q: '', lat: null, lng: null, label: '' };
        applyFiltersAndShowMap();
    }

    window.BudgetTripPlannerMap = {
        show: show,
        invalidate: function () {
            if (map) map.invalidateSize();
        }
    };
})();
