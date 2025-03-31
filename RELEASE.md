# Release Process

This project uses automated versioning and publishing through GitHub Actions. Here's how it works:

## Versioning Convention

We follow [Semantic Versioning](https://semver.org/) (SemVer) for all releases:

- **MAJOR** version when you make incompatible API changes (X.0.0)
- **MINOR** version when you add functionality in a backward compatible manner (0.X.0)
- **PATCH** version when you make backward compatible bug fixes (0.0.X)

## Automatic Versioning

The CI pipeline automatically determines the type of version change based on the commit messages:

- If any commit message contains "BREAKING CHANGE", a **major** version bump occurs
- If any commit message starts with "feat", a **minor** version bump occurs
- Otherwise, a **patch** version bump occurs

## Release Process

1. Create a PR with your changes
2. Ensure all tests pass in the CI workflow
3. Merge the PR to the main branch
4. The CI workflow automatically:
   - Determines the version bump type
   - Updates the package.json version
   - Builds the library
   - Publishes the new version to npm
   - Creates a GitHub release

## Commit Message Format

To ensure proper versioning, follow these commit message conventions:

```
feat: add new feature X
```

```
fix: resolve issue with Y
```

```
chore: update dependencies
```

```
feat: add new API endpoints

BREAKING CHANGE: removed deprecated methods
```

## CI/CD Pipeline Setup

The CI/CD pipeline is implemented using a single GitHub Actions workflow:

### Setting Up GitHub Actions

1. Repository secrets needed:
   - `NPM_TOKEN`: For publishing to npm

2. Workflow:
   - CI Workflow (`.github/workflows/ci.yml`) handles both PR validation and publishing

### Commit Message Enforcement

We use `commitlint` and `husky` to enforce conventional commit messages:

```bash
# Install dependencies
npm install --save-dev @commitlint/cli @commitlint/config-conventional husky

# Set up husky
npm run prepare  # Creates the .husky directory
npx husky add .husky/commit-msg 'npx --no -- commitlint --edit ${1}'
```

### Manual Release Process

If needed, you can trigger a manual release using our script:

```bash
node tools/scripts/create-release.mjs [patch|minor|major] [library-name]
```

## Manual Release

If needed, you can trigger a manual release by:

1. Updating the version in package.json
2. Building the library: `npx nx build vite-plugin-use-electron`
3. Publishing to npm: `npx nx publish vite-plugin-use-electron --ver=X.Y.Z --tag=latest` 