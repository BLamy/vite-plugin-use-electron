# Vite Plugin Use Electron Demo

This is a demonstration application for the `vite-plugin-use-electron` library, which allows you to easily write Electron main process code directly in your renderer process files using a "use electron" directive.

## Key Features

- **"use electron" directive**: Mark any function to be executed in the main process
- **Seamless integration**: Call main process functions as if they were regular JavaScript functions
- **TypeScript support**: Full type safety and autocompletion
- **React integration**: Works with React hooks and components

## How it Works

The plugin automatically:
1. Identifies functions with the "use electron" directive
2. Replaces their bodies with IPC calls in the renderer process
3. Generates a bridge in the preload script 
4. Creates handlers in the main process
5. Generates TypeScript definitions

## Project Structure

- `/src/renderer` - The React application (renderer process)
- `/src/main` - The Electron main process code
- `/src/preload` - The preload script
- `/src/shared` - Shared types between processes

## Examples

This demo shows several patterns:

1. Directly importing Node.js modules in renderer code
2. Using main process functions with React Query
3. Calling main process functions from components
4. Error handling across the process boundary

## Development

```bash
# Start in development mode
npm run electron:dev

# Build the application
npm run electron:build
```

## License

MIT 