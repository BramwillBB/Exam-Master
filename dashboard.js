// ─── Shared Data (mirrors main app) ─────────────────────
const subjectsData = {
    "English HL": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P3 May-June 2025"],
    "Afrikaans FAL": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P3 May-June 2025"],
    "Mathematics": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P2 Nov 2021"],
    "Business Studies": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P2 Nov 2021"],
    "Physical Science": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P2 Nov 2021"],
    "Life Sciences": ["P1 May-June 2025","P1 Nov 2024","P1 Nov 2023","P1 Nov 2022","P1 Nov 2021","P2 May-June 2025","P2 Nov 2024","P2 Nov 2023","P2 Nov 2022","P2 Nov 2021"]
};

const startDate = new Date(2026, 3, 8);
const endDate   = new Date(2026, 4, 10);
const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

const MARKS_KEY  = 'exam_master_marks';
const CHECKS_KEY = 'exam_master_checks';
const POMO_LOG_KEY = 'exam_master_pomodoro_log';

function loadMarks()  { try { return JSON.parse(localStorage.getItem(MARKS_KEY))  || {}; } catch { return {}; } }
function loadChecks() { try { return JSON.parse(localStorage.getItem(CHECKS_KEY)) || {}; } catch { return {}; } }
function loadPomoLog(){ try { return JSON.parse(localStorage.getItem(POMO_LOG_KEY))|| []; } catch { return []; } }

// ─── Schedule Reconstruction ────────────────────────────
// Replays the exact same scheduling algorithm as script.js
// Returns: { sessionMap: { id: {date,subject,paper,type} }, dateMap: { 'YYYY-MM-DD': [ids] } }
function buildScheduleMap() {
    const sessionMap = {};
    const dateMap = {};
    const subjQueues = {};
    Object.keys(subjectsData).forEach(s => subjQueues[s] = [...subjectsData[s]]);
    const subjKeys = Object.keys(subjectsData);
    let subjIdx = 0, sundayCount = 0;

    for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const dow = d.getDay();
        const ds = d.toISOString().split('T')[0];

        if (dow === 0) {
            sundayCount++;
            if (sundayCount % 2 === 0) continue;
        }

        let subj = subjKeys[subjIdx % subjKeys.length];
        let q = subjQueues[subj];
        let attempts = 0;
        while (q.length === 0 && attempts < subjKeys.length) {
            subjIdx++;
            subj = subjKeys[subjIdx % subjKeys.length];
            q = subjQueues[subj];
            attempts++;
        }
        subjIdx++;
        if (!dateMap[ds]) dateMap[ds] = [];

        if (q.length >= 2 && q[0].split(' ')[0] === q[1].split(' ')[0]) {
            const p1 = q.shift(), p2 = q.shift();
            const gId = `sched_g_${subj}_${p1}`.replace(/\s+/g,'_');
            const eId = `sched_e_${subj}_${p2}`.replace(/\s+/g,'_');
            sessionMap[gId] = { date: ds, subject: subj, paper: p1, type: 'Guided' };
            sessionMap[eId] = { date: ds, subject: subj, paper: p2, type: 'Exam' };
            dateMap[ds].push(gId, eId);
        } else if (q.length >= 1) {
            const p = q.shift();
            const id = `sched_e_${subj}_${p}`.replace(/\s+/g,'_');
            sessionMap[id] = { date: ds, subject: subj, paper: p, type: 'Exam' };
            dateMap[ds].push(id);
        }
    }
    return { sessionMap, dateMap };
}

