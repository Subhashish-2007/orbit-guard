/**
 * ORBITGUARD - 2D Interactive Ground Track & Sensor Footprint Canvas Engine
 */

class Map2D {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.selectedObject = null;
        this.hoveredObject = null;
        this.simTimeSec = 0;
        this.objects = [];
        this.conjunctions = [];
        
        this.initEvents();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }
    
    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.width = this.canvas.width = rect.width;
        this.height = this.canvas.height = rect.height;
    }
    
    initEvents() {
        if (!this.canvas) return;
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Check hovered satellite
            let found = null;
            for (const obj of this.objects) {
                if (!obj.lastState) continue;
                const pos = this.latLonToXY(obj.lastState.lat, obj.lastState.lon);
                const dist = Math.sqrt((x - pos.x)**2 + (y - pos.y)**2);
                if (dist < 12) {
                    found = obj;
                    break;
                }
            }
            this.hoveredObject = found;
            this.canvas.style.cursor = found ? 'pointer' : 'crosshair';
        });
        
        this.canvas.addEventListener('click', (e) => {
            if (this.hoveredObject && window.orbitApp) {
                window.orbitApp.selectObject(this.hoveredObject);
            }
        });
    }
    
    latLonToXY(lat, lon) {
        // Lon: -180..180 -> 0..width
        // Lat: 90..-90   -> 0..height
        const x = ((lon + 180) % 360) / 360.0 * this.width;
        const y = (90 - lat) / 180.0 * this.height;
        return { x, y };
    }
    
    drawWorldMap() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        
        // Ocean background
        const oceanGrad = ctx.createLinearGradient(0, 0, 0, h);
        oceanGrad.addColorStop(0, '#060b1d');
        oceanGrad.addColorStop(0.5, '#040815');
        oceanGrad.addColorStop(1, '#060b1d');
        ctx.fillStyle = oceanGrad;
        ctx.fillRect(0, 0, w, h);
        
        // Grid lines (lat/lon 30 deg)
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.lineWidth = 1;
        
        // Longitude lines
        for (let lon = -180; lon <= 180; lon += 30) {
            const x = ((lon + 180) / 360.0) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            
            // Labels
            ctx.fillStyle = 'rgba(0, 240, 255, 0.3)';
            ctx.font = '9px monospace';
            if (lon % 60 === 0 && lon !== 180) {
                ctx.fillText(`${Math.abs(lon)}°${lon >= 0 ? 'E' : 'W'}`, x + 3, h - 6);
            }
        }
        
        // Latitude lines
        for (let lat = -90; lat <= 90; lat += 30) {
            const y = ((90 - lat) / 180.0) * h;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            
            if (lat !== -90 && lat !== 90) {
                ctx.fillText(`${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`, 5, y - 3);
            }
        }
        
        // Equator & Prime Meridian highlight
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
        ctx.lineWidth = 1.5;
        const eqY = (90 / 180.0) * h;
        ctx.beginPath(); ctx.moveTo(0, eqY); ctx.lineTo(w, eqY); ctx.stroke();
        
        const pmX = (180 / 360.0) * w;
        ctx.beginPath(); ctx.moveTo(pmX, 0); ctx.lineTo(pmX, h); ctx.stroke();
        
        // Realistic Vector Continents
        ctx.fillStyle = 'rgba(15, 30, 65, 0.75)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
        ctx.lineWidth = 1.2;
        
        const continents = [
            // North America
            [[-168, 65], [-160, 71], [-130, 70], [-90, 70], [-80, 50], [-65, 45], [-80, 25], [-90, 18], [-105, 20], [-120, 35], [-125, 50], [-140, 60], [-168, 65]],
            // South America
            [[-80, 10], [-50, -5], [-35, -5], [-40, -22], [-55, -35], [-65, -55], [-75, -50], [-70, -20], [-80, 0], [-80, 10]],
            // Europe & Asia
            [[-10, 36], [0, 45], [10, 55], [25, 71], [60, 70], [100, 75], [140, 72], [170, 65], [140, 35], [120, 20], [105, 10], [80, 10], [70, 25], [60, 25], [50, 12], [35, 30], [25, 36], [-10, 36]],
            // Africa
            [[-17, 30], [10, 37], [30, 30], [50, 12], [40, -10], [30, -34], [18, -34], [10, 5], [-15, 12], [-17, 30]],
            // Australia
            [[113, -22], [130, -12], [145, -15], [153, -28], [148, -40], [135, -35], [115, -35], [113, -22]],
            // Antarctica
            [[-180, -75], [-120, -70], [-60, -65], [0, -70], [60, -65], [120, -70], [180, -75], [180, -90], [-180, -90]],
            // Greenland
            [[-55, 83], [-20, 80], [-25, 70], [-45, 60], [-55, 70], [-55, 83]],
            // India sub-contour
            [[68, 24], [72, 18], [77, 8], [80, 13], [88, 22], [80, 28], [68, 24]]
        ];
        
        for (const poly of continents) {
            ctx.beginPath();
            for (let i = 0; i < poly.length; i++) {
                const pt = this.latLonToXY(poly[i][1], poly[i][0]);
                if (i === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        
        this.drawDayNightTerminator();
    }
    
    drawDayNightTerminator() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        
        // Subsolar longitude from GMST and simulation time
        const sunLon = (-(this.simTimeSec * OMEGA_E * 180.0 / Math.PI) % 360);
        const sunLat = 12.0 * Math.sin(this.simTimeSec * 2 * Math.PI / (365.25 * 86400)); // Seasonal declination
        
        ctx.fillStyle = 'rgba(0, 0, 15, 0.45)';
        ctx.beginPath();
        
        // Night side shadow mask
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 4) {
            const lon = (x / w) * 360.0 - 180.0;
            const deltaLonRad = (lon - sunLon) * Math.PI / 180.0;
            // Terminator curve equation: tan(lat) = -cos(deltaLon) / tan(sunLat)
            const tanTermLat = -Math.cos(deltaLonRad) / Math.tan(Math.max(0.01, Math.abs(sunLat)) * Math.PI / 180.0);
            let termLat = Math.atan(tanTermLat) * 180.0 / Math.PI;
            if (sunLat < 0) termLat = -termLat;
            
            const pt = this.latLonToXY(termLat, lon);
            ctx.lineTo(pt.x, Math.max(0, Math.min(h, pt.y)));
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
    }
    
    render(objects, simTimeSec, selectedObj, conjunctions) {
        if (!this.canvas) return;
        this.objects = objects;
        this.simTimeSec = simTimeSec;
        this.selectedObject = selectedObj;
        this.conjunctions = conjunctions || [];
        
        this.drawWorldMap();
        const ctx = this.ctx;
        
        // 1. Draw Ground Tracks for Selected or High-Risk Objects
        const trackedObjects = this.selectedObject ? [this.selectedObject] : this.objects.slice(0, 6);
        
        for (const obj of trackedObjects) {
            if (!obj.orbital) continue;
            const track = calculateGroundTrack(obj.orbital, simTimeSec - obj.orbital.periodMin*30, 140, 2);
            
            ctx.strokeStyle = obj.type === "DEBRIS" ? "rgba(255, 51, 102, 0.6)" : (obj.type === "STATION" ? "rgba(0, 255, 153, 0.7)" : "rgba(0, 240, 255, 0.6)");
            ctx.lineWidth = (obj === this.selectedObject) ? 2.2 : 1.2;
            ctx.setLineDash([4, 4]);
            
            let lastPt = null;
            ctx.beginPath();
            for (const pt of track) {
                const xy = this.latLonToXY(pt.lat, pt.lon);
                // Break line on map wraparound
                if (lastPt && Math.abs(xy.x - lastPt.x) > this.width * 0.5) {
                    ctx.stroke();
                    ctx.beginPath();
                }
                if (!lastPt || Math.abs(xy.x - lastPt.x) > this.width * 0.5) {
                    ctx.moveTo(xy.x, xy.y);
                } else {
                    ctx.lineTo(xy.x, xy.y);
                }
                lastPt = xy;
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }
        
        // 2. Draw Sensor Footprints (3dB Cones)
        if (this.selectedObject && this.selectedObject.lastState) {
            const pos = this.latLonToXY(this.selectedObject.lastState.lat, this.selectedObject.lastState.lon);
            const radiusPx = (this.selectedObject.lastState.footprintRadiusKm / (2 * Math.PI * R_EARTH)) * this.width * 0.7;
            
            ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, Math.max(10, radiusPx), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        
        // 3. Draw All Satellite & Debris Markers
        for (const obj of objects) {
            if (!obj.orbital) continue;
            const state = propagateOrbit(obj.orbital, simTimeSec);
            obj.lastState = state;
            
            const pt = this.latLonToXY(state.lat, state.lon);
            const isSelected = (obj === this.selectedObject);
            const isHovered = (obj === this.hoveredObject);
            
            let color = "#00f0ff";
            let size = 4;
            if (obj.type === "STATION") { color = "#00ff99"; size = 6; }
            else if (obj.type === "DEBRIS") { color = "#ff3366"; size = 3.5; }
            else if (obj.type === "ROCKET_BODY") { color = "#ffaa00"; size = 4.5; }
            else if (obj.type === "STARLINK") { color = "#38bdf8"; size = 3; }
            
            if (isSelected) {
                // Pulsing target ring
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, size + 6, 0, Math.PI * 2);
                ctx.stroke();
                
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, size + 10, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            // Core marker
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = (isSelected || isHovered) ? 12 : 5;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            
            // Label for selected or hovered
            if (isSelected || isHovered || obj.type === "STATION") {
                ctx.fillStyle = '#ffffff';
                ctx.font = '10px "Inter", sans-serif';
                ctx.fillText(obj.name, pt.x + size + 4, pt.y + 3);
            }
        }
        
        // 4. Draw Conjunction Ground Epicenter Flares
        for (const conj of this.conjunctions.slice(0, 5)) {
            if (!conj.lat_tca || !conj.lon_tca) continue;
            const pt = this.latLonToXY(conj.lat_tca, conj.lon_tca);
            
            ctx.strokeStyle = conj.severityColor || "#ff3366";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            
            ctx.fillStyle = conj.severityColor;
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.fillText(`⚡ TCA: ${conj.missDistanceMeters.toFixed(0)}m`, pt.x + 16, pt.y + 3);
        }
    }
}
