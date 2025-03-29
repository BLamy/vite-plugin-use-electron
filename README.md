# Electron + Vite: "use main" Demo

This project is a **Proof-of-Concept (POC)** demonstrating a Vite plugin (`vite-plugin-use-main.ts`) that enables a developer experience similar to React Server Components or tRPC within an Electron + React + TypeScript application built with `electron-vite`.

**The Core Idea:** Write functions directly within your React (renderer process) codebase, add a simple `"use main";` directive at the top, and have them automatically execute in Electron's main process during runtime!

```typescript
// Example: src/shared/main-operations.ts

import os from 'node:os'; // This import works because the code runs in main!

export async function getOsInfo(detailLevel: number) {
  "use main"; // Magic happens here! ✨

  // This code actually executes in the Electron main process
  console.log(`[Main Process: getOsInfo] Received detailLevel: ${detailLevel}`);
  await new Promise(resolve => setTimeout(resolve, 50));
  // ... access node APIs like os ...
  return { platform: os.platform(), arch: os.arch(), /* ... */ };
}
```

## What is this Demoing?

This repository showcases:

1.  **The `"use main";` Directive:** A simple string literal that marks functions intended for main process execution.
2.  **A Custom Vite Plugin (`vite-plugin-use-main.ts`):**
    *   Runs during the `build` process.
    *   Uses `@babel/parser` to analyze the code and find functions marked with `"use main";`.
    *   **Extracts** the implementation of these functions.
    *   **Generates a separate bundle** (`_generated_main_handlers.js`) containing the actual function logic and IPC handlers (`ipcMain.handle`) for the main process.
    *   **Generates an SDK** (`_generated_preload_bridge.js`) containing "stub" functions for the preload script. These stubs use `ipcRenderer.invoke` to call the main process.
    *   **Replaces** the original function body in the renderer bundle with a placeholder (or error).
3.  **Automatic IPC Setup:** The generated files handle the `ipcMain`/`ipcRenderer` communication boilerplate.
4.  **Preload Script Integration:** The SDK is securely exposed to the renderer via `contextBridge` in the preload script (`src/preload/index.ts`).
5.  **React Context Integration:** A React Context (`src/renderer/src/contexts/MainApiContext.tsx`) makes the main process SDK available conveniently via the `useMainApi` hook.
6.  **Type Safety:** Uses TypeScript interfaces (`src/shared/main-operations.ts`) shared between preload and renderer contexts to provide type checking for the exposed main process functions.
7.  **Demo Components:** (`App.tsx`, `SystemInfo.tsx`) show how to call these functions seamlessly using `async/await` or tools like TanStack Query.

## Why is this Cool / Useful? (The Value Proposition)

*   **Simplified IPC:** Drastically reduces the manual boilerplate needed to set up communication between the renderer and main processes for specific tasks. Define the function, add the directive, and call it.
*   **Code Colocation:** Keep functions logically related to your UI components within the renderer source tree, even if they need main process capabilities.
*   **Clear Separation:** The `"use main";` directive explicitly marks code that will run with Node.js privileges, improving code clarity and security reviews.
*   **Seamless Node.js Access:** Easily write functions that interact with the filesystem (`fs`), OS (`os`), child processes, native Node modules, or perform heavy computations without blocking the UI thread.
*   **Type Safety:** By defining a shared interface, you get type checking and autocompletion when calling main process functions from the renderer.
*   **Developer Experience:** Aims for a smoother workflow, potentially reducing context switching compared to manually managing separate IPC channels for every operation.

## How it Works (High-Level Flow)

1.  Developer adds `"use main";` to a function in the renderer codebase (e.g., `src/shared/main-operations.ts`).
2.  During `npm run build`, the `useMainPlugin` (renderer target) parses the code.
3.  The plugin identifies the function, extracts its body and signature, and stores this information in a temporary manifest (`node_modules/.vite-plugin-use-main/...`). It replaces the original function body in the renderer bundle.
4.  The `useMainPlugin` (preload target) reads the manifest and generates `_generated_preload_bridge.js`, creating async stub functions that use `ipcRenderer.invoke` to call the main process via a specific channel, using the function's unique ID.
5.  The `useMainPlugin` (main target) reads the manifest and generates `_generated_main_handlers.js`. This file contains the *actual implementations* of the extracted functions and sets up `ipcMain.handle` listeners keyed by the function's unique ID.
6.  The user's `src/preload/index.ts` `require`s the generated bridge, exposing the SDK stubs via `contextBridge.exposeInMainWorld('mainApi', ...)`.
7.  The user's `src/main/index.ts` `require`s the generated handlers and calls `setupMainHandlers()` to activate the IPC listeners.
8.  In the React app, `MainApiProvider` gets `window.mainApi` and provides it via context.
9.  Components use the `useMainApi` hook and call functions (e.g., `mainApi.getOsInfo()`).
10. The call goes through the preload bridge -> IPC -> main process handler -> executes the original function body -> returns the result via IPC -> back to the renderer component.

