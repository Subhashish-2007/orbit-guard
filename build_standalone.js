import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const css = fs.readFileSync(path.join(__dirname, 'src', 'index.css'), 'utf-8');
const markup = fs.readFileSync(path.join(__dirname, 'src-legacy-markup.html'), 'utf-8');

const jsFiles = [
  'catalog-data.js',
  'orbital-engine.js',
  'conjunction-engine.js',
  'globe3d.js',
  'map2d.js',
  'app.js'
];

const allJs = jsFiles.map(f => {
  return '/* --- ' + f + ' --- */\n' + fs.readFileSync(path.join(__dirname, 'js', f), 'utf-8');
}).join('\n\n');

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ORBITGUARD | Space Debris Tracking & Collision Risk Prediction Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
    <style>
${css}
    </style>
</head>
<body class="h-screen w-screen flex flex-col select-none overflow-hidden bg-slate-950 text-slate-100 antialiased">
${markup}
    <script>
${allJs}

    window.addEventListener('DOMContentLoaded', () => {
        if (!window.orbitApp) window.orbitApp = new OrbitGuardApp();
    });
    </script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'standalone_app.html'), html, 'utf-8');
console.log('Successfully generated standalone_app.html with CelesTrak API sync support! Size:', html.length, 'bytes');
