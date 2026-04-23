// ─── Data ───────────────────────────────────────────────
const subjectsData = {
    "English HL": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P3 May-June 2025"],
    "Afrikaans FAL": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P3 May-June 2025"],
    "Mathematics": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P2 Nov 2021"],
    "Business Studies": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P2 Nov 2021"],
    "Physical Science": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P2 Nov 2021"],
    "Life Sciences": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P2 Nov 2021"]
};

const allPapers = [];
Object.entries(subjectsData).forEach(([subj, papers]) => {
    papers.forEach(p => allPapers.push({ subject: subj, name: p }));
});

const startDate = new Date(2026, 3, 8);
const endDate   = new Date(2026, 4, 10);
const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

// ─── Automatic Cloud Sync Config ────────────────────────
const SUPABASE_URL = "https://hxzevmvijojcfhmgewku.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4emV2bXZpam9qY2ZobWdld2t1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NTcxOTIsImV4cCI6MjA5MTEzMzE5Mn0.xg6C6LoXJMXWZ9CFLk1fOxjqUchWJ2uh4UPhjiW6O38";
const AUTO_SYNC_ID = 'exam-master-shared-2026';
let realtimeChannel = null;
let isSyncingFromRemote = false;

// ─── Marks Store (persisted to localStorage) ────────────
const MARKS_KEY = 'exam_master_marks';
const CHECKS_KEY = 'exam_master_checks';

function loadMarks() {
    try { return JSON.parse(localStorage.getItem(MARKS_KEY)) || {}; } catch { return {}; }
}
function saveMarks(m) { 
    localStorage.setItem(MARKS_KEY, JSON.stringify(m)); 
    pushToCloud();
}

function loadChecks() {
    try { return JSON.parse(localStorage.getItem(CHECKS_KEY)) || {}; } catch { return {}; }
}
function saveChecks(c) { 
    localStorage.setItem(CHECKS_KEY, JSON.stringify(c)); 
    pushToCloud();
}

// ─── Automatic Cloud Sync (REST API + Realtime) ─────────
function supaFetch(path, options = {}) {
    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        ...options.headers
    };
    return fetch(SUPABASE_URL + '/rest/v1/' + path, { ...options, headers })
        .catch(err => { console.warn('Cloud sync unavailable:', err); return null; });
}

// Push current local state to Supabase and broadcast to all other clients
async function pushToCloud() {
    if (isSyncingFromRemote) return; // Prevent echo loops

    const marks = loadMarks();
    const checks = loadChecks();
    const payload = { 
        sync_id: AUTO_SYNC_ID, 
        marks: marks, 
        checks: checks, 
        updated_at: new Date().toISOString() 
    };

    // 1. Save to database
    const resp = await supaFetch('study_sync', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload)
    });

    if (resp && !resp.ok) {
        const text = await resp.text();
        console.warn('Cloud save issue:', text);
    }

    // 2. Broadcast change to all connected clients via Realtime channel
    if (realtimeChannel) {
        try {
            realtimeChannel.send({
                type: 'broadcast',
                event: 'sync_update',
                payload: { marks, checks }
            });
        } catch (e) {
            console.warn('Broadcast failed:', e);
        }
    }
}

// Pull latest state from Supabase on load
async function pullFromCloud() {
    const resp = await supaFetch('study_sync?sync_id=eq.' + encodeURIComponent(AUTO_SYNC_ID) + '&select=*', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
    });

    if (!resp || !resp.ok) return false;

    const rows = await resp.json();
    if (!rows || rows.length === 0) return false;

    const data = rows[0];
    if (data.marks) localStorage.setItem(MARKS_KEY, JSON.stringify(data.marks));
    if (data.checks) localStorage.setItem(CHECKS_KEY, JSON.stringify(data.checks));
    
    return true;
}

// Apply incoming remote data and refresh the UI
function applyRemoteData(payload) {
    isSyncingFromRemote = true;
    
    if (payload.marks) localStorage.setItem(MARKS_KEY, JSON.stringify(payload.marks));
    if (payload.checks) localStorage.setItem(CHECKS_KEY, JSON.stringify(payload.checks));

    // Determine active filter
    const activeNav = document.querySelector('.nav-item.active');
    const filterSubject = activeNav && activeNav.dataset.subject !== 'all' ? activeNav.dataset.subject : null;

    generateSchedule(filterSubject);
    updateAverages();
    updateSessionCount();

    isSyncingFromRemote = false;
}

