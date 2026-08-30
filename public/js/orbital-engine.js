var MU = 398600.4418; // Earth gravitational parameter, km^3/s^2
var R_EARTH = 6378.137; // WGS84 Earth Equatorial Radius, km
var J2 = 1.08262668e-3; // Earth J2 zonal harmonic
var OMEGA_E = 7.292115e-5; // Earth rotation rate, rad/s

/**
 * ORBITGUARD - SGP4 / J2 Perturbation Orbital Mechanics Engine
 */

 // km^3/s^2 (Earth gravitational parameter)
 // km (WGS84 Earth Equatorial Radius)
 // Earth J2 zonal harmonic
 // rad/s (Earth rotation rate)

function parseTLE(tle1, tle2) {
    try {
        const satNum = parseInt(tle1.substring(2, 7));
        const incDeg = parseFloat(tle2.substring(8, 16));
        const raanDeg = parseFloat(tle2.substring(17, 25));
        const eccStr = "0." + tle2.substring(26, 33).trim();
        const ecc = parseFloat(eccStr);
        const wDeg = parseFloat(tle2.substring(34, 42));
        const m0Deg = parseFloat(tle2.substring(43, 51));
        const meanMotionRevDay = parseFloat(tle2.substring(52, 63));
        
        const n_rad_s = meanMotionRevDay * 2 * Math.PI / 86400.0;
        const a = Math.pow(MU / (n_rad_s * n_rad_s), 1.0 / 3.0);
        
        return {
            satNum: satNum,
            i: incDeg * Math.PI / 180.0,
            raan: raanDeg * Math.PI / 180.0,
            e: Math.max(1e-6, Math.min(0.99, ecc)),
            w: wDeg * Math.PI / 180.0,
            M0: m0Deg * Math.PI / 180.0,
            n: n_rad_s,
            a: a,
            meanMotion: meanMotionRevDay,
            periodMin: 1440.0 / meanMotionRevDay,
            incDeg: incDeg,
            raanDeg: raanDeg,
            wDeg: wDeg,
            m0Deg: m0Deg
        };
    } catch(e) {
        console.error("TLE parse error:", e);
        return null;
    }
}

function solveKepler(M, e) {
    let E = M;
    for (let iter = 0; iter < 12; iter++) {
        const f = E - e * Math.sin(E) - M;
        const fPrime = 1.0 - e * Math.cos(E);
        const dE = f / fPrime;
        E -= dE;
        if (Math.abs(dE) < 1e-10) break;
    }
    return E;
}

