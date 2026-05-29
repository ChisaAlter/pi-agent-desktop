// Development Startup Script

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const rootDir = join(__dirname, '..');
const desktopDir = join(rootDir, 'apps/desktop');

console.log('🚀 Starting Pi Desktop Development Environment...\n');

// Check if node_modules exists
if (!existsSync(join(rootDir, 'node_modules'))) {
  console.log('📦 Installing dependencies...');
  execSync('pnpm install', { cwd: rootDir, stdio: 'inherit' });
}

// Build packages first
console.log('\n🔨 Building packages...');
try {
  execSync('pnpm -r run build', { cwd: rootDir, stdio: 'inherit' });
} catch (error) {
  console.error('❌ Failed to build packages:', error);
  process.exit(1);
}

// Start desktop app in dev mode
console.log('\n🖥️  Starting desktop app...');
try {
  execSync('pnpm run dev', { cwd: desktopDir, stdio: 'inherit' });
} catch (error) {
  console.error('❌ Failed to start desktop app:', error);
  process.exit(1);
}