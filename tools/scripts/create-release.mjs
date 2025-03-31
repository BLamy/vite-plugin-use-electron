#!/usr/bin/env node

/**
 * This script creates a new release manually.
 * Usage: node tools/scripts/create-release.mjs <bump-type> [library-name]
 * bump-type: patch | minor | major
 * library-name: defaults to vite-plugin-use-electron
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const [, , bumpType = 'patch', libraryName = 'vite-plugin-use-electron'] = process.argv;

// Validate bump type
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Invalid bump type. Must be one of: patch, minor, major');
  process.exit(1);
}

// Get the library path
const libPath = join(process.cwd(), 'libs', libraryName);
const packageJsonPath = join(libPath, 'package.json');

try {
  // Read the package.json
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const currentVersion = packageJson.version;
  
  // Parse version
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  
  // Calculate new version
  let newVersion;
  if (bumpType === 'major') {
    newVersion = `${major + 1}.0.0`;
  } else if (bumpType === 'minor') {
    newVersion = `${major}.${minor + 1}.0`;
  } else {
    newVersion = `${major}.${minor}.${patch + 1}`;
  }
  
  console.log(`Current version: ${currentVersion}`);
  console.log(`New version: ${newVersion}`);
  
  // Update package.json
  packageJson.version = newVersion;
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  
  // Build the library
  console.log(`Building ${libraryName}...`);
  execSync(`npx nx build ${libraryName}`, { stdio: 'inherit' });
  
  // Publish the library
  console.log(`Publishing ${libraryName}@${newVersion}...`);
  execSync(`npx nx publish ${libraryName} --ver=${newVersion} --tag=latest`, { stdio: 'inherit' });
  
  // Create a git tag
  console.log('Creating git commit and tag...');
  execSync(`git add ${packageJsonPath}`, { stdio: 'inherit' });
  execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
  execSync(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { stdio: 'inherit' });
  
  console.log('Done! Don\'t forget to push the commit and tag:');
  console.log(`git push && git push origin v${newVersion}`);
  
} catch (error) {
  console.error('Error creating release:', error.message);
  process.exit(1);
} 