// ─── Analytics ──────────────────────────────────────────
function getSubjectAnalytics() {
    const marks = loadMarks();
    const checks = loadChecks();
    const { sessionMap } = buildScheduleMap();
    const results = {};

    Object.keys(subjectsData).forEach(subj => {
        const key = subj.replace(/\s+/g, '_');
        const totalPapers = subjectsData[subj].length;
        let completed = 0;
        const examMarks = [], guidedMarks = [], allMarks = [];

        // Count completions and collect marks
        Object.entries(sessionMap).forEach(([id, info]) => {
            if (info.subject !== subj) return;
            if (checks[id]) completed++;
            const mk = marks[`mark_${id}`];
            if (mk !== undefined && mk !== '') {
                const v = Number(mk);
                allMarks.push({ paper: info.paper, mark: v, type: info.type });
                if (info.type === 'Exam') examMarks.push(v);
                else guidedMarks.push(v);
            }
        });

        const examAvg = examMarks.length > 0 ? Math.round(examMarks.reduce((a,b) => a+b,0) / examMarks.length) : null;
        const guidedAvg = guidedMarks.length > 0 ? Math.round(guidedMarks.reduce((a,b) => a+b,0) / guidedMarks.length) : null;

        // Trend: compare first half vs second half of all marks
        let trend = 'flat';
        if (allMarks.length >= 4) {
            const half = Math.floor(allMarks.length / 2);
            const firstHalf = allMarks.slice(0, half).reduce((a,b) => a + b.mark, 0) / half;
            const secondHalf = allMarks.slice(half).reduce((a,b) => a + b.mark, 0) / (allMarks.length - half);
            if (secondHalf > firstHalf + 3) trend = 'up';
            else if (secondHalf < firstHalf - 3) trend = 'down';
        }

        // Weakest paper
        let weakest = null;
        if (allMarks.length > 0) {
            const sorted = [...allMarks].sort((a,b) => a.mark - b.mark);
            weakest = { paper: sorted[0].paper, mark: sorted[0].mark };
        }

        // Readiness score
        const completionScore = (completed / totalPapers) * 40;
        const examScore = examAvg !== null ? (examAvg / 100) * 40 : 0;
        const trendScore = trend === 'up' ? 20 : trend === 'flat' ? 10 : 0;
        const readiness = Math.round(completionScore + examScore + trendScore);

        results[subj] = { key, totalPapers, completed, examAvg, guidedAvg, trend, weakest, readiness, allMarks, examMarks, guidedMarks };
    });

    return results;
}

// ─── Chart Drawing Helpers ──────────────────────────────

function drawProgressRing(canvasId, pct) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2, r = 38, lw = 8;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#e8ecf1';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Progress arc
    const endAngle = -Math.PI / 2 + (Math.PI * 2 * (pct / 100));
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, endAngle);
    const color = pct >= 70 ? '#2ecc71' : pct >= 40 ? '#e67e22' : '#e74c3c';
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center text
    ctx.fillStyle = color;
    ctx.font = '800 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pct + '%', cx, cy);
}

function drawBarChart(container, subj, papers, marks) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `<h3>${subj}</h3>`;

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 160;
    card.appendChild(canvas);
    container.appendChild(card);

    const ctx = canvas.getContext('2d');
    const padding = { top: 10, right: 10, bottom: 35, left: 35 };
    const w = canvas.width - padding.left - padding.right;
    const h = canvas.height - padding.top - padding.bottom;

    // Y-axis lines
    ctx.strokeStyle = '#e8ecf1';
    ctx.lineWidth = 0.5;
    ctx.font = '500 9px Inter, sans-serif';
    ctx.fillStyle = '#95a5a6';
    ctx.textAlign = 'right';
    for (let y = 0; y <= 100; y += 25) {
        const py = padding.top + h - (y / 100 * h);
        ctx.beginPath();
        ctx.moveTo(padding.left, py);
        ctx.lineTo(padding.left + w, py);
        ctx.stroke();
        ctx.fillText(y + '%', padding.left - 4, py + 3);
    }

    if (papers.length === 0) {
        ctx.fillStyle = '#95a5a6';
        ctx.font = '600 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No marks recorded yet', canvas.width / 2, canvas.height / 2);
        return;
    }

    const barW = Math.min(28, (w / papers.length) * 0.7);
    const gap = w / papers.length;

    papers.forEach((p, i) => {
        const mark = marks[p.paper];
        const x = padding.left + i * gap + (gap - barW) / 2;
        const barH = mark !== undefined ? (mark / 100) * h : 0;
        const y = padding.top + h - barH;

        // Bar
        const color = mark >= 70 ? '#2ecc71' : mark >= 50 ? '#e67e22' : mark > 0 ? '#e74c3c' : '#e8ecf1';
        ctx.fillStyle = color;
        roundRect(ctx, x, y, barW, barH, 3);
        ctx.fill();

        // Label
        ctx.save();
        ctx.translate(x + barW / 2, padding.top + h + 6);
        ctx.rotate(-0.5);
        ctx.fillStyle = '#95a5a6';
        ctx.font = '500 7px Inter, sans-serif';
        ctx.textAlign = 'center';
        const label = p.paper.replace('May-June ', 'MJ').replace('Nov ', 'N');
        ctx.fillText(label, 0, 8);
        ctx.restore();

        // Value on top
        if (mark !== undefined) {
            ctx.fillStyle = '#2c3e50';
            ctx.font = '700 8px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(mark + '%', x + barW / 2, y - 4);
        }
    });
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawGauge(container, subj, score) {
    const card = document.createElement('div');
    card.className = 'gauge-card';

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 70;
    card.appendChild(canvas);

    const color = score >= 70 ? '#2ecc71' : score >= 40 ? '#e67e22' : '#e74c3c';
    card.innerHTML += `<div class="gauge-score" style="color:${color}">${score}</div>`;
    card.innerHTML += `<div class="gauge-label">${subj}</div>`;
    container.appendChild(card);

    const ctx = canvas.getContext('2d');
    const cx = 50, cy = 58, r = 40, lw = 8;
    const startA = Math.PI, endA = Math.PI * 2;

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startA, endA);
    ctx.strokeStyle = '#e8ecf1';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Score arc
    const scoreAngle = startA + (score / 100) * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startA, scoreAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
}

