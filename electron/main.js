// electron/main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let nextProcess;

const isDev = process.env.NODE_ENV === 'development';
const PORT = 3000;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'VPS Management Tool',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    const url = isDev ? `http://localhost:${PORT}` : `http://localhost:${PORT}`;
    mainWindow.loadURL(url);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startNextServer() {
    return new Promise((resolve) => {
        // In production, spawn next start
        nextProcess = spawn('npx', ['next', 'start', '-p', String(PORT)], {
            cwd: path.join(__dirname, '..'),
            shell: true,
            env: { ...process.env, NODE_ENV: 'production' }
        });

        nextProcess.stdout.on('data', (data) => {
            if (data.toString().includes('Ready') || data.toString().includes(`localhost:${PORT}`)) {
                resolve();
            }
        });
    });
}

app.whenReady().then(async () => {
    if (!isDev) {
        await startNextServer();
    }
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (nextProcess) nextProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});
