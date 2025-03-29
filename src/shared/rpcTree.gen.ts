// Generated by vite-plugin-use-main - Do not edit manually!

// This file provides type definitions for the API exposed via contextBridge ('mainApi')
// It is automatically generated based on the "use main" functions found in your codebase.

export interface MainApi {
  getOsInfo(detailLevel: number): Promise<{ platform: string; arch: string; hostname?: string }>;
  addNumbers(a: number, b: number): Promise<number>;
  riskyOperation(shouldFail: boolean): Promise<string>;
  testMainFunction(): Promise<string>;
}

// Declare it on the window object for convenience
declare global {
  interface Window {
    mainApi: MainApi;
  }
}
