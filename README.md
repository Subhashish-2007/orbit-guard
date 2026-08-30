# SMART INDIA HACKATHON 2026 - INTERNAL | ORBITGUARD | Space Debris Tracking & Satellite Collision Risk Prediction Dashboard 
**Problem Statement PS-04 | Category: Software | Theme: Space Technology**

---

## 1. Executive Summary
**OrbitGuard** is an open, modular, aerospace-grade web platform designed to ingest publicly available Two-Line Element (TLE) orbital data from CelesTrak / Space-Track, track active satellites and space debris in near-real-time, predict close-approach ("conjunction") collision events using physics-based orbital propagation, and visualize collision risks with an intuitive risk scoring system, 3D WebGL orbit view, and 2D ground track map.

---

## 2. Problem Statement (PS-04) Requirements Matrix

| Requirement | Implementation in OrbitGuard |
| :--- | :--- |
| **Live/near-live orbital tracking using open TLE datasets** | High-precision SGP4 / $J_2$ secular perturbation Keplerian orbital propagator. 35+ realistic active payloads, space stations, Starlink constellation nodes, derelict rocket bodies, and collision debris fragments. | 
| **Conjunction detection between object pairs with risk scoring** | Multi-tier pairwise conjunction detection engine (altitude pre-filter, coarse time-stepping, sub-second golden section search). Calculates TCA, 3D separation vector ($\Delta R, \Delta T, \Delta W$ in Hill/RSW frame), relative velocity, Foster 2D Gaussian collision probability ($P_c$), and 0-100 composite collision risk score. | 
| **3D / 2D visualization of orbits and flagged risk events** | **3D WebGL Earth Globe (Three.js)** with procedural high-resolution textures, atmospheric glow, orbit path ribbons, glowing satellite markers, collision envelope hazard spheres, and flashing laser link lines between closing pairs.<br>**2D Ground Track View (Canvas2D)** with equirectangular continental projection, sensor footprint coverage circles ($3\text{dB}$ cones), live subsatellite icons with heading vectors, and day/night solar terminator curve. |
| **Simple alert list for "high-risk" upcoming conjunctions** | Real-time ranked alert feed with color-coded severity badges (🔴 **CRITICAL**, 🟠 **HIGH**, 🟡 **MODERATE**, 🟢 **LOW**), live TCA countdown timers ($T-01\text{h } 28\text{m } 14\text{s}$), and full telemetry inspector modal. |

---

## 3. Mathematical & Physical Formulations

### 3.1 SGP4 / $J_2$ Perturbation Model
The gravitational potential of the non-spherical Earth with the $J_2$ second zonal harmonic is:
$$V(r, \phi) = -\frac{\mu}{r} \left[ 1 - J_2 \left(\frac{R_E}{r}\right)^2 \frac{3\sin^2\phi - 1}{2} \right]$$

The resulting secular drift rates for the Right Ascension of the Ascending Node ($\dot{\Omega}$) and Argument of Perigee ($\dot{\omega}$) are:
$$\dot{\Omega} = -\frac{3}{2} J_2 \left(\frac{R_E}{p}\right)^2 n \cos i$$
$$\dot{\omega} = \frac{3}{4} J_2 \left(\frac{R_E}{p}\right)^2 n (5\cos^2 i - 1)$$
where $p = a(1 - e^2)$, $n = \sqrt{\mu / a^3}$, and $R_E = 6378.137\text{ km}$.

### 3.2 Kepler's Equation Solution
Mean Anomaly $M(t) = M_0 + n \cdot \Delta t$ is solved for Eccentric Anomaly $E$ using Newton-Raphson iteration:
$$E_{k+1} = E_k - \frac{E_k - e\sin E_k - M}{1 - e\cos E_k}$$

True anomaly $\nu$ and radius $r$:
$$\cos\nu = \frac{\cos E - e}{1 - e\cos E}, \quad \sin\nu = \frac{\sqrt{1-e^2}\sin E}{1 - e\cos E}$$
$$r = a(1 - e\cos E)$$

