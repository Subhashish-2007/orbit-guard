/**
 * ORBITGUARD - Space Debris Tracking & Collision Risk Prediction Application Controller
 */

class AudioSynthesizer {
    constructor() {
        this.ctx = null;
        this.muted = false;
    }
    
    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) this.ctx = new AudioContext();
        }
    }
    
    playBeep(freq = 880, duration = 0.08, type = 'sine') {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch(e) {}
    }
    
    playCriticalAlarm() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(750, now);
            osc.frequency.linearRampToValueAtTime(1100, now + 0.25);
            osc.frequency.linearRampToValueAtTime(750, now + 0.5);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.55);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.55);
        } catch(e) {}
    }
}

class OrbitGuardApp {
    constructor() {
        this.objects = [];
        this.conjunctions = [];
        this.selectedObject = null;
        this.selectedConjunction = null;
        
        this.simTimeSec = 0;
        this.simSpeed = 1.0;
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        
        this.activeTab = '3d';
        this.alertFilter = 'ALL';
        this.categoryFilter = 'ALL';
        this.searchQuery = '';
        
        this.audio = new AudioSynthesizer();
        this.globe3D = null;
        this.map2D = null;
        this.rafId = null;
        this.disposed = false;
        this.lastPanelRefreshSec = -1;
        
        this.initData();
        this.initVisualizers();
        this.initUI();
        this.scanAllConjunctions();
        this.startLoop();
    }

    setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    setTexts(ids, value) {
        ids.forEach(id => this.setText(id, value));
    }

    formatSimDuration(totalSeconds) {
        const bounded = Math.max(0, totalSeconds % (48 * 3600));
        const hours = Math.floor(bounded / 3600);
        const minutes = Math.floor((bounded % 3600) / 60);
        const seconds = Math.floor(bounded % 60);
        return `SIM T+${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }

    formatCountdown(secondsUntilTca) {
        const bounded = Math.max(0, secondsUntilTca);
        const hours = Math.floor(bounded / 3600);
        const minutes = Math.floor((bounded % 3600) / 60);
        const seconds = Math.floor(bounded % 60);
        return `T-${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }

    updateCollisionVerdict() {
        if (!this.conjunctions.length) {
            this.setTexts(['collision-verdict-status', 'top-collision-verdict-status'], 'CLEAR');
            this.setTexts(['collision-verdict-main', 'top-collision-verdict-main'], 'No close approaches are inside the current screening threshold.');
            this.setTexts(['collision-verdict-tca', 'top-collision-verdict-tca'], '---');
            this.setTexts(['collision-verdict-miss', 'top-collision-verdict-miss'], '---');
            this.setText('collision-verdict-note', 'No impact is predicted from the current demo catalog and threshold.');
            return;
        }

        const futureEvents = this.conjunctions
            .filter(item => item.tcaSec > this.simTimeSec + 1)
            .sort((a, b) => a.tcaSec - b.tcaSec);
        const priorityFuture = futureEvents.find(item => item.severity === 'CRITICAL' || item.severity === 'HIGH');
        const nearest = priorityFuture || futureEvents[0] || this.conjunctions[0];
        const timeRemSec = Math.max(0, nearest.tcaSec - this.simTimeSec);
        const missText = nearest.missDistanceMeters < 1000
            ? `${nearest.missDistanceMeters.toFixed(0)} m`
            : `${nearest.missDistanceKm.toFixed(2)} km`;

        const status = 'NO CONFIRMED IMPACT';
        const mainText = `Closest demo event: ${nearest.obj1.name} vs ${nearest.obj2.name}. Close approach only, not proof of collision.`;
        const countdown = this.formatCountdown(timeRemSec);
        this.setTexts(['collision-verdict-status', 'top-collision-verdict-status'], status);
        this.setTexts(['collision-verdict-main', 'top-collision-verdict-main'], mainText);
        this.setTexts(['collision-verdict-tca', 'top-collision-verdict-tca'], countdown);
        this.setTexts(['collision-verdict-miss', 'top-collision-verdict-miss'], missText);
        this.setText('collision-verdict-note', `Risk score ${nearest.riskScore}/100, Pc ${nearest.collisionProb.toExponential(2)}. Real collision confirmation requires live tracking covariance, not only TLE lines.`);
    }
    
    initData() {
        if (typeof RAW_CATALOG !== 'undefined') {
            this.setCatalogObjects(RAW_CATALOG, 'CACHED CATALOG', false);
        }
        // Async background sync with CelesTrak Live API
        setTimeout(() => {
            this.syncLiveCelesTrak({ silent: true });
        }, 800);
    }

    setCatalogObjects(catalogArray, sourceLabel = 'LIVE CELESTRAK', triggerConjunctionScan = true) {
        if (!Array.isArray(catalogArray) || catalogArray.length === 0) return;

        const parsedObjects = catalogArray.map(item => {
            const orb = parseTLE(item.tle1, item.tle2);
            return {
                ...item,
                orbital: orb
            };
        }).filter(item => item.orbital !== null);

        if (parsedObjects.length > 0) {
            this.objects = parsedObjects;
            console.log(`OrbitGuard: Loaded ${this.objects.length} valid orbital objects (${sourceLabel}).`);
            
            if (!this.selectedObject || !this.objects.find(o => o.norad === this.selectedObject.norad)) {
                this.selectedObject = this.objects[0]; // Default to first object (e.g. ISS)
            }
            
            if (this.globe3D) {
                this.globe3D.setCatalog(this.objects);
            }

            if (triggerConjunctionScan) {
                this.scanAllConjunctions();
                this.renderObjectList();
                this.renderTelemetryHUD();
                this.populateCAMSelectors();
                this.updateSummaryCounters();
            }

            const isLive = sourceLabel.toUpperCase().includes('CELESTRAK');
            this.updateDataSourceStatus(sourceLabel, isLive);
        }
    }

    showToast(message, type = 'info', duration = 4000) {
        let container = document.getElementById('orbitguard-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'orbitguard-toast-container';
            container.className = 'fixed top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        const bgColors = {
            success: 'bg-emerald-950/95 border-emerald-500/80 text-emerald-100 shadow-emerald-500/20',
            warning: 'bg-amber-950/95 border-amber-500/80 text-amber-100 shadow-amber-500/20',
            error: 'bg-red-950/95 border-red-500/80 text-red-100 shadow-red-500/20',
            info: 'bg-slate-900/95 border-cyan-500/80 text-slate-100 shadow-cyan-500/20'
        };
        const icons = {
            success: 'fa-check-circle text-emerald-400',
            warning: 'fa-exclamation-triangle text-amber-400',
            error: 'fa-times-circle text-red-400',
            info: 'fa-info-circle text-cyan-400'
        };

        toast.className = `p-3 rounded-lg border backdrop-blur-md shadow-lg flex items-start gap-2.5 text-xs pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0 ${bgColors[type] || bgColors.info}`;
        toast.innerHTML = `
            <i class="fas ${icons[type] || icons.info} mt-0.5 text-sm shrink-0"></i>
            <div class="flex-1 leading-relaxed">${message}</div>
        `;

        container.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.remove('translate-y-2', 'opacity-0');
        });

