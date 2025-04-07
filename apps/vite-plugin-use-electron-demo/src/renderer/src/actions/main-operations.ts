/**
 * Simple addition in the main process.
 */
export async function addNumbers(a: number, b: number){
    "use electron";
    console.log(`[Main Process: addNumbers] Adding ${a} and ${b}`);
    return a + b;
}

/**
 * Example function that might throw an error.
 */
export async function riskyOperation(shouldFail: boolean) {
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
export async function testMainFunction() {
    "use electron";
    console.log('[Main Process: testMainFunction] Called');
    return "Main process is working!";
} 
