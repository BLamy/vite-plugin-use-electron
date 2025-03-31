# vite-plugin-use-electron

A Vite plugin that makes it easy to use Electron APIs in your renderer process.

## Installation

```bash
npm install vite-plugin-use-electron
```

## Usage

### In your vite.config.js/ts

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { useElectronMainPlugin } from 'vite-plugin-use-electron';

export default defineConfig({
  plugins: [
    react(),
    // Add the plugin for renderer process
    useElectronMainPlugin('renderer', {
      generateTypes: false, // Whether to generate TypeScript definitions (default: false)
      directiveKeyword: 'use electron' // Directive to mark functions (default: 'use electron')
    }),
  ],
});
```

### In your electron.vite.config.js/ts

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { useElectronMainPlugin } from 'vite-plugin-use-electron';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      // Add the plugin for main process
      useElectronMainPlugin('main', {
        directiveKeyword: 'use electron'
      })
    ],
  },
  preload: {
    plugins: [
      externalizeDepsPlugin(),
      // Add the plugin for preload process
      useElectronMainPlugin('preload', {
        directiveKeyword: 'use electron'
      })
    ],
  },
  renderer: {
    plugins: [
      // Add the plugin for renderer process
      useElectronMainPlugin('renderer', {
        generateTypes: false, // Whether to generate TypeScript definitions (default: false)
        directiveKeyword: 'use electron'
      })
    ],
  }
});
```

## Plugin Options

The plugin accepts the following options:

- **generateTypes** (boolean, default: `false`): Whether to generate TypeScript type definitions in `rpcTree.gen.ts`. When enabled, this file will be automatically generated and updated as you add or modify functions.
- **directiveKeyword** (string, default: `'use electron'`): The directive to use for marking functions that should be exposed to the renderer process. Can be `'use electron'`, `'use electron-main'`, or `'use main'`.

## Contributing

We welcome contributions! This project uses NX for development and package management.

### Development Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/brettlamy/vite-plugin-use-electron.git
   cd vite-plugin-use-electron
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   pnpm install
   ```

3. Build the library:
   ```bash
   npx nx build vite-plugin-use-electron
   ```

4. Run the demo application:
   ```bash
   cd apps/vite-plugin-use-electron-demo
   npx electron-vite dev
   ```

### Development Workflow

1. Fork the repository on GitHub
2. Clone your fork and create a new feature branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```
3. Make your changes and test them:
   ```bash
   # Run tests
   npx nx test vite-plugin-use-electron
   
   # Lint your code
   npx nx lint vite-plugin-use-electron
   
   # Build the library
   npx nx build vite-plugin-use-electron
   ```

4. Commit your changes using conventional commit messages:
   ```bash
   # For new features
   git commit -m "feat: add new feature X"
   
   # For bug fixes
   git commit -m "fix: resolve issue with Y"
   
   # For breaking changes
   git commit -m "feat: add new API
   
   BREAKING CHANGE: removed deprecated methods"
   ```

5. Push your branch to GitHub:
   ```bash
   git push origin feature/my-new-feature
   ```

6. Create a Pull Request on GitHub

### Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for our commit messages:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

Breaking changes should be indicated by adding `BREAKING CHANGE:` in the commit body.

Our automated CI pipeline uses these commit messages to determine version bumps:
- `BREAKING CHANGE` triggers a major version bump
- `feat:` triggers a minor version bump
- All other prefixes trigger a patch version bump

## Continuous Integration

This project uses GitHub Actions for continuous integration and deployment:

- We use a single CI workflow that handles both pull request validation and release automation
- The workflow automatically creates new releases when changes are merged to main
- Version numbers are automatically incremented based on commit message conventions

See [RELEASE.md](../../RELEASE.md) for more details on our versioning and release process.

## License

MIT 