## Demo Features

This POC demonstrates calling the following functions defined in `src/shared/main-operations.ts` from the React UI:

*   `getOsInfo(detailLevel)`: Fetches OS details using Node's `os` module (demonstrates Node API access). Used with TanStack Query in `SystemInfo.tsx`.
*   `addNumbers(a, b)`: A simple synchronous calculation performed in the main process (becomes async when called).
*   `riskyOperation(shouldFail)`: Shows how errors thrown in the main process function are correctly propagated back to the renderer's `catch` block.
*   `testMainFunction()`: Example function demonstrating usage.

## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd <repo-name>
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    # or yarn install / pnpm install
    ```
3.  **Build the application:**
    ```bash
    npm run build
    ```
    **Important:** The `useMainPlugin` currently only runs during the `build` command (`apply: 'build'`). The code splitting and generation happen here.

4.  **Run the built application:**
    The standard `electron-vite` preview command works well for launching the built app:
    ```bash
    npm start
    # or yarn start / pnpm start
    ```
    This command points to the output in the `out/` directory.

5.  **Observe:**
    *   The UI should display OS info fetched from the main process.
    *   Click the buttons to trigger `addNumbers` and `riskyOperation`.
    *   Check the **terminal where you ran `npm start`** to see the `[Main Process: ...]` logs.
    *   Check the **Renderer DevTools** (press F12) console for `[Preload Bridge]` logs.

## Under the Hood

Key files involved in this mechanism:

*   `vite-plugin-use-main.ts`: The heart of the build-time magic.
*   `src/shared/main-operations.ts`: Where `"use main"` functions are defined and exported. The `MainApi` type is also here.
*   `electron.vite.config.ts`: Where the `useMainPlugin` is configured for all three targets.
*   `src/main/index.ts`: Imports and calls `setupMainHandlers` from the generated file.
*   `src/preload/index.ts`: Imports the generated preload bridge (`require('./_generated_preload_bridge.js')`).
*   `src/renderer/src/contexts/MainApiContext.tsx`: Provides the `window.mainApi` to the React component tree.
*   `src/renderer/src/App.tsx` & `src/renderer/src/components/SystemInfo.tsx`: Example usage of the `useMainApi` hook.

## Limitations & Caveats (POC Status)

*   **Build Only:** Does not currently work with the development server (`npm run dev`). HMR integration is complex.
*   **Dependencies:** Code inside `"use main"` functions **cannot** easily `import`/`require` modules from the renderer source tree. It executes within the context of the generated main process handlers file. Only Node.js built-ins and dependencies installed for the *main process* are reliably available.
*   **Serialization:** All arguments passed to and results returned from `"use main"` functions must be serializable via the Electron IPC mechanism (generally JSON-compatible). Complex classes, functions, etc., will not transfer correctly.
*   **Error Handling:** Basic error propagation exists, but more robust application-level error handling patterns are needed for production.
*   **`this` Context:** The `this` context is **not** preserved when functions are moved to the main process. Avoid using `this` within `"use main"` functions.
*   **Type Safety:** Relies on manually keeping the shared `MainApi` interface (`src/shared/main-operations.ts`) in sync with the actual exported `"use main"` functions.
*   **Experimental:** This is a proof-of-concept and has not been battle-tested. Use with caution.

## Future Ideas

*   Support for `npm run dev` / HMR.
*   Automatic dependency analysis and bundling for `"use main"` functions.
*   Generating TypeScript types automatically instead of manual interfaces.
*   Configuration options for the plugin.
*   More sophisticated error handling and serialization strategies.

## License

MIT
```