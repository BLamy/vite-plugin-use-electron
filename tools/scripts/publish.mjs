/**
 * This script publishes a library to npm.
 * It takes three arguments:
 * 1. The name of the library to publish (e.g. vite-plugin-use-electron)
 * 2. The version to publish (e.g. 0.1.0)
 * 3. The tag to publish with (e.g. latest, next, beta)
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

const [, , name, version, tag = 'latest'] = process.argv;

if (!name) {
  console.error('Please provide a library name');
  process.exit(1);
}

if (!version) {
  console.error('Please provide a version');
  process.exit(1);
}

// Get the dist directory
const distPath = join(process.cwd(), `dist/libs/${name}`);
// Get the source directory
const sourcePath = join(process.cwd(), `libs/${name}`);

// Ensure lib's dist folder exists in the main dist folder
const libDistPath = join(distPath, 'dist');
if (!existsSync(libDistPath)) {
  mkdirSync(libDistPath, { recursive: true });
}

try {
  // Read the package.json from the source directory
  const packageJsonPath = join(sourcePath, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  
  // Update the version
  packageJson.version = version;
  
  // Write the updated package.json to the dist directory
  writeFileSync(join(distPath, 'package.json'), JSON.stringify(packageJson, null, 2));
  
  // Copy README and LICENSE if they exist
  const readmePath = join(sourcePath, 'README.md');
  if (existsSync(readmePath)) {
    copyFileSync(readmePath, join(distPath, 'README.md'));
    console.log(`Copied README.md to ${distPath}`);
  }
  
  const licensePath = join(sourcePath, 'LICENSE');
  if (existsSync(licensePath)) {
    copyFileSync(licensePath, join(distPath, 'LICENSE'));
    console.log(`Copied LICENSE to ${distPath}`);
  }
  
  // Copy the built files from the library's dist directory
  const sourceDistDir = join(sourcePath, 'dist');
  if (existsSync(sourceDistDir)) {
    execSync(`cp -R ${sourceDistDir}/* ${libDistPath}/`, { 
      stdio: 'inherit',
    });
    console.log(`Copied build files from ${sourceDistDir} to ${libDistPath}`);
  } else {
    console.warn(`No dist directory found at ${sourceDistDir}`);
  }
  
  // Run npm publish
  execSync(`npm publish --access public --tag ${tag}`, {
    cwd: distPath,
    stdio: 'inherit',
  });
  
  console.log(`Published ${name}@${version} with tag ${tag}`);
} catch (error) {
  console.error('Error publishing package:', error);
  process.exit(1);
} 