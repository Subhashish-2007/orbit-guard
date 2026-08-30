import { useEffect } from "react";
import dashboardMarkup from "../src-legacy-markup.html?raw";

const ORBITGUARD_SCRIPTS = [
  "/js/catalog-data.js",
  "/js/orbital-engine.js",
  "/js/conjunction-engine.js",

  "/js/globe3d.js",
  "/js/map2d.js",
  "/js/app.js",
];

function loadScript(src) {
  const existing = document.querySelector(`script[data-orbitguard-src="${src}"]`);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.dataset.orbitguardSrc = src;
    script.onload = () => resolve(script);
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

export default function App() {
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      for (const src of ORBITGUARD_SCRIPTS) {
        if (cancelled) return;
        await loadScript(src);
      }
      if (!cancelled && window.bootstrapOrbitGuard) {
        window.bootstrapOrbitGuard();
      }
    }

    boot().catch((error) => {
      console.error("OrbitGuard failed to start:", error);
    });

    return () => {
      cancelled = true;
      if (window.orbitApp?.dispose) window.orbitApp.dispose();
      window.orbitApp = null;
    };
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: dashboardMarkup }} />;
}