// ─── Section Renderers ──────────────────────────────────

function renderHeroStats() {
    const checks = loadChecks();
    const marks = loadMarks();
    const totalSessions = Object.keys(buildScheduleMap().sessionMap).length;
    const done = Object.values(checks).filter(Boolean).length;
    const pct = totalSessions > 0 ? Math.round((done / totalSessions) * 100) : 0;

    drawProgressRing('progress-ring', pct);
    document.getElementById('hero-completion').textContent = done + ' / ' + totalSessions;

    // Days remaining
    const today = new Date();
    today.setHours(0,0,0,0);
    const remaining = Math.max(0, Math.ceil((endDate - today) / (1000*60*60*24)));
    const daysEl = document.getElementById('hero-days');
    daysEl.textContent = remaining;

    // Pace
    const sessLeft = totalSessions - done;
    const pace = remaining > 0 ? (sessLeft / remaining).toFixed(1) : '∞';
    const paceEl = document.getElementById('hero-pace');
    paceEl.textContent = pace;
    paceEl.className = 'hero-big' + (pace > 3 ? ' bad' : pace > 2 ? ' warn' : ' good');

    // Overall exam average
    let examSum = 0, examCt = 0;
    Object.entries(marks).forEach(([k, v]) => {
        if (k.startsWith('mark_sched_e_') && v !== '' && v !== undefined) {
            examSum += Number(v);
            examCt++;
        }
    });
    const examAvg = examCt > 0 ? Math.round(examSum / examCt) : null;
    const avgEl = document.getElementById('hero-exam-avg');
    avgEl.textContent = examAvg !== null ? examAvg + '%' : '–';
    if (examAvg !== null) {
        avgEl.className = 'hero-big' + (examAvg >= 70 ? ' good' : examAvg >= 50 ? ' warn' : ' bad');
    }
}