// Connect to Supabase Realtime to listen for changes from other devices
function connectRealtime() {
    const wsUrl = SUPABASE_URL.replace('https://', 'wss://') + '/realtime/v1/websocket?apikey=' + SUPABASE_KEY + '&vsn=1.0.0';
    const ws = new WebSocket(wsUrl);
    const channelTopic = 'realtime:exam-master-live';

    ws.onopen = () => {
        console.log('Realtime: connected');
        // Join the channel
        ws.send(JSON.stringify({
            topic: channelTopic,
            event: 'phx_join',
            payload: { config: { broadcast: { self: false } } },
            ref: '1'
        }));

        // Keep alive with heartbeat every 30s
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    topic: 'phoenix',
                    event: 'heartbeat',
                    payload: {},
                    ref: Date.now().toString()
                }));
            }
        }, 30000);
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.event === 'broadcast' && msg.payload && msg.payload.event === 'sync_update') {
                console.log('Realtime: received remote update');
                applyRemoteData(msg.payload.payload);
            }
        } catch (e) {
            // Ignore non-JSON or system messages
        }
    };

    ws.onclose = () => {
        console.log('Realtime: disconnected, reconnecting in 3s...');
        setTimeout(connectRealtime, 3000);
    };

    ws.onerror = (err) => {
        console.warn('Realtime error:', err);
    };

    // Expose send capability for broadcasts
    realtimeChannel = {
        send: (message) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    topic: channelTopic,
                    event: 'broadcast',
                    payload: message.payload ? message : { event: message.event, payload: message.payload || message },
                    ref: Date.now().toString()
                }));
            }
        }
    };
}

// Auto-sync initialisation (called once on DOMContentLoaded)
async function initAutoSync() {
    // 1. Pull latest cloud data
    const pulled = await pullFromCloud();
    if (pulled) {
        generateSchedule();
        updateAverages();
        updateSessionCount();
    } else {
        // First time — push local data up
        await pushToCloud();
    }

    // 2. Connect Realtime for live updates
    connectRealtime();

    // 3. Periodic poll as fallback (every 30 seconds)
    setInterval(async () => {
        const refreshed = await pullFromCloud();
        if (refreshed) {
            isSyncingFromRemote = true;
            const activeNav = document.querySelector('.nav-item.active');
            const filterSubject = activeNav && activeNav.dataset.subject !== 'all' ? activeNav.dataset.subject : null;
            generateSchedule(filterSubject);
            updateAverages();
            updateSessionCount();
            isSyncingFromRemote = false;
        }
    }, 30000);
}