### 3.3 2D Collision Probability ($P_c$) - Foster / Akella Model
In the encounter B-plane, assuming combined spherical hard-body radius $R = r_1 + r_2$ and isotropic positional covariance $\sigma$:
$$P_c = \frac{R^2}{2\sigma^2} \exp\left( -\frac{d_{\text{miss}}^2}{2\sigma^2} \right)$$

---

## 4. Verified Conjunction Events in Demo Dataset

| Rank | Severity | Primary Object | Secondary Object | Miss Distance | Time to TCA | Relative Velocity | Collision Prob ($P_c$) |
| :---: | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| 1 | 🔴 **CRITICAL** | ISS (ZARYA) | COSMOS 2251 DEB [33834] | **350.0 m** | +1.47 hrs | **9.96 km/s** | **7.58e-3** |
| 2 | 🔴 **CRITICAL** | STARLINK-1007 | COSMOS 2251 DEB [34210] | **650.0 m** | +5.20 hrs | **7.07 km/s** | **2.23e-6** |
| 3 | 🔴 **CRITICAL** | HST (HUBBLE) | CZ-3B R/B [32489] | **820.0 m** | +8.50 hrs | **8.70 km/s** | **3.45e-7** |
| 4 | 🟠 **HIGH** | NOAA 20 (JPSS-1) | FENGYUN 1C DEB [31210] | **1450.0 m** | +12.10 hrs | **2.73 km/s** | **7.35e-9** |
| 5 | 🟠 **HIGH** | CARTOSAT-2A | MICROSAT-R DEB [44105] | **3200.0 m** | +27.20 hrs | **0.37 km/s** | **1.55e-23** |
| 6 | 🟠 **HIGH** | TIANGONG (CSS) | SL-8 R/B [12340] | **3324.7 m** | +21.37 hrs | **13.12 km/s** | **6.63e-63** |
| 7 | 🟠 **HIGH** | SENTINEL-6A | SL-16 R/B [22220] | **3800.0 m** | +21.40 hrs | **13.21 km/s** | **3.25e-82** |
| 8 | 🟠 **HIGH** | ONEWEB-0128 | ONEWEB-0135 | **4131.7 m** | +43.40 hrs | **3.70 km/s** | **1.53e-97** |
| 9 | 🟠 **HIGH** | LANDSAT 9 | IRIDIUM 33 DEB [34012] | **4800.0 m** | +33.60 hrs | **14.99 km/s** | **1.00e-100** |
| 10 | 🟡 **MODERATE**| TERRA (EOS AM-1) | FENGYUN 1C DEB [29745] | **6471.2 m** | +37.96 hrs | **0.06 km/s** | $0.00$ |

---

## 5. How to Run & Use the Dashboard

1. **Development Server (Recommended)**:
   This project uses Vite for fast local development.
   ```bash
   cd orbit-guard
   npm install
   npm run dev
   ```
   Open `http://localhost:5173` in your web browser.

2. **Production Build**:
   ```bash
   npm run build
   ```
   This will generate optimized, minified files in the `dist/` directory ready for deployment.

3. **Standalone Static Version**:
   - You can also run `node build_standalone.js` to compile everything into a single portable `standalone_app.html` file that can be opened directly in any browser without a web server.

4. **Key Interactive Controls**:
   - **Time Warp Controls (Bottom Bar)**: Play/Pause, Step $\pm 5\text{ min}$, Time Warp speeds (`1x`, `10x`, `60x`, `300x`, `1000x`), Jump to Next TCA.
   - **Tab Deck**: Switch between 3D Globe, 2D Ground Track, Conjunction Matrix, TLE Manager, and Risk Analytics.
   - **Inspect Conjunctions**: Click any alert or table row to inspect telemetry and review closest approach details.
