#!/usr/bin/env node

const { spawn } = require('child_process');
const http = require('http');

// Configuration
const DEFAULT_PORT = 3025;
const MCP_MODULE_NAME = '@agentdeskai/browser-tools-mcp';
const SERVER_MODULE_NAME = '@agentdeskai/browser-tools-server';

// State variables
let browserServerProcess = null;
let mcpServerProcess = null;
let isShuttingDown = false;

/**
 * Check if a server is already running on the specified port
 */
async function isServerRunning(port) {
    return new Promise((resolve) => {
        const req = http.get({
            hostname: 'localhost',
            port,
            path: '/.identity',
            timeout: 1000
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    // Check if this is actually our browser-tools-server
                    if (response.signature === 'mcp-browser-connector-24x7') {
                        console.log(`Browser tools server already running on port ${port}`);
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                } catch (e) {
                    resolve(false);
                }
            });
        });
        
        req.on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Start the browser tools server using npx
 */
async function startBrowserServer() {
    // Check if server is already running
    if (await isServerRunning(DEFAULT_PORT)) {
        console.log('Browser server already running, skipping start');
        return true;
    }
    
    try {
        console.log(`Starting browser server with npx ${SERVER_MODULE_NAME}`);
        
        // Start the browser server with npx
        browserServerProcess = spawn('npx', [SERVER_MODULE_NAME], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false
        });
        
        // Handle server output
        browserServerProcess.stdout.on('data', (data) => {
            console.log(`[Browser Server] ${data.toString().trim()}`);
        });
        
        browserServerProcess.stderr.on('data', (data) => {
            console.error(`[Browser Server Error] ${data.toString().trim()}`);
        });
        
        // Handle server exit
        browserServerProcess.on('exit', (code) => {
            console.log(`Browser server exited with code ${code}`);
            browserServerProcess = null;
            
            if (!isShuttingDown) {
                console.error('Browser server terminated unexpectedly');
                process.exit(1);
            }
        });
        
        // Wait for server to start
        return new Promise((resolve) => {
            // Try to connect to the server repeatedly
            let attempts = 0;
            const maxAttempts = 30;
            const interval = setInterval(async () => {
                attempts++;
                if (await isServerRunning(DEFAULT_PORT)) {
                    clearInterval(interval);
                    console.log('Browser server is running');
                    resolve(true);
                } else if (attempts >= maxAttempts) {
                    clearInterval(interval);
                    console.error('Failed to connect to browser server after multiple attempts');
                    resolve(false);
                }
            }, 1000);
        });
    } catch (error) {
        console.error('Error starting browser server:', error.message);
        return false;
    }
}

/**
 * Start the MCP server using npx
 */
async function startMcpServer() {
    try {
        console.log(`Starting MCP server with npx ${MCP_MODULE_NAME}`);
        
        // Start the MCP server with stdio inherited to handle MCP protocol directly
        mcpServerProcess = spawn('npx', [MCP_MODULE_NAME], {
            stdio: 'inherit',
            detached: false
        });
        
        // Handle server exit
        mcpServerProcess.on('exit', (code) => {
            console.log(`MCP server exited with code ${code}`);
            mcpServerProcess = null;
            
            // If the MCP server exits, we should shut down everything
            if (!isShuttingDown) {
                isShuttingDown = true;
                cleanup();
                process.exit(code || 0);
            }
        });
        
        return true;
    } catch (error) {
        console.error('Error starting MCP server:', error.message);
        return false;
    }
}

/**
 * Clean up all processes on exit
 */
function cleanup() {
    isShuttingDown = true;
    console.log('Cleaning up...');
    
    if (mcpServerProcess) {
        console.log('Terminating MCP server');
        mcpServerProcess.kill();
    }
    
    if (browserServerProcess) {
        console.log('Terminating browser server');
        browserServerProcess.kill();
    }
}

/**
 * Main entry point
 */
async function main() {
    console.log('Starting Cursor Browser Tools Wrapper');
    
    // Set up clean exit handlers
    process.on('SIGINT', () => {
        console.log('Received SIGINT signal');
        cleanup();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('Received SIGTERM signal');
        cleanup();
        process.exit(0);
    });
    
    // Start the browser server first
    console.log('Starting browser server...');
    const browserServerStarted = await startBrowserServer();
    if (!browserServerStarted) {
        console.error('Failed to start browser server');
        process.exit(1);
    }
    
    // Then start the MCP server
    console.log('Starting MCP server...');
    const mcpServerStarted = await startMcpServer();
    if (!mcpServerStarted) {
        console.error('Failed to start MCP server');
        cleanup();
        process.exit(1);
    }
    
    console.log('Both servers started successfully');
}

// Start the application
main().catch(error => {
    console.error('Unhandled error:', error.message);
    cleanup();
    process.exit(1);
});