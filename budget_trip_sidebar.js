/**
 * Map-planner sidebar parity on the budget page: CSV-backed live summary,
 * same filter/trip fields. "Apply filters & show map" raises a CustomEvent so
 * the host page can embed the full planner map without leaving the budget UI.
 */
(function () {
    const CSV_URL = 'tirupati_places_updated_category_timings.csv';
    const MINUTES_BUDGET_PER_STOP = 28;
    const DAY_END = 24 * 60 - 1;

    let places = [];
    let selectedCategory = 'all';
    /** Always false here — filtered map is shown via host page iframe, not in this script. */
    const filtersApplied = false;
    let isGeoEnabled = false;
    const lastOptimizedOrder = null;
    /** When true, sidebar→main sync and overview card updates are skipped to avoid loops. */
    let workspaceSyncFromMain = false;

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function categoryKeyFromCsv(cat) {
        const c = (cat || '').toLowerCase();
        if (c.includes('food')) return 'food';
        if (c.includes('adventure')) return 'adventure';
        if (c.includes('temple')) return 'temple';
        if (c.includes('sight')) return 'sightseeing';
        return 'other';
    }

    function timeToMinutes(t) {
        if (!t || typeof t !== 'string') return 24 * 60;
        const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return 24 * 60;
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        if (h > 23 || min > 59) return 24 * 60;
        return h * 60 + min;
    }

    function minutesToHHMM(totalM) {
        const h = Math.floor(totalM / 60);
        const m = totalM % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    function parseTimingsSlots(timingsStr) {
        if (!timingsStr || typeof timingsStr !== 'string') return [];
        const out = [];
        const chunks = timingsStr.split('|');
        for (let c = 0; c < chunks.length; c++) {
            const seg = chunks[c].trim();
            const m = seg.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
            if (!m) continue;
            const h1 = parseInt(m[1], 10);
            const mi1 = parseInt(m[2], 10);
            const h2 = parseInt(m[3], 10);
            const mi2 = parseInt(m[4], 10);
            if (h1 > 23 || h2 > 23 || mi1 > 59 || mi2 > 59) continue;
            const ps = h1 * 60 + mi1;
            const pe = h2 * 60 + mi2;
            out.push({ ps: ps, pe: pe, overnight: pe < ps });
        }
        return out;
    }

    function deriveVisitDisplayFromTimings(timingsStr, categoryKey) {
        const slots = parseTimingsSlots(timingsStr);
        if (slots.length === 1 && !slots[0].overnight) {
            return {
                visit_start: minutesToHHMM(slots[0].ps),
                visit_end: minutesToHHMM(slots[0].pe)
            };
        }
        const d = {
            temple: ['05:00', '22:00'],
            food: ['06:00', '23:00'],
            adventure: ['09:00', '21:00'],
            sightseeing: ['09:00', '21:00'],
            other: ['09:00', '21:00']
        };
        const pair = d[categoryKey] || d.other;
        return { visit_start: pair[0], visit_end: pair[1] };
    }

    function placeMinuteWindow(p) {
        const ps = timeToMinutes(p.visit_start);
        const pe = timeToMinutes(p.visit_end);
        if (ps >= 24 * 60 || pe >= 24 * 60) return null;
        return { ps: ps, pe: pe, overnight: pe < ps };
    }

    function placeServiceSlots(p) {
        const fromTimings = parseTimingsSlots(p.timings);
        if (fromTimings.length) return fromTimings;
        const w = placeMinuteWindow(p);
        return w ? [w] : [];
    }

    function intervalsOverlapMinutes(a1, a2, b1, b2) {
        return a1 <= b2 && b1 <= a2;
    }

    function getUserTimeSegments() {
        const t1 = $('sbTripStartTime') && $('sbTripStartTime').value.trim();
        const t2 = $('sbTripEndTime') && $('sbTripEndTime').value.trim();
        if (!t1 && !t2) return null;
        if (t1 && !t2) {
            const m = timeToMinutes(t1);
            if (m >= 24 * 60) return null;
            return [[m, m]];
        }
        if (!t1 && t2) {
            const m = timeToMinutes(t2);
            if (m >= 24 * 60) return null;
            return [[m, m]];
        }
        const u1 = timeToMinutes(t1);
        const u2 = timeToMinutes(t2);
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
        const ps = slot.ps;
        const pe = slot.pe;
        const overnight = slot.overnight;
        for (let s = 0; s < segs.length; s++) {
            const a = segs[s][0];
            const b = segs[s][1];
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

    function placeOpenDuringUserOuting(p) {
        const segs = getUserTimeSegments();
        if (!segs || !segs.length) return true;
        const slots = placeServiceSlots(p);
        if (!slots.length) return false;
        for (let i = 0; i < slots.length; i++) {
            if (slotOverlapsUserOuting(slots[i], segs)) return true;
        }
        return false;
    }

    function getOutingDurationMinutes() {
        const segs = getUserTimeSegments();
        if (!segs || !segs.length) return null;
        let t = 0;
        for (let s = 0; s < segs.length; s++) {
            t += Math.max(0, segs[s][1] - segs[s][0] + 1);
        }
        return t;
    }

    function maxStopsForOutingDuration() {
        const d = getOutingDurationMinutes();
        if (d == null) return Infinity;
        return Math.max(1, Math.min(120, Math.floor(d / MINUTES_BUDGET_PER_STOP)));
    }

    function applyOutingDurationCap(ordered) {
        const cap = maxStopsForOutingDuration();
        if (!Number.isFinite(cap) || ordered.length <= cap) {
            return { list: ordered, capped: false, before: ordered.length };
        }
        return { list: ordered.slice(0, cap), capped: true, before: ordered.length };
    }

    function formatPlaceHoursForLegend(p) {
        const segs = getUserTimeSegments();
        const slots = placeServiceSlots(p);
        if (segs && segs.length && slots.length) {
            for (let i = 0; i < slots.length; i++) {
                const sl = slots[i];
                if (!slotOverlapsUserOuting(sl, segs)) continue;
                if (!sl.overnight) {
                    return minutesToHHMM(sl.ps) + ' – ' + minutesToHHMM(sl.pe);
                }
                return minutesToHHMM(sl.ps) + ' – ' + minutesToHHMM(sl.pe) + ' (+overnight)';
            }
        }
        return (p.visit_start || '') + ' – ' + (p.visit_end || '');
    }

    function haversineM(aLat, aLng, bLat, bLng) {
        const R = 6371000;
        const toR = Math.PI / 180;
        const dLat = (bLat - aLat) * toR;
        const dLng = (bLng - aLng) * toR;
        const x =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
    }

    function orderNearestWithinGroup(placeList, startLat, startLng) {
        if (!placeList.length) return [];
        const rem = placeList.slice();
        const out = [];
        let lat = startLat;
        let lng = startLng;
        if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
            rem.sort(function (a, b) {
                return (a.name || '').localeCompare(b.name || '');
            });
            const first = rem.shift();
            out.push(first);
            lat = first.lat;
            lng = first.lng;
        }
        while (rem.length) {
            let bestI = 0;
            let bestD = Infinity;
            for (let i = 0; i < rem.length; i++) {
                const d = haversineM(lat, lng, rem[i].lat, rem[i].lng);
                if (d < bestD) {
                    bestD = d;
                    bestI = i;
                }
            }
            const p = rem.splice(bestI, 1)[0];
            out.push(p);
            lat = p.lat;
            lng = p.lng;
        }
        return out;
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

    function orderPlacesForItinerary(list, startLat, startLng) {
        return orderNearestWithinGroup(list.slice(), startLat, startLng);
    }

    function applyCachedRoadOrder(list) {
        if (!lastOptimizedOrder || list.length !== lastOptimizedOrder.ordered.length) return list;
        if (stopSetSignature(list) !== lastOptimizedOrder.signature) return list;
        const byKey = new Map(list.map(function (p) {
            return [placeKey(p), p];
        }));
        const rebuilt = [];
        for (let i = 0; i < lastOptimizedOrder.ordered.length; i++) {
            const ref = lastOptimizedOrder.ordered[i];
            const m = byKey.get(placeKey(ref));
            if (!m) return list;
            rebuilt.push(m);
        }
        return rebuilt;
    }

    function splitIntoDays(ordered, numDays) {
        const raw = parseInt(numDays, 10);
        const d = Math.max(1, Math.min(365, isNaN(raw) ? 1 : raw));
        const n = ordered.length;
        const chunks = [];
        if (!n) return chunks;
        let idx = 0;
        let rem = n % d;
        const base = Math.floor(n / d);
        for (let day = 0; day < d; day++) {
            const size = base + (rem > 0 ? 1 : 0);
            if (rem > 0) rem--;
            chunks.push(ordered.slice(idx, idx + size));
            idx += size;
        }
        return chunks;
    }

    function parseCSVLine(line) {
        const parts = line.split(',');
        if (parts.length < 6) return null;
        const name = parts[0].trim();
        const category = parts[1].trim();
        const lat = parseFloat(parts[2]);
        const lng = parseFloat(parts[3]);
        const description = parts[4].trim();
        const timings = parts.slice(5).join(',').trim();
        const categoryKey = categoryKeyFromCsv(category);
        const ve = deriveVisitDisplayFromTimings(timings, categoryKey);
        return {
            name: name,
            category: category,
            categoryKey: categoryKey,
            lat: lat,
            lng: lng,
            visit_start: ve.visit_start,
            visit_end: ve.visit_end,
            description: description,
            timings: timings
        };
    }

    async function loadPlaces() {
        try {
            const res = await fetch(CSV_URL);
            const text = await res.text();
            const lines = text.trim().split(/\r?\n/);
            places = [];
            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVLine(lines[i]);
                if (row && !isNaN(row.lat) && !isNaN(row.lng)) places.push(row);
            }
        } catch (e) {
            console.error(e);
            places = [];
        }
    }

    function getSearchCategoryFiltered() {
        let list = places.slice();
        if (selectedCategory !== 'all') {
            list = list.filter(function (p) {
                return p.categoryKey === selectedCategory;
            });
        }
        const el = $('sbPlaceSearch');
        const q = (el && el.value.trim().toLowerCase()) || '';
        if (q) {
            list = list.filter(function (p) {
                return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
            });
        }
        return list;
    }

    function getFilteredPlaces() {
        const list = getSearchCategoryFiltered();
        return list.filter(placeOpenDuringUserOuting);
    }

    /** Same visit order as the live summary: nearest-neighbour from start, then outing-duration cap. */
    function getOrderedStopsForBudgetMap(startLat, startLng) {
        const candidates = getFilteredPlaces();
        if (!candidates.length) return [];
        const ordered = orderNearestWithinGroup(candidates.slice(), startLat, startLng);
        return applyOutingDurationCap(ordered).list;
    }

    function categoryLabel() {
        const labels = {
            all: 'All categories',
            food: 'Food places',
            adventure: 'Adventure',
            temple: 'Temples',
            sightseeing: 'Sightseeing'
        };
        return labels[selectedCategory] || selectedCategory;
    }

    function syncSidebarToMainWorkspace() {
        if (workspaceSyncFromMain) return;
        const daysEl = document.getElementById('days');
        const sbDays = $('sbNumDays');
        if (daysEl && sbDays && sbDays.value) {
            const v = Math.max(1, Math.min(365, parseInt(sbDays.value, 10) || 1));
            if (String(v) !== String(Math.max(1, parseInt(daysEl.value, 10) || 1))) {
                daysEl.value = String(v);
            }
        }
        const mtd = document.getElementById('mainTripDate');
        const sbtd = $('sbTripDate');
        if (mtd && sbtd && sbtd.value && (!mtd.value || mtd.value !== sbtd.value)) {
            mtd.value = sbtd.value;
        }
        const ms = document.getElementById('mainOutingStart');
        const t1 = $('sbTripStartTime');
        if (ms && t1 && t1.value && (!ms.value || ms.value !== t1.value)) {
            ms.value = t1.value;
        }
        const me = document.getElementById('mainOutingEnd');
        const t2 = $('sbTripEndTime');
        if (me && t2 && t2.value && (!me.value || me.value !== t2.value)) {
            me.value = t2.value;
        }
        const rs = document.getElementById('routeStartLocation');
        const sbs = $('sbStartLocation');
        if (rs && sbs && !isGeoEnabled && sbs.value.trim() !== rs.value.trim()) {
            rs.value = sbs.value;
        }
        if (typeof window.__recalcBudget === 'function') {
            window.__recalcBudget();
        }
    }

    function updateLinkedWorkspaceCard() {
        function setText(id, text) {
            const n = document.getElementById(id);
            if (n) n.textContent = text;
        }
        setText('linkCtxCategory', categoryLabel());
        const q = $('sbPlaceSearch');
        setText('linkCtxSearch', (q && q.value.trim()) || '—');
        const dt = $('sbTripDate');
        setText('linkCtxDate', (dt && dt.value) || '—');
        const a = $('sbTripStartTime');
        const b = $('sbTripEndTime');
        setText(
            'linkCtxOuting',
            a && b && a.value && b.value ? a.value + ' – ' + b.value : '—'
        );
        const nd = $('sbNumDays');
        setText('linkCtxDays', nd && nd.value ? nd.value + ' day(s)' : '—');
        setText(
            'linkCtxStart',
            isGeoEnabled ? 'GPS (trip map)' : ($('sbStartLocation') && $('sbStartLocation').value.trim()) || '—'
        );
        const om = $('sbOvMap');
        setText('linkCtxPlacesLine', om ? om.textContent : '—');
    }

    function pullMainIntoSidebarValuesOnly() {
        workspaceSyncFromMain = true;
        try {
            const daysEl = document.getElementById('days');
            const sbDays = $('sbNumDays');
            if (daysEl && sbDays && daysEl.value) {
                sbDays.value = String(Math.max(1, Math.min(365, parseInt(daysEl.value, 10) || 1)));
            }
            const mtd = document.getElementById('mainTripDate');
            const sbtd = $('sbTripDate');
            if (mtd && sbtd && mtd.value) {
                sbtd.value = mtd.value;
            }
            const ms = document.getElementById('mainOutingStart');
            const t1 = $('sbTripStartTime');
            if (ms && t1 && ms.value) {
                t1.value = ms.value;
            }
            const me = document.getElementById('mainOutingEnd');
            const t2 = $('sbTripEndTime');
            if (me && t2 && me.value) {
                t2.value = me.value;
            }
            const rs = document.getElementById('routeStartLocation');
            const sbs = $('sbStartLocation');
            if (rs && sbs && rs.value) {
                sbs.value = rs.value;
            }
        } finally {
            workspaceSyncFromMain = false;
        }
    }

    function applyMainToSidebar(patch) {
        patch = patch || {};
        workspaceSyncFromMain = true;
        try {
            if (patch.days != null && String(patch.days).trim() !== '' && $('sbNumDays')) {
                $('sbNumDays').value = String(
                    Math.max(1, Math.min(365, parseInt(patch.days, 10) || 1))
                );
            }
            if (patch.tripDate && $('sbTripDate')) {
                $('sbTripDate').value = patch.tripDate;
            }
            if (patch.outingStart && $('sbTripStartTime')) {
                $('sbTripStartTime').value = patch.outingStart;
            }
            if (patch.outingEnd && $('sbTripEndTime')) {
                $('sbTripEndTime').value = patch.outingEnd;
            }
            if (patch.routeStart != null && $('sbStartLocation') && !isGeoEnabled) {
                $('sbStartLocation').value = patch.routeStart;
            }
            updateTripOverview();
        } finally {
            workspaceSyncFromMain = false;
        }
    }

    function updateTripOverview() {
        try {
            const openList = getFilteredPlaces();
            const baseList = getSearchCategoryFiltered();
            const locEl = $('sbOvLocation');
            const schedEl = $('sbOvSchedule');
            const spanEl = $('sbOvSpan');
            const mapEl = $('sbOvMap');
            const placeListEl = $('sbOvPlaceList');
            const startLocationInput = $('sbStartLocation');

            if (!locEl || !startLocationInput || !schedEl || !spanEl || !mapEl || !placeListEl) {
                return;
            }

            locEl.textContent = isGeoEnabled
                ? 'GPS — location when you show the trip map'
                : startLocationInput.value.trim() || '—';

            const d = $('sbTripDate') && $('sbTripDate').value;
            const t1 = $('sbTripStartTime') && $('sbTripStartTime').value;
            const t2 = $('sbTripEndTime') && $('sbTripEndTime').value;
            if (d || t1 || t2) {
                schedEl.textContent = [d || '—', t1 && t2 ? t1 + ' – ' + t2 : t1 || t2 || '—'].join(' · ');
            } else {
                schedEl.textContent = '—';
            }

            const days = $('sbNumDays') && $('sbNumDays').value.trim();
            spanEl.textContent = days ? days + ' day(s)' : '—';

            const orderedFull = orderPlacesForItinerary(openList.slice(), null, null);
            const durCapOv = applyOutingDurationCap(orderedFull);
            const ordered = applyCachedRoadOrder(durCapOv.list);
            const nd = Math.max(1, parseInt($('sbNumDays') && $('sbNumDays').value, 10) || 1);
            if (filtersApplied) {
                const om = getOutingDurationMinutes();
                mapEl.textContent = durCapOv.capped
                    ? ordered.length +
                      ' planned stop(s) of ' +
                      openList.length +
                      ' open (~' +
                      om +
                      ' min outing) · ' +
                      nd +
                      ' day(s) · ' +
                      categoryLabel()
                    : ordered.length +
                      ' open stop(s) · nearest-distance order · ' +
                      nd +
                      ' day(s) · ' +
                      categoryLabel();
            } else if (baseList.length && openList.length !== baseList.length) {
                mapEl.textContent =
                    openList.length +
                    ' open (of ' +
                    baseList.length +
                    ' matches) · ' +
                    categoryLabel() +
                    ' — tap Apply filters & show map to view';
            } else {
                mapEl.textContent =
                    openList.length +
                    ' open place(s) · ' +
                    categoryLabel() +
                    ' — tap Apply filters & show map for route + stops';
            }

            placeListEl.textContent = '';
            if (!places.length) {
                placeListEl.textContent = 'Loading places…';
                return;
            }
            if (baseList.length === 0) {
                placeListEl.textContent = 'No rows match search/category. Try All or clear search.';
                return;
            }
            if (openList.length === 0) {
                const msg = document.createElement('div');
                msg.className = 'ov-msg ov-msg--warn';
                msg.textContent =
                    baseList.length +
                    ' place(s) match your filter but none overlap your outing hours. Widen start–end times or change filter.';
                placeListEl.appendChild(msg);
                return;
            }
            const chunks = splitIntoDays(ordered, nd);
            const wrap = document.createElement('div');
            wrap.className = 'ov-itin';

            const t1v = $('sbTripStartTime') && $('sbTripStartTime').value;
            const t2v = $('sbTripEndTime') && $('sbTripEndTime').value;
            const hint = document.createElement('div');
            hint.className = 'ov-hint';
            hint.textContent =
                t1v && t2v
                    ? 'Outing ' +
                      t1v +
                      ' – ' +
                      t2v +
                      ': places must overlap a CSV timings slot. Visit list is nearest-distance among open stops, then limited to ~' +
                      MINUTES_BUDGET_PER_STOP +
                      ' min per stop so short trips do not list every venue.'
                    : 'Set outing start and end. Filtering uses timings slots; list length scales with outing duration.';
            wrap.appendChild(hint);

            const perDayCap = 14;
            let dayStartIndex = 0;
            chunks.forEach(function (chunk, di) {
                if (!chunk.length) return;
                const h = document.createElement('div');
                h.className = 'ov-day-title';
                h.textContent = 'Day ' + (di + 1) + ' — ' + chunk.length + ' stop(s)';
                wrap.appendChild(h);
                const ul = document.createElement('ul');
                ul.className = 'ov-ul';
                chunk.forEach(function (p, ci) {
                    if (ci >= perDayCap) return;
                    const stopNum = dayStartIndex + ci + 1;
                    const li = document.createElement('li');
                    li.textContent = stopNum + '. ' + p.name + ' (' + formatPlaceHoursForLegend(p) + ')';
                    ul.appendChild(li);
                });
                if (chunk.length > perDayCap) {
                    const li = document.createElement('li');
                    li.className = 'ov-more';
                    li.textContent = '+ ' + (chunk.length - perDayCap) + ' more this day…';
                    ul.appendChild(li);
                }
                dayStartIndex += chunk.length;
                wrap.appendChild(ul);
            });
            placeListEl.appendChild(wrap);
        } finally {
            updateLinkedWorkspaceCard();
            if (!workspaceSyncFromMain) {
                syncSidebarToMainWorkspace();
            }
        }
    }

    function emitShowTripMapOnBudgetPage() {
        window.dispatchEvent(
            new CustomEvent('budget-show-trip-map', {
                bubbles: true,
                detail: {}
            })
        );
    }

    function setGeo(on) {
        isGeoEnabled = on;
        const geoToggle = $('sbGeoToggle');
        const gpsStatus = $('sbGpsStatus');
        const startLocationGroup = $('sbStartLocationGroup');
        const gpsFailedGroup = $('sbGpsFailedGroup');
        const startLocationInput = $('sbStartLocation');
        if (!geoToggle || !gpsStatus || !startLocationGroup || !gpsFailedGroup || !startLocationInput) return;

        geoToggle.classList.toggle('active', on);
        if (on) {
            gpsStatus.textContent = 'GPS on — your position is used on the trip map when shown';
            gpsStatus.classList.add('on');
            startLocationGroup.classList.add('hidden');
            gpsFailedGroup.classList.remove('hidden');
            startLocationInput.removeAttribute('required');
        } else {
            gpsStatus.textContent = 'GPS off — enter location below';
            gpsStatus.classList.remove('on');
            startLocationGroup.classList.remove('hidden');
            gpsFailedGroup.classList.add('hidden');
            startLocationInput.setAttribute('required', 'required');
        }
        updateTripOverview();
    }

    function init() {
        const chipsRoot = $('sbCategoryChips');
        if (!chipsRoot) return;

        chipsRoot.addEventListener('click', function (e) {
            const btn = e.target.closest('.chip');
            if (!btn) return;
            selectedCategory = btn.getAttribute('data-cat') || 'all';
            chipsRoot.querySelectorAll('.chip').forEach(function (c) {
                c.classList.toggle('active', c === btn);
            });
            updateTripOverview();
        });

        const placeSearch = $('sbPlaceSearch');
        if (placeSearch) {
            placeSearch.addEventListener('input', function () {
                updateTripOverview();
            });
        }

        const applyBtn = $('sbApplyFilters');
        if (applyBtn) {
            applyBtn.addEventListener('click', function () {
                emitShowTripMapOnBudgetPage();
            });
        }

        ['sbTripStartTime', 'sbTripEndTime', 'sbTripDate', 'sbNumDays'].forEach(function (id) {
            const el = $(id);
            if (!el) return;
            el.addEventListener('change', function () {
                updateTripOverview();
            });
            if (id === 'sbTripStartTime' || id === 'sbTripEndTime') {
                el.addEventListener('input', function () {
                    updateTripOverview();
                });
            }
        });

        const geoToggle = $('sbGeoToggle');
        if (geoToggle) {
            geoToggle.addEventListener('click', function () {
                setGeo(!isGeoEnabled);
            });
            geoToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setGeo(!isGeoEnabled);
                }
            });
        }

        const tripForm = $('sbTripForm');
        if (tripForm) {
            tripForm.addEventListener('submit', function (e) {
                e.preventDefault();
                const startLocationInput = $('sbStartLocation');
                const formData = {
                    gpsEnabled: isGeoEnabled,
                    location: isGeoEnabled ? 'Auto-detected by GPS' : startLocationInput && startLocationInput.value,
                    startTime: $('sbTripStartTime') && $('sbTripStartTime').value,
                    endTime: $('sbTripEndTime') && $('sbTripEndTime').value,
                    date: $('sbTripDate') && $('sbTripDate').value,
                    days: $('sbNumDays') && $('sbNumDays').value,
                    filteredPlaces: getFilteredPlaces().map(function (p) {
                        return p.name;
                    })
                };
                console.log('Trip Details (budget sidebar):', formData);
                const successMessage = $('sbSuccessMessage');
                if (successMessage) {
                    successMessage.style.display = 'block';
                    window.setTimeout(function () {
                        successMessage.style.display = 'none';
                    }, 2500);
                }
            });

            tripForm.addEventListener('input', function () {
                updateTripOverview();
            });
            tripForm.addEventListener('change', function () {
                updateTripOverview();
            });
            tripForm.addEventListener('reset', function () {
                window.setTimeout(function () {
                    selectedCategory = 'all';
                    if (chipsRoot) {
                        chipsRoot.querySelectorAll('.chip').forEach(function (c) {
                            c.classList.toggle('active', (c.getAttribute('data-cat') || '') === 'all');
                        });
                    }
                    isGeoEnabled = false;
                    const g = $('sbGeoToggle');
                    if (g) g.classList.remove('active');
                    setGeo(false);
                    updateTripOverview();
                }, 0);
            });
        }

        const startLocationInput = $('sbStartLocation');
        if (startLocationInput) {
            startLocationInput.addEventListener('input', function () {
                updateTripOverview();
            });
        }

        const td = $('sbTripDate');
        if (td && !td.value) td.value = new Date().toISOString().split('T')[0];
        const ts = $('sbTripStartTime');
        const te = $('sbTripEndTime');
        if (ts && !ts.value) ts.value = '09:00';
        if (te && !te.value) te.value = '21:00';
        const nd = $('sbNumDays');
        if (nd && !nd.value) nd.value = '1';

        const sbnd = $('sbNumDays');
        if (sbnd) {
            sbnd.addEventListener('input', function () {
                updateTripOverview();
            });
        }

        window.budgetTripPlacesReady = loadPlaces().then(function () {
            updateTripOverview();
            window.budgetTripRouteApi = {
                getFilteredPlaces: getFilteredPlaces,
                getOrderedStopsForBudgetMap: getOrderedStopsForBudgetMap
            };
        });
    }

    window.budgetSidebarBridge = {
        applyMainToSidebar: applyMainToSidebar,
        pullFromMain: function () {
            pullMainIntoSidebarValuesOnly();
            updateTripOverview();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
