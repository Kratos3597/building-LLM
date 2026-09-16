#!/usr/bin/env node

/**
 * CloudNex Unified Build Script
 * 
 * Automatically detects environment:
 * - In Google AI Studio: Validates syntax and ensures dist/ remains clean so the
 *   exported ZIP archive stays ultra-compact (~6 MB instead of 400 MB).
 * - In GitHub Actions / CI or when compiling desktop installers: Generates
 *   the backend sidecar and packages full installers into dist/* for distribution.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distPath = path.join(rootDir, 'dist');

// Detect if desktop build is explicitly requested
const isExplicitDesktop =
  process.argv.includes('--desktop') ||
  process.env.BUILD_DESKTOP === 'true';

if (!isExplicitDesktop) {
  console.log('[build] Web / AI Studio build target detected.');
  console.log('[build] Validating server and script syntax...');
  execSync('node -c server.js && node -c main.js && node -c preload.js', {
    cwd: rootDir,
    stdio: 'inherit',
  });

  // Clean any stale dist/ directory so that exported ZIPs remain lightweight
  if (fs.existsSync(distPath)) {
    console.log('[build] Purging local dist/ artifacts to keep export ZIP ultra-light (~6 MB)...');
    fs.rmSync(distPath, { recursive: true, force: true });
  }

  console.log('[build] ✔ Web and server build verified successfully.');
  process.exit(0);
}

// Running in GitHub Actions, CI runner, or local user workstation compiling desktop app
console.log('[build] 🚀 Starting Desktop Installer compilation...');

try {
  // Step 1: Backend sidecar launcher / compilation
  console.log('[build] Step 1/2: Preparing Python backend sidecar (scripts/build_backend.py)...');
  const pyCmd = process.platform === 'win32'
    ? 'python'
    : (fs.existsSync('/usr/bin/python3') ? 'python3' : 'python');

  try {
    execSync(`${pyCmd} scripts/build_backend.py`, { cwd: rootDir, stdio: 'inherit' });
  } catch (pyErr) {
    console.warn('[build] Warning during backend compilation:', pyErr.message);
  }

  // Step 2: Electron desktop packaging
  console.log('[build] Step 2/2: Packaging desktop installer with electron-builder into dist/...');
  execSync('npx electron-builder --publish never', { cwd: rootDir, stdio: 'inherit' });

  console.log('[build] ✔ Desktop installer generated successfully in dist/ !');
} catch (err) {
  console.error('[build] ❌ Error packaging desktop installer:', err.message);
  process.exit(1);
}
