// Generated type definitions
// This file provides type definitions for the API exposed via contextBridge ('mainApi')

export interface MainApi {
  // Functions from main-operations.ts
  getOsInfo(detailLevel: number): Promise<{ platform: string; arch: string; hostname?: string }>;
  addNumbers(a: number, b: number): Promise<number>;
  riskyOperation(shouldFail: boolean): Promise<string>;
  testMainFunction(): Promise<string>;
  
  // Functions from SystemInfo.tsx
  getSystemInfo(): Promise<{
    platform: string;
    release: string;
    arch: string;
    cpus: number;
    totalMemory: string;
    freeMemory: string;
  }>;
  
  // componentTestFunction from SystemInfo.tsx
  componentTestFunction(message: string): Promise<string>;
}