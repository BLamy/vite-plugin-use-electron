import os from 'node:os';
// Import statement is not needed in renderer process code
// since the "use electron" directive makes this run in main process
// where the Node.js modules are available

/**
 * Gets basic OS information.
 */
export async function getOsInfo(detailLevel: number): Promise<{ platform: string; arch: string; hostname?: string }> {
    "use electron"; // The magic directive!
    console.log(`[Main Process: getOsInfo] Received detailLevel: ${detailLevel}`);
    const platform = os.platform();
    const arch = os.arch();
    let hostname: string | undefined;
    if (detailLevel > 0) {
        hostname = os.hostname();
    }
    return { platform, arch, hostname };
}

/**
 * Simple addition in the main process.
 */
export async function addNumbers(a: number, b: number): Promise<number> {
    "use electron";
    console.log(`[Main Process: addNumbers] Adding ${a} and ${b}`);
    return a + b;
}

/**
 * Example function that might throw an error.
 */
export async function riskyOperation(shouldFail: boolean): Promise<string> {
    "use electron";
    console.log(`[Main Process: riskyOperation] Called with shouldFail=${shouldFail}`);
    if (shouldFail) {
        throw new Error("Operation failed as requested!");
    }
    return "Operation succeeded!";
}

/**
 * Simple test function to verify "use electron" is working
 */
export async function testMainFunction(): Promise<string> {
    "use electron";
    console.log('[Main Process: testMainFunction] Called');
    return "Main process is working!";
} 