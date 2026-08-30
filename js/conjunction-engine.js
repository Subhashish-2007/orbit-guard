/**
 * ORBITGUARD - Conjunction Detection, Collision Risk Scoring & CCSDS CDM Generator
 */

function scanConjunctions(objects, horizonHours = 48, thresholdKm = 30.0, baseTimeSec = 0) {
    const horizonSec = horizonHours * 3600;
    const dtCoarse = 120; // 2 minute coarse step
    const events = [];
    
    for (let i = 0; i < objects.length; i++) {
        for (let j = i + 1; j < objects.length; j++) {
            const o1 = objects[i];
            const o2 = objects[j];
            if (!o1.orbital || !o2.orbital) continue;
            
            // Altitude envelope pre-filter
            const h1_min = o1.orbital.a * (1 - o1.orbital.e) - R_EARTH;
            const h1_max = o1.orbital.a * (1 + o1.orbital.e) - R_EARTH;
            const h2_min = o2.orbital.a * (1 - o2.orbital.e) - R_EARTH;
            const h2_max = o2.orbital.a * (1 + o2.orbital.e) - R_EARTH;
            
            if (Math.max(h1_min, h2_min) - Math.min(h1_max, h2_max) > (thresholdKm + 35.0)) {
                continue;
            }
            
            let minDistance = Infinity;
            let bestT = 0;
            
            for (let t = 0; t <= horizonSec; t += dtCoarse) {
                const p1 = propagateOrbit(o1.orbital, baseTimeSec + t);
                const p2 = propagateOrbit(o2.orbital, baseTimeSec + t);
                const dx = p1.r_eci[0] - p2.r_eci[0];
                const dy = p1.r_eci[1] - p2.r_eci[1];
                const dz = p1.r_eci[2] - p2.r_eci[2];
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                if (dist < minDistance) {
                    minDistance = dist;
                    bestT = t;
                }
            }
            
            // Sub-second refinement if candidate is near or below threshold
            if (minDistance < thresholdKm * 1.5) {
                const fineStart = Math.max(0, bestT - dtCoarse);
                const fineEnd = Math.min(horizonSec, bestT + dtCoarse);
                let p1_best = null, p2_best = null;
                
                for (let t = fineStart; t <= fineEnd; t += 0.5) {
                    const p1 = propagateOrbit(o1.orbital, baseTimeSec + t);
                    const p2 = propagateOrbit(o2.orbital, baseTimeSec + t);
                    const dx = p1.r_eci[0] - p2.r_eci[0];
                    const dy = p1.r_eci[1] - p2.r_eci[1];
                    const dz = p1.r_eci[2] - p2.r_eci[2];
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestT = t;
                        p1_best = p1;
                        p2_best = p2;
                    }
                }
                
                if (minDistance <= thresholdKm) {
                    // Compute detailed conjunction metrics
                    const p1 = p1_best || propagateOrbit(o1.orbital, baseTimeSec + bestT);
                    const p2 = p2_best || propagateOrbit(o2.orbital, baseTimeSec + bestT);
                    
                    // Relative velocity vector
                    const v_rel = [
                        p1.v_eci[0] - p2.v_eci[0],
                        p1.v_eci[1] - p2.v_eci[1],
                        p1.v_eci[2] - p2.v_eci[2]
                    ];
                    const v_rel_mag = Math.sqrt(v_rel[0]*v_rel[0] + v_rel[1]*v_rel[1] + v_rel[2]*v_rel[2]);
                    
                    // Hill / Radial-Along-Cross (RSW) Frame decomposition
                    const r_unit = [
                        p1.r_eci[0] / Math.sqrt(p1.r_eci[0]*p1.r_eci[0] + p1.r_eci[1]*p1.r_eci[1] + p1.r_eci[2]*p1.r_eci[2]),
                        p1.r_eci[1] / Math.sqrt(p1.r_eci[0]*p1.r_eci[0] + p1.r_eci[1]*p1.r_eci[1] + p1.r_eci[2]*p1.r_eci[2]),
                        p1.r_eci[2] / Math.sqrt(p1.r_eci[0]*p1.r_eci[0] + p1.r_eci[1]*p1.r_eci[1] + p1.r_eci[2]*p1.r_eci[2])
                    ];
                    const h_vec = [
                        p1.r_eci[1]*p1.v_eci[2] - p1.r_eci[2]*p1.v_eci[1],
                        p1.r_eci[2]*p1.v_eci[0] - p1.r_eci[0]*p1.v_eci[2],
                        p1.r_eci[0]*p1.v_eci[1] - p1.r_eci[1]*p1.v_eci[0]
                    ];
                    const h_mag = Math.sqrt(h_vec[0]*h_vec[0] + h_vec[1]*h_vec[1] + h_vec[2]*h_vec[2]);
                    const w_unit = [h_vec[0]/h_mag, h_vec[1]/h_mag, h_vec[2]/h_mag]; // Normal/Cross-track
                    const s_unit = [
                        w_unit[1]*r_unit[2] - w_unit[2]*r_unit[1],
                        w_unit[2]*r_unit[0] - w_unit[0]*r_unit[2],
                        w_unit[0]*r_unit[1] - w_unit[1]*r_unit[0]
                    ]; // Along-track
                    
                    const delta_r = [
                        p2.r_eci[0] - p1.r_eci[0],
                        p2.r_eci[1] - p1.r_eci[1],
                        p2.r_eci[2] - p1.r_eci[2]
                    ];
                    
                    const delta_Radial = delta_r[0]*r_unit[0] + delta_r[1]*r_unit[1] + delta_r[2]*r_unit[2];
                    const delta_Along = delta_r[0]*s_unit[0] + delta_r[1]*s_unit[1] + delta_r[2]*s_unit[2];
                    const delta_Cross = delta_r[0]*w_unit[0] + delta_r[1]*w_unit[1] + delta_r[2]*w_unit[2];
                    
                    // Collision Probability (2D Foster/Akella Gaussian error model)
                    const combinedRadiusKm = ((o1.radius_m || 2.0) + (o2.radius_m || 0.5)) / 1000.0;
                    // Positional uncertainty (sigma): adaptive based on debris/tracking age
                    const sigmaKm = (o1.type === "DEBRIS" || o2.type === "DEBRIS") ? 0.350 : 0.200;
                    
                    const pc = (Math.pow(combinedRadiusKm, 2) / (2 * Math.pow(sigmaKm, 2))) * Math.exp(-Math.pow(minDistance, 2) / (2 * Math.pow(sigmaKm, 2)));
                    
                    // Kinetic Energy of encounter (Joules)
                    const reducedMassKg = (o1.mass_kg * o2.mass_kg) / (o1.mass_kg + o2.mass_kg);
                    const kineticEnergyJoules = 0.5 * reducedMassKg * Math.pow(v_rel_mag * 1000.0, 2);
                    const tntEquivalentKg = kineticEnergyJoules / 4.184e6;
                    
                    // Severity category and 0-100 composite risk score
                    let severity = "LOW";
                    let severityColor = "#00ff99";
                    let badgeClass = "badge-low";
                    let riskScore = 0;
                    
                    if (minDistance < 1.0 || pc > 1e-4) {
                        severity = "CRITICAL";
                        severityColor = "#ff2a55";
                        badgeClass = "badge-critical";
                        riskScore = Math.min(100, Math.round(85 + (1.0 - minDistance) * 15));
                    } else if (minDistance < 5.0 || pc > 1e-5) {
                        severity = "HIGH";
                        severityColor = "#ffaa00";
                        badgeClass = "badge-high";
                        riskScore = Math.min(84, Math.round(60 + (5.0 - minDistance) * 5));
                    } else if (minDistance < 15.0 || pc > 1e-7) {
                        severity = "MODERATE";
                        severityColor = "#00f0ff";
                        badgeClass = "badge-moderate";
                        riskScore = Math.min(59, Math.round(30 + (15.0 - minDistance) * 2));
                    } else {
                        severity = "LOW";
                        severityColor = "#00ff99";
                        badgeClass = "badge-low";
                        riskScore = Math.max(5, Math.round(25 - minDistance));
                    }
                    
                    events.push({
                        id: `conj_${o1.norad}_${o2.norad}_${Math.round(bestT)}`,
                        obj1: o1,
                        obj2: o2,
                        tcaSec: baseTimeSec + bestT,
                        timeToTcaSec: bestT,
                        missDistanceKm: minDistance,
                        missDistanceMeters: minDistance * 1000.0,
                        relVelocityKms: v_rel_mag,
                        relVelocityKmh: v_rel_mag * 3600.0,
                        deltaRadialKm: delta_Radial,
                        deltaAlongKm: delta_Along,
                        deltaCrossKm: delta_Cross,
                        collisionProb: pc,
                        kineticEnergyJoules: kineticEnergyJoules,
                        tntEquivalentKg: tntEquivalentKg,
                        combinedRadiusMeters: combinedRadiusKm * 1000.0,
                        severity: severity,
                        severityColor: severityColor,
                        badgeClass: badgeClass,
                        riskScore: riskScore,
                        pos1_eci: p1.r_eci,
                        pos2_eci: p2.r_eci,
                        lat_tca: p1.lat,
                        lon_tca: p1.lon,
                        alt_tca: p1.alt
                    });
                }
            }
        }
    }
    
    // Sort by most severe (highest risk score first, then smallest miss distance)
    events.sort((a, b) => b.riskScore - a.riskScore || a.missDistanceKm - b.missDistanceKm);
    return events;
}

