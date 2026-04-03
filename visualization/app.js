/**
 * app.js
 * Logic for Thun.AI Production Readiness Dashboard.
 * Simulates real-time stress index computation and intervention logic.
 */

const CONFIG = {
    WEIGHTS: { obd: 0.4, bio: 0.4, cv: 0.2 },
    COOLDOWN_MS: 3000, // Speed up for demo
};

const REQUIREMENTS = [
    { title: "Circuit Breakers", status: "READY", desc: "Thread-safe state machine for AI providers." },
    { title: "API Spec", status: "READY", desc: "OpenAPI 3.0 documentation for all endpoints." },
    { title: "Operational Runbooks", status: "READY", desc: "P0/P1 incident response procedures." },
    { title: "Audit Logging", status: "READY", desc: "Immutable request/response context tracing." },
    { title: "Stress Index Tests", status: "READY", desc: "100% coverage on composite index logic." },
    { title: "IVIS Engine Tests", status: "READY", desc: "Cooldown and priority logic validation." },
    { title: "Sync Retry Queue", status: "READY", desc: "Exponential backoff for offline mobile sync." },
    { title: "SQLite Encryption", status: "READY", desc: "PRAGMA key support for biometric data." },
    { title: "TLS Pinning", status: "READY", desc: "Certificate fingerprint validation stubs." },
    { title: "Edge Hardware Init", status: "READY", desc: "RV1126-specific boot sequence stubs." },
    { title: "CV Perception", status: "READY", desc: "YOLO/MobileNet backend orchestration." },
    { title: "VLM Streaming", status: "GAP", desc: "Gemini-2.0-Flash live vision processing." },
    { title: "OBD-2 Parser", status: "GAP", desc: "Raw CAN frame to PID conversion logic." },
    { title: "BLE Peripheral", status: "GAP", desc: "Peripheral mode for watch discoverability." },
];

class Dashboard {
    constructor() {
        this.speed = 60;
        this.hr = 72;
        this.csi = 20;
        this.lastIntervention = 0;
        
        this.init();
    }

    init() {
        this.renderRequirements();
        this.setupEventListeners();
        this.startSimulation();
    }

    renderRequirements() {
        const grid = document.getElementById('req-grid');
        grid.innerHTML = REQUIREMENTS.map(req => `
            <div class="req-card">
                <span class="${req.status === 'READY' ? 'ready-tag' : 'gap-tag'}">${req.status}</span>
                <h4>${req.title}</h4>
                <p style="font-size: 0.8rem; color: #94a3b8;">${req.desc}</p>
            </div>
        `).join('');
    }

    setupEventListeners() {
        document.getElementById('scenario-normal').onclick = () => this.setScenario(60, 72);
        document.getElementById('scenario-highway').onclick = () => this.setScenario(110, 85);
        document.getElementById('scenario-emergency').onclick = () => this.triggerEmergency();
    }

    setScenario(speed, hr) {
        this.targetSpeed = speed;
        this.targetHr = hr;
        this.log(`Switched to ${speed > 100 ? 'Highway' : 'Normal'} scenario.`);
    }

    triggerEmergency() {
        this.log("⚠️ Emergency Vehicle Detected by CV Unit!");
        this.dispatchIntervention("Siren Warning - Pull Over Safely", "CRITICAL");
    }

    startSimulation() {
        setInterval(() => {
            // Smoothly interpolate towards targets
            if (this.targetSpeed) this.speed += (this.targetSpeed - this.speed) * 0.1;
            if (this.targetHr) this.hr += (this.targetHr - this.hr) * 0.1;

            // Random micro-jitter
            const jitterSpeed = this.speed + (Math.random() - 0.5) * 2;
            const jitterHr = this.hr + (Math.random() - 0.5) * 4;

            // Compute Mock CSI
            const obdScore = Math.min(100, (jitterSpeed > 100 ? (jitterSpeed - 100) * 10 : 0));
            const bioScore = Math.min(100, (jitterHr > 80 ? (jitterHr - 80) * 5 : 0));
            this.csi = Math.round(obdScore * 0.5 + bioScore * 0.5);

            this.updateUI(jitterSpeed, jitterHr, this.csi);
            this.checkIntervention();
        }, 200);
    }

    updateUI(speed, hr, csi) {
        document.getElementById('val-speed').textContent = Math.round(speed);
        document.getElementById('bar-speed').style.width = `${Math.min(100, (speed/140)*100)}%`;
        
        document.getElementById('val-hr').textContent = Math.round(hr);
        document.getElementById('bar-hr').style.width = `${Math.min(100, (hr/120)*100)}%`;
        
        document.getElementById('val-csi').textContent = csi;
        document.getElementById('bar-csi').style.width = `${csi}%`;
        
        const csiBar = document.getElementById('bar-csi');
        if (csi > 70) csiBar.style.background = '#ef4444';
        else if (csi > 40) csiBar.style.background = '#f59e0b';
        else csiBar.style.background = '#3b82f6';
    }

    checkIntervention() {
        if (Date.now() - this.lastIntervention < CONFIG.COOLDOWN_MS) return;

        if (this.csi >= 85) {
            this.dispatchIntervention("Protocol Alpha: Pull Over & Breathe", "HIGH");
        } else if (this.csi >= 60) {
            this.dispatchIntervention("Breathing Cue: In for 4, Out for 6", "MEDIUM");
        }
    }

    dispatchIntervention(msg, severity) {
        this.lastIntervention = Date.now();
        this.log(`Intervention [${severity}]: ${msg}`);
    }

    log(msg) {
        const list = document.getElementById('log-list');
        const time = new Date().toLocaleTimeString();
        const li = document.createElement('li');
        li.innerHTML = `<span class="log-time">${time}</span> <span class="log-msg">${msg}</span>`;
        list.insertBefore(li, list.firstChild);
    }
}

document.addEventListener('DOMContentLoaded', () => new Dashboard());