function renderPerformanceTable() {
    const tbody = document.getElementById('perf-tbody');
    const analytics = getSubjectAnalytics();

    Object.entries(analytics).forEach(([subj, stats]) => {
        const trendIcon = stats.trend === 'up' ? '↗' : stats.trend === 'down' ? '↘' : '→';
        const trendClass = stats.trend === 'up' ? 'trend-up' : stats.trend === 'down' ? 'trend-down' : 'trend-flat';

        const guidedStr = stats.guidedAvg !== null ? `<span class="mark-badge ${stats.guidedAvg >= 70 ? 'mark-good' : stats.guidedAvg >= 50 ? 'mark-mid' : 'mark-bad'}">${stats.guidedAvg}%</span>` : '<span class="mark-none">–</span>';
        const examStr = stats.examAvg !== null ? `<span class="mark-badge ${stats.examAvg >= 70 ? 'mark-good' : stats.examAvg >= 50 ? 'mark-mid' : 'mark-bad'}">${stats.examAvg}%</span>` : '<span class="mark-none">–</span>';
        const weakStr = stats.weakest ? `${stats.weakest.paper} <span class="mark-badge mark-bad">${stats.weakest.mark}%</span>` : '<span class="mark-none">–</span>';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${subj}</strong></td>
            <td>${stats.completed} / ${stats.totalPapers}</td>
            <td>${guidedStr}</td>
            <td>${examStr}</td>
            <td><span class="${trendClass}">${trendIcon}</span></td>
            <td>${weakStr}</td>`;
        tbody.appendChild(row);
    });
}

function renderMarkDistribution() {
    const container = document.getElementById('mark-charts');
    const marks = loadMarks();
    const { sessionMap } = buildScheduleMap();

    Object.keys(subjectsData).forEach(subj => {
        const papers = [];
        const paperMarks = {};

        // Collect papers and their marks for this subject
        Object.entries(sessionMap).forEach(([id, info]) => {
            if (info.subject !== subj) return;
            const mk = marks[`mark_${id}`];
            if (!paperMarks[info.paper]) {
                papers.push({ paper: info.paper, type: info.type });
            }
            if (mk !== undefined && mk !== '') {
                paperMarks[info.paper] = Number(mk);
            }
        });

        drawBarChart(container, subj, papers, paperMarks);
    });
}

function renderStreakSection() {
    const checks = loadChecks();
    const { dateMap } = buildScheduleMap();

    // Calculate per-day completions
    const dayCompletions = {};
    Object.entries(dateMap).forEach(([date, ids]) => {
        const doneCount = ids.filter(id => checks[id]).length;
        if (doneCount > 0) dayCompletions[date] = doneCount;
    });

    const studyDates = Object.keys(dayCompletions).sort();
    document.getElementById('total-study-days').textContent = studyDates.length;

    // Calculate streaks
    let currentStreak = 0, longestStreak = 0, tempStreak = 0;
    const allDates = Object.keys(dateMap).sort();
    const today = new Date().toISOString().split('T')[0];

    for (let i = 0; i < allDates.length; i++) {
        if (dayCompletions[allDates[i]]) {
            tempStreak++;
            longestStreak = Math.max(longestStreak, tempStreak);
        } else {
            tempStreak = 0;
        }
    }

    // Current streak: count backwards from today/latest
    currentStreak = 0;
    for (let i = allDates.length - 1; i >= 0; i--) {
        if (allDates[i] > today) continue;
        if (dayCompletions[allDates[i]]) currentStreak++;
        else break;
    }

    document.getElementById('current-streak').textContent = currentStreak;
    document.getElementById('longest-streak').textContent = longestStreak;

    // Heatmap
    const heatmap = document.getElementById('heatmap');
    // Day-of-week headers
    ['M','T','W','T','F','S','S'].forEach(d => {
        const lbl = document.createElement('div');
        lbl.className = 'heatmap-label';
        lbl.textContent = d;
        heatmap.appendChild(lbl);
    });

    // Pad to start on correct day of week (Wed = 3)
    const firstDow = new Date(startDate).getDay();
    const padDays = firstDow === 0 ? 6 : firstDow - 1; // Mon=0
    for (let p = 0; p < padDays; p++) {
        const empty = document.createElement('div');
        empty.style.visibility = 'hidden';
        heatmap.appendChild(empty);
    }

    for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const ds = d.toISOString().split('T')[0];
        const scheduled = (dateMap[ds] || []).length;
        const done = dayCompletions[ds] || 0;

        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';

        if (scheduled === 0) {
            cell.classList.add('heat-0');
        } else if (done === 0) {
            cell.classList.add('heat-0');
        } else if (done >= scheduled) {
            cell.classList.add('heat-3');
        } else if (done >= scheduled / 2) {
            cell.classList.add('heat-2');
        } else {
            cell.classList.add('heat-1');
        }

        const dateLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        cell.title = `${dateLabel}: ${done}/${scheduled} sessions`;
        heatmap.appendChild(cell);
    }
}

function renderReadinessSection() {
    const container = document.getElementById('readiness-grid');
    const analytics = getSubjectAnalytics();

    Object.entries(analytics).forEach(([subj, stats]) => {
        drawGauge(container, subj, stats.readiness);
    });
}

function renderPomodoroSection() {
    const log = loadPomoLog();
    const totalMinutes = log.reduce((sum, e) => sum + (e.minutes || 0), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);
    const sessions = log.length;

    document.getElementById('pomo-total-hours').textContent = totalHours + 'h';
    document.getElementById('pomo-sessions').textContent = sessions;

    // Daily average
    const uniqueDays = new Set(log.map(e => e.date)).size;
    const dailyAvg = uniqueDays > 0 ? (totalMinutes / 60 / uniqueDays).toFixed(1) : '0';
    document.getElementById('pomo-daily-avg').textContent = dailyAvg + 'h';
}

// ─── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderHeroStats();
    renderPerformanceTable();
    renderMarkDistribution();
    renderStreakSection();
    renderReadinessSection();
    renderPomodoroSection();
});