function propagateOrbit(orb, dt_sec, gmst_0 = 0.0) {
    const a = orb.a;
    const e = orb.e;
    const i = orb.i;
    const n = orb.n;
    const p = a * (1.0 - e * e);
    
    // J2 secular perturbation rates
    const draan = -1.5 * J2 * Math.pow(R_EARTH / p, 2) * n * Math.cos(i);
    const dw = 0.75 * J2 * Math.pow(R_EARTH / p, 2) * n * (5.0 * Math.pow(Math.cos(i), 2) - 1.0);
    
    const raan = (orb.raan + draan * dt_sec) % (2 * Math.PI);
    const w = (orb.w + dw * dt_sec) % (2 * Math.PI);
    const M = (orb.M0 + n * dt_sec) % (2 * Math.PI);
    
    const E = solveKepler(M, e);
    const sinNu = Math.sqrt(1.0 - e * e) * Math.sin(E) / (1.0 - e * Math.cos(E));
    const cosNu = (Math.cos(E) - e) / (1.0 - e * Math.cos(E));
    const nu = Math.atan2(sinNu, cosNu);
    const r = a * (1.0 - e * Math.cos(E));
    
    // Perifocal coordinates
    const r_pqw = [r * Math.cos(nu), r * Math.sin(nu), 0.0];
    const v_factor = Math.sqrt(MU / p);
    const v_pqw = [-v_factor * Math.sin(nu), v_factor * (e + Math.cos(nu)), 0.0];
    
    // Rotation matrix to ECI (J2000)
    const cos_raan = Math.cos(raan), sin_raan = Math.sin(raan);
    const cos_i = Math.cos(i), sin_i = Math.sin(i);
    const cos_w = Math.cos(w), sin_w = Math.sin(w);
    
    const R = [
        [cos_raan * cos_w - sin_raan * sin_w * cos_i, -cos_raan * sin_w - sin_raan * cos_w * cos_i, sin_raan * sin_i],
        [sin_raan * cos_w + cos_raan * sin_w * cos_i, -sin_raan * sin_w + cos_raan * cos_w * cos_i, -cos_raan * sin_i],
        [sin_w * sin_i, cos_w * sin_i, cos_i]
    ];
    
    const r_eci = [
        R[0][0]*r_pqw[0] + R[0][1]*r_pqw[1] + R[0][2]*r_pqw[2],
        R[1][0]*r_pqw[0] + R[1][1]*r_pqw[1] + R[1][2]*r_pqw[2],
        R[2][0]*r_pqw[0] + R[2][1]*r_pqw[1] + R[2][2]*r_pqw[2]
    ];
    
    const v_eci = [
        R[0][0]*v_pqw[0] + R[0][1]*v_pqw[1] + R[0][2]*v_pqw[2],
        R[1][0]*v_pqw[0] + R[1][1]*v_pqw[1] + R[1][2]*v_pqw[2],
        R[2][0]*v_pqw[0] + R[2][1]*v_pqw[1] + R[2][2]*v_pqw[2]
    ];
    
    // ECEF rotation for ground coordinates
    const gmst = (gmst_0 + OMEGA_E * dt_sec) % (2 * Math.PI);
    const cos_g = Math.cos(gmst), sin_g = Math.sin(gmst);
    
    const r_ecef = [
        cos_g * r_eci[0] + sin_g * r_eci[1],
        -sin_g * r_eci[0] + cos_g * r_eci[1],
        r_eci[2]
    ];
    
    const x = r_ecef[0], y = r_ecef[1], z = r_ecef[2];
    const r_mag = Math.sqrt(x*x + y*y + z*z);
    const lonDeg = (Math.atan2(y, x) * 180.0 / Math.PI);
    const latDeg = (Math.atan2(z, Math.sqrt(x*x + y*y)) * 180.0 / Math.PI);
    const altKm = r_mag - R_EARTH;
    const speedKms = Math.sqrt(v_eci[0]*v_eci[0] + v_eci[1]*v_eci[1] + v_eci[2]*v_eci[2]);
    
    // Sensor footprint horizon radius (km on Earth surface)
    const footprintRadiusKm = R_EARTH * Math.acos(Math.min(1.0, R_EARTH / r_mag));
    
    return {
        r_eci: r_eci,
        v_eci: v_eci,
        r_ecef: r_ecef,
        lat: latDeg,
        lon: lonDeg,
        alt: altKm,
        speed: speedKms,
        footprintRadiusKm: footprintRadiusKm,
        trueAnomalyDeg: nu * 180.0 / Math.PI,
        raanCurrentDeg: (raan * 180.0 / Math.PI) % 360.0,
        argpCurrentDeg: (w * 180.0 / Math.PI) % 360.0
    };
}

function calculateGroundTrack(orb, baseTimeSec, pointsCount = 120, orbits = 2) {
    const periodSec = orb.periodMin * 60;
    const totalDuration = periodSec * orbits;
    const dt = totalDuration / pointsCount;
    const points = [];
    
    for (let step = 0; step <= pointsCount; step++) {
        const t = baseTimeSec + step * dt;
        const state = propagateOrbit(orb, t);
        points.push({
            lat: state.lat,
            lon: state.lon,
            alt: state.alt,
            t: t,
            r_eci: state.r_eci
        });
    }
    return points;
}