function generateCCSDS_CDM(event, creationDate = new Date()) {
    const cdm = {
        "CCSDS_CDM_VERS": "1.0",
        "CREATION_DATE": creationDate.toISOString(),
        "ORIGINATOR": "ORBITGUARD-SGP4-J2",
        "MESSAGE_ID": event.id,
        "TCA": new Date(Date.now() + event.timeToTcaSec * 1000).toISOString(),
        "MISS_DISTANCE_METERS": event.missDistanceMeters.toFixed(2),
        "RELATIVE_SPEED_M_S": (event.relVelocityKms * 1000).toFixed(2),
        "COLLISION_PROBABILITY": event.collisionProb.toExponential(4),
        "COLLISION_RISK_SCORE": event.riskScore,
        "SEVERITY_LEVEL": event.severity,
        "RELATIVE_POSITION_RSW_METERS": {
            "RADIAL": (event.deltaRadialKm * 1000).toFixed(2),
            "ALONG_TRACK": (event.deltaAlongKm * 1000).toFixed(2),
            "CROSS_TRACK": (event.deltaCrossKm * 1000).toFixed(2)
        },
        "OBJECT_1": {
            "OBJECT_NAME": event.obj1.name,
            "NORAD_CATALOG_ID": event.obj1.norad,
            "OBJECT_TYPE": event.obj1.type,
            "OPERATOR": event.obj1.country,
            "MASS_KG": event.obj1.mass_kg,
            "HARD_BODY_RADIUS_M": event.obj1.radius_m
        },
        "OBJECT_2": {
            "OBJECT_NAME": event.obj2.name,
            "NORAD_CATALOG_ID": event.obj2.norad,
            "OBJECT_TYPE": event.obj2.type,
            "OPERATOR": event.obj2.country,
            "MASS_KG": event.obj2.mass_kg,
            "HARD_BODY_RADIUS_M": event.obj2.radius_m
        }
    };
    return cdm;
}