        setTimeout(() => {
            toast.classList.add('opacity-0', '-translate-y-2');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    async syncLiveCelesTrak(options = {}) {
        const btn = document.getElementById('btn-sync-celestrak');
        const icon = document.getElementById('sync-icon');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('opacity-75');
            if (icon) icon.className = 'fas fa-spinner fa-spin text-emerald-400';
        }
        this.updateDataSourceStatus('SYNCING CELESTRAK...', null);

        if (!options.silent) {
            this.showToast('📡 Connecting to CelesTrak Open TLE API...', 'info', 2500);
        }

        try {
            if (typeof window.fetchLiveCelesTrakCatalog === 'function') {
                const res = await window.fetchLiveCelesTrakCatalog();
                if (res.success && res.data && res.data.length > 0) {
                    this.setCatalogObjects(res.data, `CELESTRAK LIVE (${res.data.length} OBJS)`, true);
                    this.showToast(`✅ Connected to CelesTrak! Loaded ${res.data.length} live orbital objects.`, 'success', 4000);
                    if (!options.silent) {
                        this.audio.playBeep(1200, 0.1);
                    }
                } else {
                    this.updateDataSourceStatus('OFFLINE CACHED MODE', false);
                    if (!options.silent) {
                        this.showToast('⚠️ CelesTrak API unreachable (Network/Firewall restriction). OrbitGuard running in High-Precision Offline Mode.', 'warning', 5000);
                    }
                }
            }
        } catch (err) {
            console.warn("Sync CelesTrak error:", err);
            this.updateDataSourceStatus('OFFLINE CACHED MODE', false);
            if (!options.silent) {
                this.showToast('⚠️ CelesTrak API connection error. Switched to High-Precision Offline Catalog.', 'warning', 5000);
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-75');
                if (icon) icon.className = 'fas fa-satellite-dish text-emerald-400';
            }
        }
    }

    updateDataSourceStatus(label, isLive) {
        const textEl = document.getElementById('celestrak-status-text');
        const dotEl = document.getElementById('celestrak-status-dot');
        if (textEl) textEl.textContent = label;
        if (dotEl) {
            if (isLive === true) {
                dotEl.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
            } else if (isLive === false) {
                dotEl.className = 'w-2 h-2 rounded-full bg-amber-400';
            } else {
                dotEl.className = 'w-2 h-2 rounded-full bg-cyan-400 animate-ping';
            }
        }
    }
    
    initVisualizers() {
        // Initialize Three.js 3D Globe
        try {
            this.globe3D = new Globe3D('globe-container');
            this.globe3D.setCatalog(this.objects);
        } catch (e) {
            console.error("Three.js WebGL initialization warning:", e);
        }
        
        // Initialize 2D Canvas Ground Track Map
        try {
            this.map2D = new Map2D('ground-track-canvas');
        } catch (e) {
            console.error("2D Map initialization error:", e);
        }
    }
    
    scanAllConjunctions() {
        console.log("Scanning 48-hour conjunction horizon...");
        this.conjunctions = scanConjunctions(this.objects, 48, 30.0, this.simTimeSec);
        console.log(`Found ${this.conjunctions.length} upcoming conjunctions.`);
        
        // Update stats badge
        const criticalCount = this.conjunctions.filter(c => c.severity === "CRITICAL").length;
        const highCount = this.conjunctions.filter(c => c.severity === "HIGH").length;
        const trackedCount = this.objects.length;
        
        const badgeCrit = document.getElementById('stat-critical-count');
        if (badgeCrit) badgeCrit.textContent = criticalCount;
        const badgeHigh = document.getElementById('stat-high-count');
        if (badgeHigh) badgeHigh.textContent = highCount;
        const badgeTotal = document.getElementById('stat-total-count');
        if (badgeTotal) badgeTotal.textContent = trackedCount;
        
        if (criticalCount > 0) {
            const alertBanner = document.getElementById('top-critical-alert');
            if (alertBanner) {
                alertBanner.classList.remove('hidden');
                document.getElementById('top-alert-msg').textContent = 
                    `DEMO SCREENING RISK: ${criticalCount} conjunction candidate(s) with miss distance < 1.0 km in the next 48h simulation horizon. Not an operational collision alert.`;
            }
        }

        this.updateCollisionVerdict();
        
        this.renderConjunctionAlerts();
        this.renderConjunctionTable();
        if (typeof this.updateAnalytics === 'function') this.updateAnalytics();
    }
    
    selectObject(obj) {
        this.selectedObject = obj;
        this.audio.playBeep(920, 0.05);
        this.renderObjectList();
        this.renderTelemetryHUD();
        
        // Update Maneuver Satellite dropdown if in CAM tab
        const camSelect = document.getElementById('cam-satellite-select');
        if (camSelect && obj) {
            camSelect.value = obj.norad;
            this.updateCAMView();
        }
    }
    
    selectConjunction(conj) {
        this.selectedConjunction = conj;
        this.selectedObject = conj.obj1;
        this.audio.playBeep(conj.severity === "CRITICAL" ? 1200 : 800, 0.08);
        
        if (this.globe3D) {
            this.globe3D.selectedConjunction = conj;
        }
        
        this.renderTelemetryHUD();
        this.renderObjectList();
        this.openConjunctionModal(conj);
    }
    
    initUI() {
        // Tab buttons
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = btn.getAttribute('data-tab');
                this.switchTab(tab);
            });
        });
        
        // Orbital Catalog Floating Drawer Toggle
        const catalogSidebar = document.getElementById('sidebar-catalog');
        const drawerToggleBtn = document.getElementById('btn-toggle-drawer');

        const toggleCatalogDrawer = (forceState) => {
            if (!catalogSidebar) return;
            const isClosed = catalogSidebar.classList.contains('drawer-closed');
            const willClose = (typeof forceState === 'boolean') ? forceState : !isClosed;
            
            if (willClose) {
                catalogSidebar.classList.add('drawer-closed');
                if (drawerToggleBtn) drawerToggleBtn.title = "Open Orbital Catalog";
            } else {
                catalogSidebar.classList.remove('drawer-closed');
                if (drawerToggleBtn) drawerToggleBtn.title = "Collapse Orbital Catalog";
            }
            
            // Trigger 3D Globe & Map resize
            if (this.globe3D) this.globe3D.onResize();
            if (this.map2D) this.map2D.resize();
        };

        drawerToggleBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCatalogDrawer();
        });

        // Right Sidebar (Conjunction Alerts & Telemetry HUD) Floating Drawer Toggle
        const conjunctionSidebar = document.getElementById('sidebar-conjunctions');
        const rightDrawerToggleBtn = document.getElementById('btn-toggle-right-drawer');

        const toggleRightDrawer = (forceState) => {
            if (!conjunctionSidebar) return;
            const isClosed = conjunctionSidebar.classList.contains('drawer-closed');
            const willClose = (typeof forceState === 'boolean') ? forceState : !isClosed;
            
            if (willClose) {
                conjunctionSidebar.classList.add('drawer-closed');
                if (rightDrawerToggleBtn) rightDrawerToggleBtn.title = "Open Conjunction Alerts & Telemetry";
            } else {
                conjunctionSidebar.classList.remove('drawer-closed');
                if (rightDrawerToggleBtn) rightDrawerToggleBtn.title = "Collapse Conjunction Alerts & Telemetry";
            }
            
            // Trigger 3D Globe & Map resize
            if (this.globe3D) this.globe3D.onResize();
            if (this.map2D) this.map2D.resize();
        };

        rightDrawerToggleBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRightDrawer();
        });
        
        // Search & Category Filters
        const searchInput = document.getElementById('search-objects');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.renderObjectList();
            });
        }
        
        const catSelect = document.getElementById('category-filter');
        if (catSelect) {
            catSelect.addEventListener('change', (e) => {
                this.categoryFilter = e.target.value;
                this.renderObjectList();
            });
        }
        
        // Time Control Buttons
        document.getElementById('btn-play-pause')?.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            document.getElementById('btn-play-pause').innerHTML = this.isPlaying ? 
                '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
            this.audio.playBeep(600, 0.05);
        });
        
        document.getElementById('btn-step-back')?.addEventListener('click', () => {
            this.simTimeSec = Math.max(0, this.simTimeSec - 300);
            this.audio.playBeep(500, 0.03);
        });
        
        document.getElementById('btn-step-fwd')?.addEventListener('click', () => {
            this.simTimeSec += 300;
            this.audio.playBeep(700, 0.03);
        });
        
        document.getElementById('btn-reset-time')?.addEventListener('click', () => {
            this.simTimeSec = 0;
            this.audio.playBeep(440, 0.05);
        });
        
        document.getElementById('btn-jump-next-tca')?.addEventListener('click', () => {
            if (this.conjunctions.length > 0) {
                const futureConjs = this.conjunctions.filter(c => c.timeToTcaSec > this.simTimeSec + 125);
                
                let nextConj;
                if (futureConjs.length > 0) {
                    futureConjs.sort((a, b) => a.timeToTcaSec - b.timeToTcaSec);
                    nextConj = futureConjs[0];
                } else {
                    const allConjs = [...this.conjunctions].sort((a, b) => a.timeToTcaSec - b.timeToTcaSec);
                    nextConj = allConjs[0];
                }
                
                this.simTimeSec = Math.max(0, nextConj.timeToTcaSec - 120);
                this.selectConjunction(nextConj);
                this.audio.playBeep(1000, 0.1);
            }
        });
        
        // Speed Buttons
        const speedBtns = document.querySelectorAll('.speed-btn');
        speedBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                speedBtns.forEach(b => b.classList.remove('bg-cyan-500', 'text-black', 'active'));
                btn.classList.add('bg-cyan-500', 'text-black', 'active');
                this.simSpeed = parseFloat(btn.getAttribute('data-speed'));
                this.audio.playBeep(800 + this.simSpeed * 0.1, 0.04);
            });
        });
        
        // Timeline Scrubber Slider
        const timeSlider = document.getElementById('timeline-slider');
        if (timeSlider) {
            timeSlider.addEventListener('input', (e) => {
                this.simTimeSec = parseFloat(e.target.value);
            });
        }
        
        // Camera View Mode Buttons
        const updateCamBtnState = (activeId) => {
            ['cam-free', 'cam-focus', 'cam-follow'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    if (id === activeId) {
                        btn.className = 'px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/50 text-[10px] font-semibold transition-all';
                    } else {
                        btn.className = 'px-2 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded border border-slate-800 text-[10px] transition-all';
                    }
                }
            });
        };
        
        document.getElementById('cam-free')?.addEventListener('click', () => {
            if (this.globe3D) this.globe3D.setCameraMode("FREE");
            updateCamBtnState('cam-free');
        });
        document.getElementById('cam-focus')?.addEventListener('click', () => {
            if (this.globe3D) this.globe3D.setCameraMode("FOCUS");
            updateCamBtnState('cam-focus');
        });
        document.getElementById('cam-follow')?.addEventListener('click', () => {
            if (this.globe3D) this.globe3D.setCameraMode("FOLLOW");
            updateCamBtnState('cam-follow');
        });
        document.getElementById('cam-reset')?.addEventListener('click', () => {
            if (this.globe3D) this.globe3D.resetView();
            updateCamBtnState('cam-free');
        });
        
        // Audio Toggle
        document.getElementById('btn-toggle-sound')?.addEventListener('click', (e) => {
            this.audio.muted = !this.audio.muted;
            const icon = document.getElementById('sound-icon');
            if (icon) {
                icon.className = this.audio.muted ? 'fas fa-volume-mute text-gray-400' : 'fas fa-volume-up text-cyan-400';
            }
        });
        
        // Export & Import Buttons
        document.getElementById('btn-export-csv')?.addEventListener('click', () => this.exportCSV());
        document.getElementById('btn-export-cdm')?.addEventListener('click', () => this.exportCDM());
        document.getElementById('btn-export-report')?.addEventListener('click', () => window.print());
        document.getElementById('btn-import-tle-modal')?.addEventListener('click', () => this.openImportModal());
        document.getElementById('btn-sync-celestrak')?.addEventListener('click', () => this.syncLiveCelesTrak({ silent: false }));
        
        // CAM Maneuver Slider Events
        const camSliders = ['cam-dv-along', 'cam-dv-cross', 'cam-dv-radial', 'cam-lead-time'];
        camSliders.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => this.updateCAMSimulation());
            }
        });
        
        document.getElementById('btn-auto-optimize-cam')?.addEventListener('click', () => {
            this.runAutoOptimizeCAM();
        });
        
        this.renderObjectList();
        this.renderTelemetryHUD();
        this.populateCAMSelectors();
    }
    
    switchTab(tab) {
        this.activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.getAttribute('data-tab') === tab) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        
        const views = {
            '3d': document.getElementById('view-3d'),
            '2d': document.getElementById('view-2d'),
            'conjunctions': document.getElementById('view-conjunctions'),
            'analytics': document.getElementById('view-analytics')
        };
        
        for (const [key, el] of Object.entries(views)) {
            if (el) {
                if (key === tab) el.classList.remove('hidden');
                else el.classList.add('hidden');
            }
        }
        
        const camControls = document.getElementById('globe-camera-controls');
        if (camControls) {
            if (tab === '3d') {
                camControls.classList.remove('hidden');
                camControls.classList.add('flex');
            } else {
                camControls.classList.add('hidden');
                camControls.classList.remove('flex');
            }
        }

        if (tab === '3d' && this.globe3D) this.globe3D.onResize();
        if (tab === '2d' && this.map2D) this.map2D.resize();
        
        this.audio.playBeep(750, 0.04);
    }
    
    renderObjectList() {
        const container = document.getElementById('object-list-container');
        if (!container) return;
        
        const filtered = this.objects.filter(obj => {
            const matchesSearch = obj.name.toLowerCase().includes(this.searchQuery) || 
                                  obj.norad.toString().includes(this.searchQuery) ||
                                  obj.country.toLowerCase().includes(this.searchQuery);
            const matchesCat = (this.categoryFilter === 'ALL') || (obj.type === this.categoryFilter);
            return matchesSearch && matchesCat;
        });
        
        container.innerHTML = filtered.map(obj => {
            const isSelected = (obj === this.selectedObject);
            let typeColor = "text-cyan-400 border-cyan-500/30";
            let typeBg = "bg-cyan-500/10";
            if (obj.type === "STATION") { typeColor = "text-emerald-400 border-emerald-500/30"; typeBg = "bg-emerald-500/10"; }
            else if (obj.type === "DEBRIS") { typeColor = "text-red-400 border-red-500/30"; typeBg = "bg-red-500/10"; }
            else if (obj.type === "ROCKET_BODY") { typeColor = "text-amber-400 border-amber-500/30"; typeBg = "bg-amber-500/10"; }
            
            const liveState = obj.orbital ? propagateOrbit(obj.orbital, this.simTimeSec) : null;
            const alt = liveState ? liveState.alt.toFixed(0) : "---";
            const speed = liveState ? liveState.speed.toFixed(2) : "---";
            
            return `
                <div class="p-2.5 rounded-lg border transition-all cursor-pointer ${isSelected ? 'bg-cyan-950/60 border-cyan-400 shadow-lg shadow-cyan-900/30' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'}"
                     onclick="window.orbitApp.selectObject(window.orbitApp.objects.find(o => o.norad === ${obj.norad}))">
                    <div class="flex items-center justify-between">
                        <span class="font-semibold text-xs text-slate-100 flex items-center gap-1.5">
                            <span class="w-2 h-2 rounded-full ${obj.type === 'DEBRIS' ? 'bg-red-500 animate-ping' : (obj.type === 'STATION' ? 'bg-emerald-400' : 'bg-cyan-400')}"></span>
                            ${obj.name}
                        </span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded border ${typeColor} ${typeBg}">${obj.type}</span>
                    </div>
                    <div class="flex items-center justify-between mt-1 text-[10px] text-slate-400 font-mono">
                        <span>NORAD: ${obj.norad}</span>
                        <span>ALT: ${alt} km</span>
                        <span>SPD: ${speed} km/s</span>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    renderTelemetryHUD() {
        if (!this.selectedObject || !this.selectedObject.orbital) return;
        const obj = this.selectedObject;
        const state = propagateOrbit(obj.orbital, this.simTimeSec);
        
        this.setText('hud-sat-name', obj.name);
        this.setText('hud-sat-type', `${obj.category} (${obj.country})`);
        this.setText('hud-norad', obj.norad);
        this.setText('hud-alt', `${state.alt.toFixed(1)} km`);
        this.setText('hud-speed', `${state.speed.toFixed(3)} km/s (${(state.speed * 3600).toFixed(0)} km/h)`);
        this.setText('hud-latlon', `${state.lat.toFixed(2)}°N, ${state.lon.toFixed(2)}°E`);
        this.setText('hud-inc', `${obj.orbital.incDeg.toFixed(3)}°`);
        this.setText('hud-period', `${obj.orbital.periodMin.toFixed(2)} min`);
        this.setText('hud-raan', `${obj.orbital.raanDeg.toFixed(2)}°`);
        this.setText('hud-mass', `${obj.mass_kg.toLocaleString()} kg`);
        this.setText('hud-radius', `${obj.radius_m.toFixed(1)} m`);
        this.setText('hud-footprint', `${state.footprintRadiusKm.toFixed(0)} km`);
        this.setText('hud-desc', obj.desc || "Tracked space asset.");
    }
    
    renderConjunctionAlerts() {
        const container = document.getElementById('conjunction-alert-feed');
        if (!container) return;
        
        if (this.conjunctions.length === 0) {
            container.innerHTML = `<div class="text-xs text-slate-500 text-center py-6">No conjunctions detected within threshold.</div>`;
            return;
        }
        
        container.innerHTML = this.conjunctions.slice(0, 8).map(conj => {
            const isCrit = (conj.severity === "CRITICAL");
            const timeRemSec = Math.max(0, conj.tcaSec - this.simTimeSec);
            const hours = Math.floor(timeRemSec / 3600);
            const mins = Math.floor((timeRemSec % 3600) / 60);
            const secs = Math.floor(timeRemSec % 60);
            const countdownStr = `T-${String(hours).padStart(2,'0')}h ${String(mins).padStart(2,'0')}m ${String(secs).padStart(2,'0')}s`;
            
            return `
                <div class="p-3 rounded-lg border transition-all cursor-pointer ${isCrit ? 'glass-panel-critical' : 'glass-panel hover:border-cyan-400'}"
                     onclick="window.orbitApp.selectConjunction(window.orbitApp.conjunctions.find(c => c.id === '${conj.id}'))">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold px-2 py-0.5 rounded ${conj.badgeClass}">
                            <i class="fas fa-radiation mr-1"></i> ${conj.severity}
                        </span>
                        
                    </div>
                    <div class="mt-2 text-xs font-semibold text-slate-100 flex items-center justify-between">
                        <span class="truncate max-w-[130px]">${conj.obj1.name}</span>
                        <i class="fas fa-arrows-alt-h text-slate-400 text-[10px]"></i>
                        <span class="truncate max-w-[130px] text-red-400">${conj.obj2.name}</span>
                    </div>
                    <div class="grid grid-cols-3 gap-1 mt-2 text-[10px] font-mono text-slate-300 bg-black/40 p-1.5 rounded">
                        <div><span class="text-slate-500 block">MISS DIST</span><span class="font-bold text-amber-300">${conj.missDistanceMeters < 1000 ? conj.missDistanceMeters.toFixed(0) + 'm' : conj.missDistanceKm.toFixed(2) + 'km'}</span></div>
                        <div><span class="text-slate-500 block">REL SPEED</span><span>${conj.relVelocityKms.toFixed(1)} km/s</span></div>
                        <div><span class="text-slate-500 block">PROB Pc</span><span class="font-bold ${isCrit ? 'text-red-400' : 'text-cyan-300'}">${conj.collisionProb.toExponential(2)}</span></div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    renderConjunctionTable() {
        const tbody = document.getElementById('conjunction-table-body');
        if (!tbody) return;
        
        tbody.innerHTML = this.conjunctions.map((conj, idx) => {
            const timeRemSec = Math.max(0, conj.tcaSec - this.simTimeSec);
            const hours = (timeRemSec / 3600).toFixed(2);
            
            return `
                <tr class="border-b border-slate-800/80 hover:bg-cyan-950/30 transition-colors cursor-pointer text-xs"
                    onclick="window.orbitApp.selectConjunction(window.orbitApp.conjunctions.find(c => c.id === '${conj.id}'))">
                    <td class="py-2.5 px-3 font-mono text-slate-400">${idx + 1}</td>
                    <td class="py-2.5 px-3 font-semibold text-slate-100">${conj.obj1.name} <span class="text-slate-500 text-[10px]">(${conj.obj1.norad})</span></td>
                    <td class="py-2.5 px-3 font-semibold text-red-400">${conj.obj2.name} <span class="text-slate-500 text-[10px]">(${conj.obj2.norad})</span></td>
                    <td class="py-2.5 px-3 font-mono font-bold ${conj.missDistanceKm < 1.0 ? 'text-red-400' : 'text-amber-300'}">
                        ${conj.missDistanceMeters < 1000 ? conj.missDistanceMeters.toFixed(0) + ' m' : conj.missDistanceKm.toFixed(2) + ' km'}
                    </td>
                    <td class="py-2.5 px-3 font-mono text-slate-500">+${hours} hrs</td>
                    <td class="py-2.5 px-3 font-mono text-slate-300">${conj.relVelocityKms.toFixed(2)} km/s</td>
                    <td class="py-2.5 px-3 font-mono font-bold ${conj.collisionProb > 1e-4 ? 'text-red-400' : 'text-cyan-300'}">${conj.collisionProb.toExponential(3)}</td>
                    <td class="py-2.5 px-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${conj.badgeClass}">${conj.severity}</span>
                    </td>
                    <td class="py-2.5 px-3 text-right">
                        <button class="px-2 py-1 bg-cyan-600/30 hover:bg-cyan-600/60 text-cyan-300 rounded text-[10px] border border-cyan-500/40"
                                onclick="event.stopPropagation(); window.orbitApp.openConjunctionModal(window.orbitApp.conjunctions.find(c => c.id === '${conj.id}'))">
                            Inspect
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    openConjunctionModal(conj) {
        if (!conj) return;
        const modal = document.getElementById('conjunction-detail-modal');
        if (!modal) return;
        
        document.getElementById('modal-conj-title').textContent = `${conj.obj1.name} vs ${conj.obj2.name}`;
        document.getElementById('modal-severity-badge').className = `px-2.5 py-0.5 rounded text-xs font-bold ${conj.badgeClass}`;
        document.getElementById('modal-severity-badge').textContent = `${conj.severity} SEVERITY (Risk Score: ${conj.riskScore}/100)`;
        
                const tcaEl = document.getElementById('modal-tca-time');
        if (tcaEl) tcaEl.textContent = `T+${(conj.timeToTcaSec/3600).toFixed(2)}h (${new Date(Date.now() + conj.timeToTcaSec*1000).toUTCString()})`;
        
        const tcaDate = new Date(Date.now() + conj.timeToTcaSec * 1000);
        const tcaAbsEl = document.getElementById('modal-tca-absolute');
        const tcaRelEl = document.getElementById('modal-tca-relative');
        
        if (tcaAbsEl) {
            tcaAbsEl.innerText = tcaDate.toUTCString().replace('GMT', 'UTC');
        }
        if (tcaRelEl) {
            const totalSecs = Math.max(0, Math.floor(conj.timeToTcaSec));
            const hrs = Math.floor(totalSecs / 3600);
            const mins = Math.floor((totalSecs % 3600) / 60);
            const secs = totalSecs % 60;
            tcaRelEl.innerText = 'T-' + hrs.toString().padStart(2, '0') + 'h ' + mins.toString().padStart(2, '0') + 'm ' + secs.toString().padStart(2, '0') + 's';
        }
        document.getElementById('modal-miss-dist').textContent = `${conj.missDistanceKm.toFixed(3)} km (${conj.missDistanceMeters.toFixed(1)} meters)`;
        document.getElementById('modal-rel-speed').textContent = `${conj.relVelocityKms.toFixed(3)} km/s (${conj.relVelocityKmh.toFixed(0)} km/h)`;
        document.getElementById('modal-pc').textContent = `${conj.collisionProb.toExponential(4)}`;
        document.getElementById('modal-rsw-radial').textContent = `${(conj.deltaRadialKm * 1000).toFixed(1)} m`;
        document.getElementById('modal-rsw-along').textContent = `${(conj.deltaAlongKm * 1000).toFixed(1)} m`;
        document.getElementById('modal-rsw-cross').textContent = `${(conj.deltaCrossKm * 1000).toFixed(1)} m`;
        document.getElementById('modal-kinetic-energy').textContent = `${(conj.kineticEnergyJoules / 1e6).toFixed(2)} MJ (${conj.tntEquivalentKg.toFixed(2)} kg TNT eq)`;
        
        document.getElementById('modal-obj1-details').innerHTML = `
            <div class="font-bold text-slate-100">${conj.obj1.name}</div>
            <div>NORAD ID: ${conj.obj1.norad}</div>
            <div>Type: ${conj.obj1.type} (${conj.obj1.country})</div>
            <div>Mass: ${conj.obj1.mass_kg.toLocaleString()} kg | Radius: ${conj.obj1.radius_m}m</div>
        `;
        
        document.getElementById('modal-obj2-details').innerHTML = `
            <div class="font-bold text-red-400">${conj.obj2.name}</div>
            <div>NORAD ID: ${conj.obj2.norad}</div>
            <div>Type: ${conj.obj2.type} (${conj.obj2.country})</div>
            <div>Mass: ${conj.obj2.mass_kg.toLocaleString()} kg | Radius: ${conj.obj2.radius_m}m</div>
        `;
        
        const btnPlanCAM = document.getElementById('modal-btn-plan-cam');
        if (btnPlanCAM) {
            btnPlanCAM.onclick = () => {
                this.closeConjunctionModal();
                this.openCAMModal(conj.obj1.norad, conj.obj2.norad);
            };
        }
        
        modal.classList.remove('hidden');
    }
    
    closeConjunctionModal() {
        document.getElementById('conjunction-detail-modal')?.classList.add('hidden');
    }
    
    openCAMModal(satNorad, debNorad) {
        document.getElementById('cam-planner-modal')?.classList.remove('hidden');
        const camSelect = document.getElementById('cam-satellite-select');
        const debSelect = document.getElementById('cam-debris-select');
        if (camSelect && satNorad) camSelect.value = satNorad;
        if (debSelect && debNorad) debSelect.value = debNorad;
        this.updateCAMView();
    }
    
    closeCAMModal() {
        document.getElementById('cam-planner-modal')?.classList.add('hidden');
    }
    
    updateAnalytics() {
        const totalEl = document.getElementById('analytics-total-conj');
        if (!totalEl) return;
        
        const criticalEl = document.getElementById('analytics-critical-conj');
        if (!criticalEl) return;
        
        const satSelect = document.getElementById('cam-satellite-select');
        const debSelect = document.getElementById('cam-debris-select');
        if (!satSelect || !debSelect) return;
        
        const activeSats = this.objects.filter(o => o.type !== "DEBRIS" && o.type !== "ROCKET_BODY");
        satSelect.innerHTML = activeSats.map(s => `<option value="${s.norad}">${s.name} (${s.type})</option>`).join('');
        
        const debrisList = this.objects.filter(o => o.type === "DEBRIS" || o.type === "ROCKET_BODY");
        debSelect.innerHTML = debrisList.map(d => `<option value="${d.norad}">${d.name} (${d.category})</option>`).join('');
        
        satSelect.addEventListener('change', () => this.updateCAMView());
        debSelect.addEventListener('change', () => this.updateCAMView());
    }
    
    populateCAMSelectors() {
        const satSelect = document.getElementById('cam-satellite-select');
        const debSelect = document.getElementById('cam-debris-select');
        if (!satSelect || !debSelect) return;
        
        const activeSats = this.objects.filter(o => o.type !== "DEBRIS" && o.type !== "ROCKET_BODY");
        satSelect.innerHTML = activeSats.map(s => `<option value="${s.norad}">${s.name} (${s.type})</option>`).join('');
        
        const debrisList = this.objects.filter(o => o.type === "DEBRIS" || o.type === "ROCKET_BODY");
        debSelect.innerHTML = debrisList.map(d => `<option value="${d.norad}">${d.name} (${d.category})</option>`).join('');
        
        satSelect.addEventListener('change', () => this.updateCAMView());
        debSelect.addEventListener('change', () => this.updateCAMView());
    }
    
    updateCAMView() {
        const satNorad = parseInt(document.getElementById('cam-satellite-select')?.value);
        const debNorad = parseInt(document.getElementById('cam-debris-select')?.value);
        
        const sat = this.objects.find(o => o.norad === satNorad) || this.objects[0];
        const deb = this.objects.find(o => o.norad === debNorad) || this.objects.find(o => o.type === "DEBRIS");
        
        if (!sat || !deb) return;
        
        // Find if they have a real conjunction TCA
        const matchConj = this.conjunctions.find(c => 
            (c.obj1.norad === sat.norad && c.obj2.norad === deb.norad) || 
            (c.obj1.norad === deb.norad && c.obj2.norad === sat.norad)
        );
        
        deb._sim_tca_sec = matchConj ? matchConj.tcaSec : 8820.0;
        deb._sim_initial_miss_km = matchConj ? matchConj.missDistanceKm : 0.350;
        
        this.updateCAMSimulation();
    }
    
    updateCAMSimulation() {
        const satNorad = parseInt(document.getElementById('cam-satellite-select')?.value);
        const debNorad = parseInt(document.getElementById('cam-debris-select')?.value);
        const sat = this.objects.find(o => o.norad === satNorad);
        const deb = this.objects.find(o => o.norad === debNorad);
        if (!sat || !deb) return;
        
        const dV_along = parseFloat(document.getElementById('cam-dv-along')?.value || 0);
        const dV_cross = parseFloat(document.getElementById('cam-dv-cross')?.value || 0);
        const dV_radial = parseFloat(document.getElementById('cam-dv-radial')?.value || 0);
        const leadHours = parseFloat(document.getElementById('cam-lead-time')?.value || 6);
        
        document.getElementById('cam-dv-along-val').textContent = `${dV_along.toFixed(2)} m/s`;
        document.getElementById('cam-dv-cross-val').textContent = `${dV_cross.toFixed(2)} m/s`;
        document.getElementById('cam-dv-radial-val').textContent = `${dV_radial.toFixed(2)} m/s`;
        document.getElementById('cam-lead-time-val').textContent = `${leadHours.toFixed(1)} hrs`;
        
        const res = simulateCAM(sat, deb, leadHours, { along: dV_along, cross: dV_cross, radial: dV_radial });
        
        // Update CAM Dashboard HUD
        document.getElementById('cam-res-initial-miss').textContent = `${(res.initialMissKm * 1000).toFixed(0)} m`;
        document.getElementById('cam-res-new-miss').textContent = `${res.newMissKm.toFixed(3)} km (${(res.newMissKm * 1000).toFixed(0)} m)`;
        document.getElementById('cam-res-dv').textContent = `${res.deltaV_ms.toFixed(2)} m/s`;
        document.getElementById('cam-res-fuel').textContent = `${res.fuelUsedKg.toFixed(2)} kg`;
        document.getElementById('cam-res-new-pc').textContent = res.newCollisionProb.toExponential(3);
        
        const statusEl = document.getElementById('cam-res-status');
        if (statusEl) {
            if (res.isSafe) {
                statusEl.className = "p-3 rounded border bg-emerald-950/60 border-emerald-400 text-emerald-300 font-bold flex items-center justify-between text-xs";
                statusEl.innerHTML = `<span><i class="fas fa-shield-alt mr-2"></i> SAFETY THRESHOLD ACHIEVED</span> <span>Clearance: ${res.newMissKm.toFixed(1)} km</span>`;
            } else {
                statusEl.className = "p-3 rounded border bg-red-950/60 border-red-400 text-red-300 font-bold flex items-center justify-between text-xs animate-pulse";
                statusEl.innerHTML = `<span><i class="fas fa-exclamation-triangle mr-2"></i> INSUFFICIENT CLEARANCE (&lt; 5.0 km)</span> <span>Increase Along-Track &Delta;V</span>`;
            }
        }
    }
    
    runAutoOptimizeCAM() {
        const satNorad = parseInt(document.getElementById('cam-satellite-select')?.value);
        const debNorad = parseInt(document.getElementById('cam-debris-select')?.value);
        const sat = this.objects.find(o => o.norad === satNorad);
        const deb = this.objects.find(o => o.norad === debNorad);
        if (!sat || !deb) return;
        
        const opt = autoOptimizeCAM(sat, deb, 5.0, 12.0);
        
        const sliderAlong = document.getElementById('cam-dv-along');
        const sliderLead = document.getElementById('cam-lead-time');
        const sliderCross = document.getElementById('cam-dv-cross');
        const sliderRadial = document.getElementById('cam-dv-radial');
        
        if (sliderAlong) sliderAlong.value = opt.recommendedAlongDeltaV_ms;
        if (sliderLead) sliderLead.value = opt.recommendedLeadTimeHours;
        if (sliderCross) sliderCross.value = 0;
        if (sliderRadial) sliderRadial.value = 0;
        
        this.updateCAMSimulation();
        this.audio.playBeep(1100, 0.1);
    }
    
    openImportModal() {
        document.getElementById('import-tle-modal')?.classList.remove('hidden');
    }
    
    closeImportModal() {
        document.getElementById('import-tle-modal')?.classList.add('hidden');
    }
    
    submitCustomTLE() {
        const name = document.getElementById('import-name')?.value || "CUSTOM SATELLITE";
        const cat = document.getElementById('import-type')?.value || "PAYLOAD";
        const tle1 = document.getElementById('import-tle1')?.value.trim();
        const tle2 = document.getElementById('import-tle2')?.value.trim();
        
        if (!tle1 || !tle2) {
            alert("Please paste valid TLE Line 1 and Line 2.");
            return;
        }
        
        const orb = parseTLE(tle1, tle2);
        if (!orb) {
            alert("Invalid TLE format. Please check NORAD element checksums.");
            return;
        }
        
        const newObj = {
            id: `custom_${orb.satNum}`,
            name: name.toUpperCase(),
            norad: orb.satNum,
            type: cat,
            category: "Custom Ingestion",
            country: "User Ingested",
            launch_year: 2026,
            mass_kg: 500,
            radius_m: 2.0,
            tle1: tle1,
            tle2: tle2,
            desc: "Custom orbital object ingested into OrbitGuard platform.",
            orbital: orb
        };
        
        this.objects.push(newObj);
        if (this.globe3D) this.globe3D.setCatalog(this.objects);
        this.scanAllConjunctions();
        this.renderObjectList();
        this.selectObject(newObj);
        this.closeImportModal();
        this.audio.playBeep(1000, 0.1);
    }
    
    async loadCelesTrakGroup(groupName) {
        const groupMap = {
            stations: 'stations',
            starlink: 'starlink',
            debris: '1999-057'
        };
        const celestrakGroup = groupMap[groupName];
        if (!celestrakGroup) return;

        this.audio.playBeep(850, 0.08);
        try {
            const response = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${celestrakGroup}&FORMAT=tle`);
            if (!response.ok) throw new Error(`CelesTrak returned ${response.status}`);
            const lines = (await response.text()).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            const incoming = [];

            for (let index = 0; index < lines.length - 2; index += 1) {
                if (!lines[index + 1].startsWith('1 ') || !lines[index + 2].startsWith('2 ')) continue;
                const orbital = parseTLE(lines[index + 1], lines[index + 2]);
                if (!orbital) continue;
                incoming.push({
                    id: `celestrak_${orbital.satNum}`,
                    name: lines[index].replace(/^0\s+/, '').toUpperCase(),
                    norad: orbital.satNum,
                    type: groupName === 'debris' ? 'DEBRIS' : (groupName === 'stations' ? 'STATION' : 'PAYLOAD'),
                    category: groupName === 'debris' ? 'Orbital Debris' : 'CelesTrak Catalog',
                    country: 'International',
                    launch_year: null,
                    mass_kg: 500,
                    radius_m: 2,
                    tle1: lines[index + 1],
                    tle2: lines[index + 2],
                    desc: `Live TLE loaded from the CelesTrak ${groupName} group.`,
                    orbital
                });
                index += 2;
            }

            if (!incoming.length) throw new Error('No valid TLEs were found in the response.');
            const existingNorads = new Set(this.objects.map(object => object.norad));
            const newObjects = incoming.filter(object => !existingNorads.has(object.norad));
            this.objects.push(...newObjects);
            if (this.globe3D) this.globe3D.setCatalog(this.objects);
            this.populateCAMSelectors();
            this.scanAllConjunctions();
            this.renderObjectList();
            alert(`Loaded ${newObjects.length} new object(s) from CelesTrak ${groupName}.`);
        } catch (error) {
            console.error(`Failed to load CelesTrak ${groupName}:`, error);
            alert(`Could not load CelesTrak ${groupName}. Check your network connection and try again.`);
        }
    }
    
    exportCSV() {
        let csv = "Conjunction_ID,Object1_Name,Object1_NORAD,Object2_Name,Object2_NORAD,Miss_Distance_km,Miss_Distance_m,Rel_Velocity_kms,TCA_Hours,Collision_Probability,Severity_Level,Risk_Score\n";
        for (const c of this.conjunctions) {
            csv += `"${c.id}","${c.obj1.name}",${c.obj1.norad},"${c.obj2.name}",${c.obj2.norad},${c.missDistanceKm.toFixed(3)},${c.missDistanceMeters.toFixed(1)},${c.relVelocityKms.toFixed(2)},${(c.timeToTcaSec/3600).toFixed(2)},${c.collisionProb.toExponential(4)},${c.severity},${c.riskScore}\n`;
        }
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `OrbitGuard_Conjunction_Report_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
        this.audio.playBeep(900, 0.05);
    }
    
    exportCDM() {
        if (!this.selectedConjunction && this.conjunctions.length > 0) {
            this.selectedConjunction = this.conjunctions[0];
        }
        if (!this.selectedConjunction) return;
        
        const cdmObj = generateCCSDS_CDM(this.selectedConjunction);
        const jsonStr = JSON.stringify(cdmObj, null, 2);
        
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `CCSDS_CDM_${this.selectedConjunction.id}.json`;
        link.click();
        this.audio.playBeep(900, 0.05);
    }
    
    startLoop() {
        const loop = (time) => {
            const dt = (time - this.lastFrameTime) / 1000.0;
            this.lastFrameTime = time;
            
            if (this.isPlaying) {
                this.simTimeSec += dt * this.simSpeed;
                
                // Update Timeline Scrubber
                const slider = document.getElementById('timeline-slider');
                if (slider) slider.value = this.simTimeSec % (48 * 3600);
            }
            
            // Format simulation time string
            const now = new Date(Date.now() + this.simTimeSec * 1000);
            const timeStr = now.toISOString().replace('T', ' ').substring(0, 19) + " UTC";
            const timeEl = document.getElementById('sim-clock-display');
            if (timeEl) timeEl.textContent = timeStr;
            this.setText('sim-elapsed-display', this.formatSimDuration(this.simTimeSec));
            
            // Render 3D Globe
            if (this.activeTab === '3d' && this.globe3D) {
                this.globe3D.update(this.simTimeSec, this.selectedObject, this.conjunctions, this.selectedConjunction);
            }
            
            // Render 2D Map
            if (this.activeTab === '2d' && this.map2D) {
                this.map2D.render(this.objects, this.simTimeSec, this.selectedObject, this.conjunctions);
            }
            
            // Update HUD telemetry periodically
            this.renderTelemetryHUD();
            this.updateCollisionVerdict();
            const panelRefreshSec = Math.floor(this.simTimeSec / 5);
            if (panelRefreshSec !== this.lastPanelRefreshSec) {
                this.lastPanelRefreshSec = panelRefreshSec;
                this.renderObjectList();
                this.renderConjunctionAlerts();
            }
            
            if (!this.disposed) {
                this.rafId = requestAnimationFrame(loop);
            }
        };
        this.rafId = requestAnimationFrame(loop);
    }

    updateAnalytics() {
        const total = this.conjunctions.length;
        const critCount = this.conjunctions.filter(c => c.severity === 'CRITICAL').length;
        const highCount = this.conjunctions.filter(c => c.severity === 'HIGH').length;
        const modCount  = this.conjunctions.filter(c => c.severity === 'MODERATE').length;
        const lowCount  = total - critCount - highCount - modCount;

        // Update summary card
        const totalEl = document.getElementById('analytics-total-conj');
        if (totalEl) totalEl.textContent = `${total} Encounter${total !== 1 ? 's' : ''}`;

        const summaryEl = document.getElementById('analytics-summary-detail');
        if (summaryEl) summaryEl.textContent =
            `${critCount} Critical (<1km), ${highCount} High (<5km), ${modCount} Moderate, ${lowCount} Low.`;

        // Mean relative velocity across all conjunctions
        if (this.conjunctions.length > 0) {
            const meanVel = this.conjunctions.reduce((s, c) => s + c.relVelocityKms, 0) / this.conjunctions.length;
            const velEl = document.getElementById('analytics-mean-vel');
            if (velEl) velEl.textContent = `${meanVel.toFixed(2)} km/s`;
        }

        // Per-altitude-shell debris count using live object catalog
        const shells = [
            { id: 'shell-300-450',  min: 300,   max: 450,   barId: 'bar-300-450'  },
            { id: 'shell-500-600',  min: 500,   max: 600,   barId: 'bar-500-600'  },
            { id: 'shell-700-950',  min: 700,   max: 950,   barId: 'bar-700-950'  },
            { id: 'shell-1000-1300',min: 1000,  max: 1300,  barId: 'bar-1000-1300'},
        ];
        const totObjs = Math.max(1, this.objects.length);
        shells.forEach(sh => {
            const count = this.objects.filter(o => {
                if (!o.orbital) return false;
                const altPeri = o.orbital.a * (1 - o.orbital.e) - R_EARTH;
                const altApo  = o.orbital.a * (1 + o.orbital.e) - R_EARTH;
                return altPeri <= sh.max && altApo >= sh.min;
            }).length;
            const pct = Math.min(100, Math.round((count / totObjs) * 100 * 3));
            const barEl = document.getElementById(sh.barId);
            if (barEl) barEl.style.width = `${pct}%`;
        });
    }

    toggleTheme() {
        const html = document.documentElement;
        const icon = document.getElementById('theme-icon');
        
        if (html.classList.contains('dark')) {
            html.classList.remove('dark');
            if (icon) {
                icon.classList.remove('fa-moon');
                icon.classList.add('fa-sun', 'text-amber-500');
            }
        } else {
            html.classList.add('dark');
            if (icon) {
                icon.classList.remove('fa-sun', 'text-amber-500');
                icon.classList.add('fa-moon');
            }
        }
    }

    dispose() {
        this.disposed = true;
        if (this.rafId) cancelAnimationFrame(this.rafId);
    }
}

// Global bootstrap
window.OrbitGuardApp = OrbitGuardApp;
window.bootstrapOrbitGuard = () => {
    if (!window.orbitApp) {
        window.orbitApp = new OrbitGuardApp();
    }
    return window.orbitApp;
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', window.bootstrapOrbitGuard, { once: true });
} else {
    window.bootstrapOrbitGuard();
}