// ─── Schedule Generation ────────────────────────────────
function generateSchedule(filterSubject = null) {
    const listEl = document.getElementById('schedule-list');
    listEl.innerHTML = '';
    const checks = loadChecks();

    const subjQueues = {};
    Object.keys(subjectsData).forEach(s => subjQueues[s] = [...subjectsData[s]]);
    const subjKeys = Object.keys(subjectsData);
    let subjIdx = 0;
    let sundayCount = 0;

    for (let i = 0; i < totalDays; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        const dayOfWeek = currentDate.getDay();

        if (dayOfWeek === 0) {
            sundayCount++;
            if (sundayCount % 2 === 0) {
                if (!filterSubject) {
                    const dateStr = currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
                    const card = document.createElement('div');
                    card.className = 'day-card animate-fade';
                    card.innerHTML = `
                        <div class="day-header">
                            <span class="day-date">${dateStr}</span>
                            <span class="subject-tag" style="background:var(--secondary);color:#fff;">RECHARGE DAY</span>
                        </div>
                        <div class="break-row" style="background:rgba(230, 126, 34, 0.05); border-color:var(--secondary);">
                            ☕ Rest & Review previous subjects
                        </div>`;
                    listEl.appendChild(card);
                }
                continue;
            }
        }

        let activeSubj = subjKeys[subjIdx % subjKeys.length];
        let q = subjQueues[activeSubj];
        
        let attempts = 0;
        while (q.length === 0 && attempts < subjKeys.length) {
            subjIdx++;
            activeSubj = subjKeys[subjIdx % subjKeys.length];
            q = subjQueues[activeSubj];
            attempts++;
        }
        
        subjIdx++;

        const card = document.createElement('div');
        card.className = 'day-card animate-fade';
        card.style.animationDelay = `${i * 0.03}s`;

        const dateStr = currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

        let html = `
            <div class="day-header">
                <span class="day-date">${dateStr}</span>
                <span class="subject-tag" style="background:${dayOfWeek === 0 ? 'var(--secondary)' : 'var(--primary)'};color:#fff;">${q.length > 0 ? (dayOfWeek === 0 ? `SUNDAY FOCUS: ${activeSubj}` : activeSubj) : 'ALL DONE'}</span>
            </div>
            <div class="sittings-list">`;

        // TWO Sessions per Day (Guided Morning + Exam Afternoon) IF SAME PAPER TYPE
        if (q.length >= 2 && q[0].split(' ')[0] === q[1].split(' ')[0]) {
            const p1Name = q.shift();
            const p2Name = q.shift();
            
            const gPaper = { subject: activeSubj, name: p1Name };
            const ePaper = { subject: activeSubj, name: p2Name };
            
            const gId = `sched_g_${activeSubj}_${p1Name}`.replace(/\s+/g,'_');
            const eId = `sched_e_${activeSubj}_${p2Name}`.replace(/\s+/g,'_');

            // Morning – Guided
            html += sittingHTML(gPaper, 'Guided', '08:30 – 13:30', gId, checks[gId]);

            // Break
            html += `<div class="break-row">🥪 13:30 – 15:00 &nbsp;Break</div>`;

            // Afternoon – Exam (Same Paper Type, different year)
            html += sittingHTML(ePaper, 'Exam Condition', '15:00 – 18:00', eId, checks[eId]);
        } else if (q.length >= 1) {
            // Single session if only one paper left or paper types don't match
            const pName = q.shift();
            const id = `sched_e_${activeSubj}_${pName}`.replace(/\s+/g,'_');
            html += sittingHTML({subject:activeSubj, name:pName}, 'Exam Condition', '08:30 – 11:30', id, checks[id]);
        }



        html += `</div>`;
        card.innerHTML = html;
        
        // Append only if we aren't filtering, or if it strictly matches the filter
        if (!filterSubject || activeSubj === filterSubject) {
            listEl.appendChild(card);
        }
    }
}

function sittingHTML(paper, type, time, checkId, checked) {
    const cls    = type === 'Guided' ? 'type-guided' : 'type-exam';
    const border = type === 'Guided' ? 'var(--primary)' : 'var(--secondary)';
    const chk    = checked ? 'checked' : '';
    const marks  = loadMarks();
    const markKey = `mark_${checkId}`;
    const savedMark = marks[markKey] !== undefined ? marks[markKey] : '';

    const markField = type === 'Exam Condition' ? `
        <div class="mark-wrapper">
            <label>Mark %</label>
            <input type="number" min="0" max="100" placeholder="–" class="mark-input"
                data-mark="${markKey}" value="${savedMark}" oninput="saveMarkInline(this)">
        </div>` : '<div class="mark-wrapper"></div>';

    return `
        <div class="sitting ${chk ? 'done' : ''}" style="border-left-color: ${border}">
            <input type="checkbox" class="session-check" data-id="${checkId}" ${checked ? 'checked' : ''} onchange="toggleCheck(this)">
            <span class="sitting-type ${cls}">${type}</span>
            <span class="sitting-time">🕐 ${time}</span>
            <span class="paper-name" title="${paper.name}">${paper.name}</span>
            ${markField}
        </div>`;
}


function saveMarkInline(el) {
    const marks = loadMarks();
    const val = el.value.trim();
    if (val === '') { delete marks[el.dataset.mark]; }
    else { marks[el.dataset.mark] = Number(val); }
    saveMarks(marks);
    updateAverages();
}


function toggleCheck(el) {
    const checks = loadChecks();
    checks[el.dataset.id] = el.checked;
    saveChecks(checks);
    updateSessionCount();
}

function updateSessionCount() {
    const checks = loadChecks();
    const done = Object.values(checks).filter(Boolean).length;
    
    const sessEl = document.getElementById('sessions-done');
    if (sessEl) sessEl.textContent = done;

    const targetEl = document.getElementById('target-count');
    if (targetEl) targetEl.textContent = allPapers.length;

    const pct = Math.round((done / allPapers.length) * 100);
    const pctEl = document.getElementById('overall-percent');
    if (pctEl) pctEl.textContent = pct + '%';
    
    const barEl = document.getElementById('progress-bar');
    if (barEl) barEl.style.width = pct + '%';
}


