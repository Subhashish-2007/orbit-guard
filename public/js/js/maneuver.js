/**
 * ORBITGUARD - Collision Avoidance Maneuver (CAM) Simulator & Optimizer
 */

function simulateCAM(satelliteObj, debrisObj, burnLeadTimeHours, deltaV_RSW_m_s, ispSeconds = 300.0) {
    // deltaV_RSW_m_s = { radial: m/s, along: m/s (prograde/retrograde), cross: m/s (normal/antinormal) }
    const t_tca = debrisObj._sim_tca_sec || 8820.0;
    const t_burn = Math.max(0, t_tca - burnLeadTimeHours * 3600);
    
    // State of satellite at burn time
    const state_at_burn = propagateOrbit(satelliteObj.orbital, t_burn);
    const r_burn_eci = state_at_burn.r_eci;
    const v_burn_eci = state_at_burn.v_eci;
    
    // Convert RSW delta-V to ECI delta-V
    const r_mag = Math.sqrt(r_burn_eci[0]**2 + r_burn_eci[1]**2 + r_burn_eci[2]**2);
    const r_unit = [r_burn_eci[0]/r_mag, r_burn_eci[1]/r_mag, r_burn_eci[2]/r_mag];
    
    const h_vec = [
        r_burn_eci[1]*v_burn_eci[2] - r_burn_eci[2]*v_burn_eci[1],
        r_burn_eci[2]*v_burn_eci[0] - r_burn_eci[0]*v_burn_eci[2],
        r_burn_eci[0]*v_burn_eci[1] - r_burn_eci[1]*v_burn_eci[0]
    ];
    const h_mag = Math.sqrt(h_vec[0]**2 + h_vec[1]**2 + h_vec[2]**2);
    const w_unit = [h_vec[0]/h_mag, h_vec[1]/h_mag, h_vec[2]/h_mag]; // Cross-track (normal)
    
    const s_unit = [
        w_unit[1]*r_unit[2] - w_unit[2]*r_unit[1],
        w_unit[2]*r_unit[0] - w_unit[0]*r_unit[2],
        w_unit[0]*r_unit[1] - w_unit[1]*r_unit[0]
    ]; // Along-track (prograde)
    
    // Delta-V in km/s
    const dV_rad_kms = (deltaV_RSW_m_s.radial || 0.0) / 1000.0;
    const dV_along_kms = (deltaV_RSW_m_s.along || 0.0) / 1000.0;
    const dV_cross_kms = (deltaV_RSW_m_s.cross || 0.0) / 1000.0;
    
    const dV_eci = [
        dV_rad_kms*r_unit[0] + dV_along_kms*s_unit[0] + dV_cross_kms*w_unit[0],
        dV_rad_kms*r_unit[1] + dV_along_kms*s_unit[1] + dV_cross_kms*w_unit[1],
        dV_rad_kms*r_unit[2] + dV_along_kms*s_unit[2] + dV_cross_kms*w_unit[2]
    ];
    
    const total_delta_v_ms = Math.sqrt(deltaV_RSW_m_s.radial**2 + deltaV_RSW_m_s.along**2 + deltaV_RSW_m_s.cross**2);
    
    // New velocity in ECI at burn
    const v_post_burn_eci = [
        v_burn_eci[0] + dV_eci[0],
        v_burn_eci[1] + dV_eci[1],
        v_burn_eci[2] + dV_eci[2]
    ];
    
    // Solve new orbital elements from [r_burn_eci, v_post_burn_eci]
    const v_mag = Math.sqrt(v_post_burn_eci[0]**2 + v_post_burn_eci[1]**2 + v_post_burn_eci[2]**2);
    const specific_energy = (v_mag**2)/2.0 - MU / r_mag;
    const new_a = -MU / (2.0 * specific_energy);
    
    const h_new = [
        r_burn_eci[1]*v_post_burn_eci[2] - r_burn_eci[2]*v_post_burn_eci[1],
        r_burn_eci[2]*v_post_burn_eci[0] - r_burn_eci[0]*v_post_burn_eci[2],
        r_burn_eci[0]*v_post_burn_eci[1] - r_burn_eci[1]*v_post_burn_eci[0]
    ];
    const h_new_mag = Math.sqrt(h_new[0]**2 + h_new[1]**2 + h_new[2]**2);
    
    const new_p = (h_new_mag**2) / MU;
    const new_e = Math.max(1e-6, Math.sqrt(Math.max(0.0, 1.0 - new_p / new_a)));
    const new_i = Math.acos(Math.max(-1.0, Math.min(1.0, h_new[2] / h_new_mag)));
    
    // Node vector N = [ -h_y, h_x, 0 ]
    const N_vec = [-h_new[1], h_new[0], 0.0];
    const N_mag = Math.sqrt(N_vec[0]**2 + N_vec[1]**2);
    let new_raan = N_mag > 1e-8 ? Math.atan2(N_vec[1], N_vec[0]) : 0.0;
    if (new_raan < 0) new_raan += 2*Math.PI;
    
    // Eccentricity vector e_vec = ((v^2 - mu/r)*r - (r.v)*v) / mu
    const r_dot_v = r_burn_eci[0]*v_post_burn_eci[0] + r_burn_eci[1]*v_post_burn_eci[1] + r_burn_eci[2]*v_post_burn_eci[2];
    const e_vec = [
        ((v_mag**2 - MU/r_mag)*r_burn_eci[0] - r_dot_v*v_post_burn_eci[0]) / MU,
        ((v_mag**2 - MU/r_mag)*r_burn_eci[1] - r_dot_v*v_post_burn_eci[1]) / MU,
        ((v_mag**2 - MU/r_mag)*r_burn_eci[2] - r_dot_v*v_post_burn_eci[2]) / MU
    ];
    
    // Argument of perigee w
    let new_w = 0.0;
    if (N_mag > 1e-8 && new_e > 1e-6) {
        const N_dot_e = N_vec[0]*e_vec[0] + N_vec[1]*e_vec[1] + N_vec[2]*e_vec[2];
        new_w = Math.acos(Math.max(-1.0, Math.min(1.0, N_dot_e / (N_mag * new_e))));
        if (e_vec[2] < 0) new_w = 2*Math.PI - new_w;
    }
    
    // True anomaly at burn nu_burn
    let nu_burn = 0.0;
    if (new_e > 1e-6) {
        const e_dot_r = e_vec[0]*r_burn_eci[0] + e_vec[1]*r_burn_eci[1] + e_vec[2]*r_burn_eci[2];
        nu_burn = Math.acos(Math.max(-1.0, Math.min(1.0, e_dot_r / (new_e * r_mag))));
        if (r_dot_v < 0) nu_burn = 2*Math.PI - nu_burn;
    }
    
    // Eccentric anomaly E_burn and Mean Anomaly M_burn at t_burn
    const E_burn = 2.0 * Math.atan(Math.sqrt((1.0 - new_e)/(1.0 + new_e)) * Math.tan(nu_burn / 2.0));
    const M_burn = (E_burn - new_e * Math.sin(E_burn) + 2*Math.PI) % (2*Math.PI);
    
    const new_n = Math.sqrt(MU / (new_a**3));
    const new_M0 = (M_burn - new_n * t_burn + 100*Math.PI) % (2*Math.PI);
    
    const perturbed_orbital = {
        satNum: satelliteObj.orbital.satNum,
        a: new_a,
        e: new_e,
        i: new_i,
        raan: new_raan,
        w: new_w,
        M0: new_M0,
        n: new_n,
        meanMotion: new_n * 86400.0 / (2 * Math.PI),
        periodMin: (2 * Math.PI / new_n) / 60.0
    };
    
    // Evaluate separation at TCA with perturbed orbit
    const p_sat_new = propagateOrbit(perturbed_orbital, t_tca);
    const p_deb = propagateOrbit(debrisObj.orbital, t_tca);
    
    const dx = p_sat_new.r_eci[0] - p_deb.r_eci[0];
    const dy = p_sat_new.r_eci[1] - p_deb.r_eci[1];
    const dz = p_sat_new.r_eci[2] - p_deb.r_eci[2];
    const new_miss_km = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    // Fuel mass consumed: Tsiolkovsky Rocket Equation
    // Delta_m = m0 * (1 - exp(-Delta_V / (Isp * g0)))
    const g0 = 9.80665; // m/s^2
    const m0_kg = satelliteObj.mass_kg || 1000.0;
    const fuel_used_kg = m0_kg * (1.0 - Math.exp(-total_delta_v_ms / (ispSeconds * g0)));
    
    // New Collision Probability
    const combinedRadiusKm = ((satelliteObj.radius_m || 2.0) + (debrisObj.radius_m || 0.5)) / 1000.0;
    const sigmaKm = 0.350;
    const new_pc = (Math.pow(combinedRadiusKm, 2) / (2 * Math.pow(sigmaKm, 2))) * Math.exp(-Math.pow(new_miss_km, 2) / (2 * Math.pow(sigmaKm, 2)));
    
    return {
        initialMissKm: (debrisObj._sim_initial_miss_km || 0.350),
        newMissKm: new_miss_km,
        newMissMeters: new_miss_km * 1000.0,
        missImprovementKm: new_miss_km - (debrisObj._sim_initial_miss_km || 0.350),
        newCollisionProb: new_pc,
        deltaV_ms: total_delta_v_ms,
        fuelUsedKg: fuel_used_kg,
        burnLeadTimeHours: burnLeadTimeHours,
        ispSeconds: ispSeconds,
        isSafe: new_miss_km >= 5.0,
        safetyFactor: (new_miss_km / 5.0).toFixed(2),
        perturbedOrbital: perturbed_orbital
    };
}

