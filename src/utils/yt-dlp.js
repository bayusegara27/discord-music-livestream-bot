import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import nodePath from "node:path";
import process from "node:process";
import os from "node:os";
import crypto from "node:crypto";
import got from "got";
import logger from "./logger.js";
import { spawn } from "bun";

let determinedFilename;
const platform = process.platform;
const arch = process.arch;

// --- Logic to determine correct yt-dlp executable based on OS/Arch ---
if (platform === "win32") {
    determinedFilename = arch === "x64" ? "yt-dlp.exe" : "yt-dlp_x86.exe";
} else if (platform === "darwin") {
    determinedFilename = "yt-dlp_macos";
} else if (platform === "linux") {
    if (arch === "arm64") determinedFilename = "yt-dlp_linux_aarch64";
    else if (arch === "arm") determinedFilename = "yt-dlp_linux_armv7l";
    else if (arch === "x64") determinedFilename = "yt-dlp";
    else {
        logger.warn(`Unsupported Linux architecture '${arch}'. Falling back to generic 'yt-dlp'.`);
        determinedFilename = "yt-dlp";
    }
} else {
    logger.warn(`Unsupported OS '${platform}'. Attempting 'yt-dlp'.`);
    determinedFilename = "yt-dlp";
}

const filename = determinedFilename;
const scriptsPath = nodePath.resolve(process.cwd(), "scripts");
const exePath = nodePath.resolve(scriptsPath, filename);

function args(url, options) {
    const optArgs = [];
    for (const [key, val] of Object.entries(options)) {
        if (val === null || val === undefined) continue;
        const flag = key.replace(/[A-Z]/g, (ms) => `-${ms.toLowerCase()}`);
        if (typeof val === "boolean") {
            if (val) optArgs.push(`--${flag}`);
            else optArgs.push(`--no-${flag}`);
        } else {
            optArgs.push(`--${flag}`);
            optArgs.push(String(val));
        }
    }
    return [url, ...optArgs];
}

function json(str) {
    try {
        return JSON.parse(str);
    } catch {
        return str;
    }
}

export async function downloadExecutable() {
    if (!existsSync(exePath)) {
        logger.info("Yt-dlp not found, downloading...");
        try {
            const releases = await got.get("https://api.github.com/repos/yt-dlp/yt-dlp/releases?per_page=1").json();
            const asset = releases[0].assets.find(ast => ast.name === filename);
            if (!asset) {
                throw new Error(`Could not find yt-dlp asset for your system: ${filename}`);
            }
            await new Promise((resolve, reject) => {
                got.get(asset.browser_download_url).buffer().then(x => {
                    mkdirSync(scriptsPath, { recursive: true });
                    writeFileSync(exePath, x, { mode: 0o777 });
                    resolve();
                }).catch(reject);
            });
            logger.info("Yt-dlp downloaded successfully.");
        } catch (error) {
            logger.error(`Failed to download yt-dlp: ${error.message}`);
            throw error;
        }
    }
}

export function exec(url, options = {}, spawnOptions = {}) {
    return spawn([exePath, ...args(url, options)], {
        windowsHide: true,
        ...spawnOptions,
        stdio: ["ignore", "pipe", "pipe"]
    });
}

export default async function ytdl(url, options = {}, spawnOptions = {}) {
    let data = "";
    let errorData = "";

    const proc = exec(url, options, spawnOptions);

    if (proc.stdout) {
        for await (const chunk of proc.stdout) {
            data += chunk;
        }
    }
    if (proc.stderr) {
        for await (const chunk of proc.stderr) {
            errorData += chunk;
        }
    }

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        logger.error(`yt-dlp process exited with code ${exitCode}. Stderr: ${errorData}`);
        throw new Error(`yt-dlp failed with exit code ${exitCode}: ${errorData || data}`);
    }
    return json(data);
}

export async function downloadToTempFile(url, options = {}) {
    await downloadExecutable();
    const tempDir = os.tmpdir();
    const tempFilename = `ytdlp_temp_${crypto.randomBytes(6).toString('hex')}.mp4`;
    const tempFilePath = nodePath.join(tempDir, tempFilename);

    const downloadOptions = { ...options, output: tempFilePath, quiet: true, noWarnings: true };
    const proc = spawn([exePath, ...args(url, downloadOptions)], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"]
    });
    
    let errorData = "";
    if (proc.stderr) {
        for await (const chunk of proc.stderr) {
            errorData += chunk;
        }
    }

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
        const errorMessage = `yt-dlp download failed. Code: ${exitCode}. Stderr: ${errorData.trim()}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
    if (!existsSync(tempFilePath)) {
        const errorMessage = `yt-dlp exited successfully but the temp file was not created. Stderr: ${errorData.trim()}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
    logger.info(`Downloaded to temp file: ${tempFilePath}`);
    return tempFilePath;
}

export async function checkForUpdatesAndUpdate() {
    try {
        await downloadExecutable();
        const updateProc = spawn([exePath, "--update"], { stdio: ["ignore", "pipe", "pipe"] });
        
        let stdoutData = "";
        if(updateProc.stdout) {
            for await (const chunk of updateProc.stdout) {
                stdoutData += chunk;
            }
        }

        const stdoutString = stdoutData.toString();
        if (stdoutString.includes("Updated yt-dlp to")) {
            logger.info(`yt-dlp updated successfully.`);
        } else if (stdoutString.includes("is up to date")) {
            logger.info(`yt-dlp is already up to date.`);
        }
    } catch (error) {
        logger.error("Error during yt-dlp update check:", error);
    }
}