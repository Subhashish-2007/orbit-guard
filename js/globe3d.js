/**
 * ORBITGUARD - 3D Interactive WebGL Earth Globe & Orbital Trajectory Renderer (Three.js)
 */

class Globe3D {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.objects = [];
        this.satMeshes = new Map();
        this.orbitLines = new Map();
        this.conjunctionLines = [];
        this.selectedObject = null;
        this.selectedConjunction = null;
        this.cameraMode = "FREE"; // FREE, FOCUS, FOLLOW
        this.earthRadius = 100.0;
        this.scaleKmToUnit = 100.0 / R_EARTH;
        
        this.initThree();
        this.createEarth();
        this.createStars();
        this.initControls();
        this.animate();
    }
    
    initThree() {
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, w / h, 1, 5000);
        this.camera.position.set(0, 150, 320);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.container.appendChild(this.renderer.domElement);
        
        // Lighting
        this.ambientLight = new THREE.AmbientLight(0x223355, 1.2);
        this.scene.add(this.ambientLight);
        
        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
        this.sunLight.position.set(500, 200, 300);
        this.scene.add(this.sunLight);
        
        // Window Resize
        window.addEventListener('resize', () => this.onResize());
        
        // Raycasting for object selection
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const clickableMeshes = Array.from(this.satMeshes.values()).map(item => item.mesh);
            const intersects = this.raycaster.intersectObjects(clickableMeshes);
            
            if (intersects.length > 0) {
                const hitMesh = intersects[0].object;
                for (const [obj, data] of this.satMeshes.entries()) {
                    if (data.mesh === hitMesh) {
                        if (window.orbitApp) window.orbitApp.selectObject(obj);
                        break;
                    }
                }
            }
        });
    }
    
    onResize() {
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }
    
    initControls() {
        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.minDistance = 110;
            this.controls.maxDistance = 1500;
        }
    }
    
    createEarth() {
        // High-Quality Procedural Earth Canvas Texture
        const canvas = document.createElement('canvas');
        canvas.width = 2048;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        
        // Ocean Blue gradient
        const ocean = ctx.createLinearGradient(0, 0, 0, 1024);
        ocean.addColorStop(0, '#040d28');
        ocean.addColorStop(0.5, '#07163d');
        ocean.addColorStop(1, '#040d28');
        ctx.fillStyle = ocean;
        ctx.fillRect(0, 0, 2048, 1024);
        
        // Lat/Lon grid
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= 2048; x += 170.66) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1024); ctx.stroke();
        }
        for (let y = 0; y <= 1024; y += 85.33) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(2048, y); ctx.stroke();
        }
        
        // Continent landmass shapes
        ctx.fillStyle = '#0f2952';
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        
        const mapW = 2048, mapH = 1024;
        const toCanvas = (lon, lat) => ({
            x: ((lon + 180) / 360.0) * mapW,
            y: ((90 - lat) / 180.0) * mapH
        });
        
        const continents = [
            [[-168, 65], [-160, 71], [-130, 70], [-90, 70], [-80, 50], [-65, 45], [-80, 25], [-90, 18], [-105, 20], [-120, 35], [-125, 50], [-140, 60], [-168, 65]],
            [[-80, 10], [-50, -5], [-35, -5], [-40, -22], [-55, -35], [-65, -55], [-75, -50], [-70, -20], [-80, 0], [-80, 10]],
            [[-10, 36], [0, 45], [10, 55], [25, 71], [60, 70], [100, 75], [140, 72], [170, 65], [140, 35], [120, 20], [105, 10], [80, 10], [70, 25], [60, 25], [50, 12], [35, 30], [25, 36], [-10, 36]],
            [[-17, 30], [10, 37], [30, 30], [50, 12], [40, -10], [30, -34], [18, -34], [10, 5], [-15, 12], [-17, 30]],
            [[113, -22], [130, -12], [145, -15], [153, -28], [148, -40], [135, -35], [115, -35], [113, -22]],
            [[-180, -75], [-120, -70], [-60, -65], [0, -70], [60, -65], [120, -70], [180, -75], [180, -90], [-180, -90]],
            [[-55, 83], [-20, 80], [-25, 70], [-45, 60], [-55, 70], [-55, 83]],
            [[68, 24], [72, 18], [77, 8], [80, 13], [88, 22], [80, 28], [68, 24]]
        ];
        
        for (const poly of continents) {
            ctx.beginPath();
            for (let i = 0; i < poly.length; i++) {
                const pt = toCanvas(poly[i][0], poly[i][1]);
                if (i === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        
        const earthTexture = new THREE.CanvasTexture(canvas);
        const earthGeo = new THREE.SphereGeometry(this.earthRadius, 64, 64);
        const earthMat = new THREE.MeshPhongMaterial({
            map: earthTexture,
            specular: new THREE.Color(0x00f0ff),
            shininess: 15,
            emissive: new THREE.Color(0x020818)
        });
        
        this.earthMesh = new THREE.Mesh(earthGeo, earthMat);
        this.scene.add(this.earthMesh);
        
        // Atmosphere Outer Glow Shell
        const atmoGeo = new THREE.SphereGeometry(this.earthRadius * 1.025, 64, 64);
        const atmoMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.15,
            side: THREE.BackSide
        });
        this.atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
        this.scene.add(this.atmoMesh);
        
        // Equator Wire Ring
        const ringGeo = new THREE.RingGeometry(this.earthRadius * 1.002, this.earthRadius * 1.006, 64);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2;
        this.scene.add(ringMesh);
    }
    
    createStars() {
        const starGeo = new THREE.BufferGeometry();
        const starCount = 2000;
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        
        for (let i = 0; i < starCount; i++) {
            const r = 1800 + Math.random() * 800;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            
            positions[i*3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i*3+2] = r * Math.cos(phi);
            
            const brightness = 0.6 + Math.random() * 0.4;
            colors[i*3] = brightness * (0.8 + Math.random() * 0.2);
            colors[i*3+1] = brightness * (0.9 + Math.random() * 0.1);
            colors[i*3+2] = brightness;
        }
        
        starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const starMat = new THREE.PointsMaterial({
            size: 2.2,
            vertexColors: true,
            transparent: true,
            opacity: 0.85
        });
        
        this.starMesh = new THREE.Points(starGeo, starMat);
        this.scene.add(this.starMesh);
    }
    
    setCatalog(objects) {
        this.objects = objects;
        
        // Remove old meshes and lines
        for (const [obj, data] of this.satMeshes.entries()) {
            this.scene.remove(data.mesh);
            if (data.glow) this.scene.remove(data.glow);
        }
        this.satMeshes.clear();
        
        for (const line of this.orbitLines.values()) {
            this.scene.remove(line);
        }
        this.orbitLines.clear();
        
        // Build 3D orbits and markers
        for (const obj of objects) {
            if (!obj.orbital) continue;
            this.createOrbitPath(obj);
            this.createSatelliteMesh(obj);
        }
    }
    
    getCategoryColor(type) {
        switch (type) {
            case "STATION": return 0x00ff99; // Emerald green
            case "PAYLOAD": return 0x00f0ff; // Cyan
            case "STARLINK": return 0x38bdf8; // Sky blue
            case "ROCKET_BODY": return 0xffaa00; // Amber orange
            case "DEBRIS": return 0xff2a55; // Hot Crimson Red
            case "DEFUNCT": return 0xa855f7; // Purple
            default: return 0x00f0ff;
        }
    }
    
    createOrbitPath(obj) {
        const points = [];
        const numPoints = 128;
        const periodSec = obj.orbital.periodMin * 60;
        const color = this.getCategoryColor(obj.type);
        
        for (let k = 0; k <= numPoints; k++) {
            const dt = (k / numPoints) * periodSec;
            const state = propagateOrbit(obj.orbital, dt);
            const scale = this.scaleKmToUnit;
            // ECI to Three.js coordinate system (Y-up, X-right, Z-depth)
            points.push(new THREE.Vector3(state.r_eci[0] * scale, state.r_eci[2] * scale, -state.r_eci[1] * scale));
        }
        
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: obj.type === "DEBRIS" ? 0.35 : 0.65,
            linewidth: obj.type === "STATION" ? 2 : 1
        });
        
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this.orbitLines.set(obj, line);
    }
    
    createSatelliteMesh(obj) {
        const color = this.getCategoryColor(obj.type);
        let radius = 1.2;
        if (obj.type === "STATION") radius = 2.4;
        else if (obj.type === "DEBRIS") radius = 0.8;
        else if (obj.type === "ROCKET_BODY") radius = 1.6;
        
        const geo = new THREE.SphereGeometry(radius, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color: color });
        const mesh = new THREE.Mesh(geo, mat);
        
        // Outer halo sprite
        const haloGeo = new THREE.SphereGeometry(radius * 2.2, 16, 16);
        const haloMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.35, wireframe: true });
        const glow = new THREE.Mesh(haloGeo, haloMat);
        mesh.add(glow);

        const state = propagateOrbit(obj.orbital, window.orbitApp?.simTimeSec || 0);
        obj.lastState = state;
        const scale = this.scaleKmToUnit;
        mesh.position.set(state.r_eci[0] * scale, state.r_eci[2] * scale, -state.r_eci[1] * scale);
        
        this.scene.add(mesh);
        this.satMeshes.set(obj, { mesh, glow, radius });
    }
    
    update(simTimeSec, selectedObj, conjunctions, selectedConjunction) {
        this.selectedObject = selectedObj;
        this.selectedConjunction = selectedConjunction;
        
        // Rotate Earth according to GMST
        const earthRotation = (simTimeSec * OMEGA_E) % (2 * Math.PI);
        this.earthMesh.rotation.y = earthRotation;
        
        const scale = this.scaleKmToUnit;
        
        // Update all object 3D positions
        for (const [obj, data] of this.satMeshes.entries()) {
            const state = propagateOrbit(obj.orbital, simTimeSec);
            obj.lastState = state;
            
            const x = state.r_eci[0] * scale;
            const y = state.r_eci[2] * scale;
            const z = -state.r_eci[1] * scale;
            data.mesh.position.set(x, y, z);
            
            const isSelected = (obj === this.selectedObject);
            if (isSelected) {
                data.mesh.scale.set(1.8, 1.8, 1.8);
                data.glow.material.opacity = 0.8;
            } else {
                data.mesh.scale.set(1.0, 1.0, 1.0);
                data.glow.material.opacity = 0.35;
            }
        }
        
        // Update Conjunction Laser Links & Hazard Spheres
        this.updateConjunctionVisuals(simTimeSec, conjunctions, selectedConjunction);
        
        // Camera Modes
        if (this.cameraMode === "FOCUS" && this.selectedObject && this.satMeshes.has(this.selectedObject)) {
            const targetPos = this.satMeshes.get(this.selectedObject).mesh.position;
            if (this.controls) {
                this.controls.target.lerp(targetPos, 0.08);
            }
        } else if (this.cameraMode === "FOLLOW" && this.selectedObject && this.selectedObject.lastState) {
            const meshPos = this.satMeshes.get(this.selectedObject).mesh.position;
            const v = this.selectedObject.lastState.v_eci;
            const vUnit = new THREE.Vector3(v[0]*scale, v[2]*scale, -v[1]*scale).normalize();
            
            const camTarget = meshPos.clone().sub(vUnit.clone().multiplyScalar(30)).add(new THREE.Vector3(0, 15, 0));
            this.camera.position.lerp(camTarget, 0.08);
            this.camera.lookAt(meshPos);
        }
        
        if (this.controls) this.controls.update();
    }
    
    updateConjunctionVisuals(simTimeSec, conjunctions, selectedConjunction) {
        // Clear previous visual links
        for (const item of this.conjunctionLines) {
            this.scene.remove(item);
        }
        this.conjunctionLines = [];
        
        const scale = this.scaleKmToUnit;
        const activeConjs = selectedConjunction ? [selectedConjunction] : (conjunctions || []).slice(0, 4);
        
        for (const conj of activeConjs) {
            const m1 = this.satMeshes.get(conj.obj1);
            const m2 = this.satMeshes.get(conj.obj2);
            if (!m1 || !m2) continue;
            
            const p1 = m1.mesh.position;
            const p2 = m2.mesh.position;
            const distUnits = p1.distanceTo(p2);
            
            // Draw connecting laser beam
            const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
            const mat = new THREE.LineDashedMaterial({
                color: conj.severityColor ? parseInt(conj.severityColor.replace('#', '0x')) : 0xff2a55,
                linewidth: 2,
                dashSize: 3,
                gapSize: 1.5
            });
            const line = new THREE.Line(geo, mat);
            line.computeLineDistances();
            this.scene.add(line);
            this.conjunctionLines.push(line);
            
            // Draw hazard collision sphere at midpoint
            if (conj.missDistanceKm < 5.0 || conj === selectedConjunction) {
                const mid = p1.clone().add(p2).multiplyScalar(0.5);
                const sphereGeo = new THREE.SphereGeometry(Math.max(1.5, conj.missDistanceKm * scale * 2.0), 16, 16);
                const sphereMat = new THREE.MeshBasicMaterial({
                    color: 0xff2a55,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.4
                });
                const sphere = new THREE.Mesh(sphereGeo, sphereMat);
                sphere.position.copy(mid);
                this.scene.add(sphere);
                this.conjunctionLines.push(sphere);
            }
        }
    }
    
    setCameraMode(mode) {
        this.cameraMode = mode;
        if (mode === "FREE" && this.controls) {
            this.controls.target.set(0, 0, 0);
        }
    }
    
    resetView() {
        this.cameraMode = "FREE";
        if (this.controls) {
            this.controls.target.set(0, 0, 0);
        }
        this.camera.position.set(0, 150, 320);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render(this.scene, this.camera);
    }
}