function updateAverages() {
    const marks = loadMarks();
    let totalSum = 0, totalCount = 0;

    Object.keys(subjectsData).forEach(subj => {
        const subjKey = subj.replace(/\s+/g, '_');
        const subjMarks = [];

        Object.keys(marks).forEach(key => {
            if (
                (key.startsWith(`mark_sched_e_${subjKey}_`) ||
                 key.startsWith(`mark_sched_e2_${subjKey}_`)) &&
                marks[key] !== undefined
            ) {
                subjMarks.push(Number(marks[key]));
            }
        });

        const avg = subjMarks.length > 0
            ? Math.round(subjMarks.reduce((a, b) => a + b, 0) / subjMarks.length)
            : null;

        if (avg !== null) {
            totalSum += subjMarks.reduce((a, b) => a + b, 0);
            totalCount += subjMarks.length;
        }

        const bar   = avg || 0;
        const color = bar >= 70 ? 'var(--success)' : bar >= 50 ? 'var(--secondary)' : bar > 0 ? 'var(--danger)' : 'var(--glass)';

        const sidebarVal = document.getElementById(`sidebar-avg-${subjKey}`);
        const sidebarBar = document.getElementById(`sidebar-bar-${subjKey}`);
        if (sidebarVal) {
            sidebarVal.textContent = avg !== null ? avg + '%' : '–';
            sidebarVal.style.color = avg !== null ? color : 'var(--text-muted)';
        }
        if (sidebarBar) {
            sidebarBar.style.width = bar + '%';
            sidebarBar.style.background = color;
        }
    });

    const overallAvg = totalCount > 0 ? Math.round(totalSum / totalCount) : null;
    const overallEl  = document.getElementById('sidebar-overall-avg');
    if (overallEl) {
        overallEl.textContent = overallAvg !== null ? overallAvg + '%' : '–';
        overallEl.style.color = (overallAvg >= 70) ? 'var(--success)' : (overallAvg >= 50 ? 'var(--secondary)' : 'var(--danger)');
    }
}

// ─── Sidebar Navigation ─────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        const subj = item.dataset.subject;
        generateSchedule(subj === 'all' ? null : subj);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Close mobile sidebar
        document.querySelector('aside').classList.remove('sidebar-open');
        const menuBtn = document.getElementById('mobile-menu-btn');
        if (menuBtn) menuBtn.classList.remove('active');
    });
});

// ─── Pomodoro Timer ─────────────────────────────────────
const TIMER_MODES = {
    pomodoro: { label: 'Pomodoro – Guided Session', minutes: 40 },
    short:    { label: 'Short Break', minutes: 10 },
    lunch:    { label: 'Lunch Break Timer', minutes: 60 }
};

let currentMode = 'pomodoro';
let timeLeft = 40 * 60; // seconds
let timerInterval = null;
let timerRunning = false;