function autoOptimizeCAM(satelliteObj, debrisObj, targetClearanceKm = 5.0, maxLeadTimeHours = 12.0) {
    // Prograde/Retrograde along-track burns are by far the most fuel-efficient for LEO clearance!
    let best_dV = 0.0;
    let best_leadTime = 6.0;
    let min_cost = Infinity;
    
    for (let lead = 2.0; lead <= maxLeadTimeHours; lead += 1.0) {
        for (let dV = -2.0; dV <= 2.0; dV += 0.05) {
            if (Math.abs(dV) < 0.01) continue;
            const res = simulateCAM(satelliteObj, debrisObj, lead, { along: dV, radial: 0, cross: 0 });
            if (res.newMissKm >= targetClearanceKm) {
                if (Math.abs(dV) < min_cost) {
                    min_cost = Math.abs(dV);
                    best_dV = dV;
                    best_leadTime = lead;
                }
            }
        }
    }
    
    if (min_cost === Infinity) {
        best_dV = 0.85;
        best_leadTime = 8.0;
    }
    
    return {
        recommendedAlongDeltaV_ms: best_dV,
        recommendedLeadTimeHours: best_leadTime,
        type: best_dV > 0 ? "PROGRADE (+ΔV Along-Track)" : "RETROGRADE (-ΔV Along-Track)",
        simulation: simulateCAM(satelliteObj, debrisObj, best_leadTime, { along: best_dV, radial: 0, cross: 0 })
    };
}