function setTimerMode(mode) {
    currentMode = mode;
    timeLeft = TIMER_MODES[mode].minutes * 60;
    timerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    renderTimer();

    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.mode-btn[onclick="setTimerMode('${mode}')"]`).classList.add('active');
    document.getElementById('timer-label').textContent = TIMER_MODES[mode].label;
    document.getElementById('timer-start-btn').textContent = 'Start';
    document.getElementById('timer-start-btn').className = 'timer-btn btn-start';
}

function renderTimer() {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    document.getElementById('timer-display').textContent =
        String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function adjustTimer(seconds) {
    timeLeft += seconds;
    if (timeLeft < 0) timeLeft = 0;
    renderTimer();
}

function toggleTimer() {
    if (timerRunning) {
        clearInterval(timerInterval);
        timerRunning = false;
        document.getElementById('timer-start-btn').textContent = 'Resume';
        document.getElementById('timer-start-btn').className = 'timer-btn btn-start';
    } else {
        timerRunning = true;
        document.getElementById('timer-start-btn').textContent = 'Pause';
        document.getElementById('timer-start-btn').className = 'timer-btn btn-pause';
        timerInterval = setInterval(() => {
            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                timerRunning = false;
                document.getElementById('timer-start-btn').textContent = 'Start';
                document.getElementById('timer-start-btn').className = 'timer-btn btn-start';
                
                showTimerModal();
                
                try { new Audio('data:audio/wav;base64,UklGRhwFAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YfgEAACAf3+AgICAgICAgH+AgICBgIGCgoOEhYaIiouNjpGSlZaZm52goqutr7G0t7q7vsHDxsfJy83P0NLU1tfZ2tvd3t/h4uPk5ebn5+jo6enq6uvr6+zs7O3t7e3t7u7u7u7u7u7u7u7u7u3t7Ozr6+rq6ejn5uXk4+Lh39/d3NrZ19XU0tHPzszLycfFw8G+vLq4trSwrqyqqKWjoJ6cmpmXlZSTkpGQj46Njo2NjIyMjIyNjY6Oj5CRkpOUlZaYmZucnZ6goaOkpaeoqautr7CytLW3uLq8vb/Aw8TGyMnLzM3P0NLT1NXW2Nna29ze3uDh4uPk5ebn6Onp6uvs7O3t7u7u7+/w8PDw8fHx8fHx8fHx8fHx8PDw7+/u7u7t7ezs6+vq6eno5+bm5eTj4uHg397d3NrZ2NbV1NPR0M/NzMvKyMfGxcTDwsHAwL++vr2m').play(); } catch(e){}
                return;
            }
            timeLeft--;
            renderTimer();
        }, 1000);
    }
}

function showTimerModal() {
    const modal = document.getElementById('pomodoro-modal');
    const title = document.getElementById('modal-title');
    const msg = document.getElementById('modal-msg');
    const btn = document.getElementById('modal-action-btn');

    if (currentMode === 'pomodoro') {
        title.textContent = "Session Complete!";
        msg.textContent = "Powerful study session! Take a 10 minute break.";
        btn.textContent = "Start Break Now";
    } else {
        title.textContent = "Break's Over!";
        msg.textContent = "Recharged? Let's get back to the preparation.";
        btn.textContent = "Start Next Session";
    }
    modal.classList.add('active');
}

function closeTimerModal() {
    document.getElementById('pomodoro-modal').classList.remove('active');
    // Switch mode
    if (currentMode === 'pomodoro') setTimerMode('short');
    else setTimerMode('pomodoro');
    // Start automatically
    toggleTimer();
}

function resetTimer() {
    clearInterval(timerInterval);
    timerRunning = false;
    timeLeft = TIMER_MODES[currentMode].minutes * 60;
    renderTimer();
    document.getElementById('timer-start-btn').textContent = 'Start';
    document.getElementById('timer-start-btn').className = 'timer-btn btn-start';
}

// ─── Exam Countdown ────────────────────────────────────
const EXAM_TARGET = new Date(2026, 4, 11, 14, 0, 0); // 11 May 2026 at 14:00

function updateExamCountdown() {
    const elBanner = document.getElementById('exam-countdown-banner');
    if (!elBanner) return;

    const diff = EXAM_TARGET - new Date();

    if (diff <= 0) {
        elBanner.innerHTML = `<div style="font-size:1rem;font-weight:800;letter-spacing:2px;color:white;">🎉 EXAM HAS STARTED — GOOD LUCK!</div>`;
        return;
    }

    const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs  = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (num) => num < 10 ? '0' + num : num;

    const d = document.getElementById('cd-days');
    const h = document.getElementById('cd-hours');
    const m = document.getElementById('cd-mins');
    const s = document.getElementById('cd-secs');

    if (d) d.textContent = pad(days);
    if (h) h.textContent = pad(hours);
    if (m) m.textContent = pad(mins);
    if (s) s.textContent = pad(secs);
}

// ─── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // 1. START COUNTDOWN
    updateExamCountdown();
    setInterval(updateExamCountdown, 1000);

    // 2. STATS & DATA – dynamic days remaining
    const cd = document.getElementById('days-countdown');
    if (cd) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const remaining = Math.max(0, Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)));
        cd.textContent = remaining;
    }
    
    // 3. GENERATE SCHEDULE IMMEDIATELY (always works, uses localStorage)
    try {
        generateSchedule();
        updateAverages();
        updateSessionCount();
        renderTimer();
    } catch (e) {
        console.error("Initialization error:", e);
    }

    // 4. AUTOMATIC CLOUD SYNC (non-blocking, no user action required)
    initAutoSync().catch(err => console.warn('Auto-sync error:', err));
});
