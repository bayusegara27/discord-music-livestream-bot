import { Client, TextChannel, CustomStatus } from "discord.js-selfbot-v13";
import { Streamer, Utils, prepareStream, playStream } from "@dank074/discord-video-stream";
import config from "./config.js";
import fs from 'fs';
import path from 'path';
import { getVideoParams } from "./utils/ffmpeg.js";
import logger from './utils/logger.js';
import { downloadExecutable, downloadToTempFile, checkForUpdatesAndUpdate } from './utils/yt-dlp.js';
import { Youtube } from './utils/youtube.js';
import play from 'play-dl';

// --- Initialization ---
(async () => {
    try {
        await downloadExecutable();
        await checkForUpdatesAndUpdate();
    } catch (error) {
        logger.error("Error during initial yt-dlp setup/update:", error);
    }
})();

const streamer = new Streamer(new Client());
const youtube = new Youtube();
let queue = [];
let currentFfmpegProcess = null;
let controller = new AbortController();
let disconnectTimer = null;

const streamState = {
    joined: false,
    playing: false,
    paused: false,
    manualStop: false,
    guildId: config.guildId,
    channelId: config.videoChannelId,
};

const streamOpts = {
    width: config.width,
    height: config.height,
    frameRate: config.fps,
    bitrateVideo: config.bitrateKbps,
    bitrateVideoMax: config.maxBitrateKbps,
    videoCodec: Utils.normalizeVideoCodec(config.videoCodec),
    hardwareAcceleratedDecoding: config.hardwareAcceleratedDecoding,
    minimizeLatency: false,
    h26xPreset: config.h26xPreset
};

// --- Helper Functions ---
const status_idle = () => new CustomStatus(streamer.client).setEmoji('📽️').setState('Ready to play!');
const status_watch = (name) => new CustomStatus(streamer.client).setEmoji('🎬').setState(`Playing: ${name}`);
const status_paused = (name) => new CustomStatus(streamer.client).setEmoji('⏸️').setState(`Paused: ${name}`);

async function sendReply(message, emoji, title, description) {
    if (!message || !message.reply) return;
    try {
        await message.react(emoji);
        await message.reply(`${emoji} **${title}**: ${description}`);
    } catch (error) {
        logger.warn(`Could not send reply to message: ${error.message}`);
    }
}

// --- Core Playback & Queue Logic ---

async function processQueue(message) {
    while (queue.length > 0) {
        if (streamState.manualStop) {
            break;
        }

        streamState.playing = true;
        const song = queue[0];

        logger.info(`Processing queue, now playing: ${song.title}`);
        sendReply(message, '▶️', 'Now Playing', `\`${song.title}\`\nRequested by: ${song.requester}`);

        await executeStream(song, message);

        if (queue[0] === song) {
            queue.shift();
        }
    }

    streamState.playing = false;
    if (streamState.manualStop) {
        logger.info("Playback stopped manually. Disconnecting.");
        streamer.leaveVoice();
        streamer.client.user?.setActivity(status_idle());
        streamState.joined = false;
        streamState.manualStop = false;
    } else if (streamState.joined) {
        logger.info("Queue is empty. Bot will disconnect in 30 seconds.");
        sendReply(message, 'ℹ️', 'Queue Empty', 'Antrean kosong. Bot akan keluar dalam 30 detik jika tidak ada lagu baru.');
        streamer.client.user?.setActivity(status_idle());

        disconnectTimer = setTimeout(() => {
            if (queue.length === 0 && streamState.joined) {
                logger.info("Disconnecting due to inactivity.");
                streamer.leaveVoice();
                streamState.joined = false;
            } else {
                 logger.info("A new song was added. Staying connected.");
            }
        }, 30000);
    }
}

async function executeStream(song, message) {
    let inputForFfmpeg = song.source;
    let tempFilePath = null;

    controller = new AbortController();
    streamer.client.user?.setActivity(status_watch(song.title));

    // Fungsi pembantu untuk pembersihan file yang aman
    const cleanupTempFile = (filePath, process) => {
        return new Promise((resolve) => {
            if (!filePath) return resolve();
            
            const deleteFile = () => {
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        logger.info(`Successfully deleted temp file: ${filePath}`);
                    } catch (cleanupError) {
                        // Jika masih gagal, log sebagai warning, karena ini tidak kritis
                        logger.warn(`Could not delete temp file on final attempt: ${cleanupError.message}`);
                    }
                }
                resolve();
            };

            // Jika proses ffmpeg ada dan belum keluar, tunggu sampai benar-benar berhenti
            if (process && process.exitCode === null) {
                logger.info("FFmpeg process is still running. Waiting for it to exit before deleting temp file...");
                process.on('close', deleteFile);
                process.on('error', (err) => {
                    logger.warn(`FFmpeg process emitted an error during cleanup: ${err.message}`);
                    deleteFile();
                });
            } else {
                // Jika proses sudah tidak ada, coba hapus langsung
                deleteFile();
            }
        });
    };

    try {
        if (song.type === 'youtube') {
            if (song.isLive) {
                logger.info(`YouTube video is live: ${song.title}`);
                // Untuk stream live, kita tidak menggunakan yt-dlp untuk download, tetapi untuk mendapatkan URL stream
                const streamUrl = await youtube.getStreamUrl(song.source, true);
                if (streamUrl) {
                    inputForFfmpeg = streamUrl;
                } else {
                    throw new Error('Failed to get live stream URL.');
                }
            } else {
                logger.info(`Downloading YouTube video: ${song.title}`);
                const downloadOptions = {
                    format: `bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best`,
                    noPlaylist: true,
                };
                tempFilePath = await downloadToTempFile(song.source, downloadOptions);
                inputForFfmpeg = tempFilePath;
            }
        }

        const { command, output: ffmpegOutput } = prepareStream(inputForFfmpeg, streamOpts, controller.signal);
        currentFfmpegProcess = command;

        command.on("error", (err, stdout, stderr) => {
            if (!controller.signal.aborted) {
                if (err.message.includes('SIGKILL')) return;
                logger.error(`FFmpeg error: ${err.message}`);
                // Jangan abort di sini untuk menghindari race condition, biarkan playStream yang menangani
            }
        });
        
        // Menunggu streaming selesai atau dihentikan
        await playStream(ffmpegOutput, streamer, undefined, controller.signal);

    } catch (error) {
        if (!controller.signal.aborted) {
            logger.error(`Error in executeStream for ${song.title}: ${error.message}`);
            sendReply(message, '❌', 'Playback Error', `Failed to play \`${song.title}\`. Skipping.`);
        } else {
            logger.info(`Stream for "${song.title}" was aborted as intended.`);
        }
    } finally {
        // --- LOGIKA PENGHAPUSAN BARU ---
        // Gunakan fungsi cleanup yang aman, yang menunggu ffmpeg selesai.
        await cleanupTempFile(tempFilePath, currentFfmpegProcess);
        currentFfmpegProcess = null;
        tempFilePath = null; // Pastikan path dibersihkan setelah dihapus
    }
}

// --- Discord Event Handlers ---

streamer.client.on("ready", async () => {
    logger.info(`${streamer.client.user.tag} is ready`);
    streamer.client.user?.setActivity(status_idle());
});

streamer.client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.member?.user.id === streamer.client.user?.id && oldState.channelId && !newState.channelId) {
        logger.info("Manually disconnected from voice channel. Clearing queue and stopping playback.");
        queue = [];
        streamState.joined = false;
        streamState.playing = false;
        streamState.paused = false;
        streamState.manualStop = true;
        controller?.abort();
        streamer.client.user?.setActivity(status_idle());
    }
});

streamer.client.on('messageCreate', async (message) => {
    if (message.author.bot || message.author.id === streamer.client.user?.id ||
        !config.cmdChannelId.includes(message.channel.id) || !message.content.startsWith(config.prefix)) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
        case 'play': {
            const rawInput = args.join(' ');
            if (!rawInput) return sendReply(message, '❌', 'Error', 'Please provide a search query or a link.');
            
            if (disconnectTimer) {
                clearTimeout(disconnectTimer);
                disconnectTimer = null;
                logger.info("A new song was added, disconnect timer cancelled.");
            }

            const urlRegex = /(https?:\/\/[^\s]+)/;
            const urlMatch = rawInput.match(urlRegex);
            let query = urlMatch ? urlMatch[0] : rawInput;

            try {
                const validationType = play.yt_validate(query);

                if (validationType === 'video') {
                    logger.info(`[YT-VIDEO] Initial validation successful for: ${query}. Fetching metadata...`);
                    const initialDetails = await youtube.getVideoInfo(query);
                    if (!initialDetails) throw new Error('Could not get initial information for this YouTube video.');
                    
                    logger.info(`Got title: "${initialDetails.title}". Searching for clean URL...`);
                    // BUG FIX: Mengganti YoutubeAndGetPageUrl menjadi YoutubeAndGetPageUrl
                    const searchResults = await YoutubeAndGetPageUrl(initialDetails.title);
                    if (!searchResults || !searchResults.pageUrl) {
                        throw new Error(`Could not find a clean URL for "${initialDetails.title}".`);
                    }
                    const cleanUrl = searchResults.pageUrl;
                    logger.info(`Found clean URL: ${cleanUrl}`);

                    const songInfo = { 
                        title: initialDetails.title,
                        source: cleanUrl,
                        type: 'youtube', 
                        isLive: initialDetails.isLive,
                        requester: message.author.username
                    };
                    
                    queue.push(songInfo);
                    sendReply(message, '👍', 'Added to Queue', `\`${songInfo.title}\``);

                } else if (validationType === 'playlist') {
                    // ... (tidak ada perubahan di blok ini)
                    logger.info(`[YT-PLAYLIST] Identified a YouTube playlist link: ${query}`);
                    const playlistVideos = await youtube.getPlaylistInfo(query);
                    if (!playlistVideos || playlistVideos.length === 0) throw new Error('Could not get videos from this playlist.');

                    playlistVideos.forEach(video => {
                        video.requester = message.author.username;
                        queue.push(video);
                    });
                    sendReply(message, '👍', 'Playlist Added', `Added **${playlistVideos.length}** videos to the queue.`);

                } else if (urlMatch) {
                    // ... (tidak ada perubahan di blok ini)
                    logger.info(`[DIRECT-LINK] Identified a direct link: ${query}`);
                    let title = 'Direct Link';
                    try {
                        const urlParts = new URL(query).pathname.split('/');
                        title = decodeURIComponent(urlParts[urlParts.length - 1] || title);
                    } catch (e) {
                        logger.warn("Could not parse URL for filename, using default title.");
                    }
                    const songInfo = { title: title, source: query, type: 'direct', isLive: false, requester: message.author.username };
                    queue.push(songInfo);
                    sendReply(message, '👍', 'Added to Queue', `\`${songInfo.title}\``);

                } else {
                    logger.info(`[SEARCH] Not a URL. Searching YouTube for: "${query}"`);
                    // BUG FIX: Mengganti YoutubeAndGetPageUrl menjadi YoutubeAndGetPageUrl
                    const searchResults = await YoutubeAndGetPageUrl(query);
                    if (!searchResults || !searchResults.pageUrl) {
                        throw new Error(`Video not found on YouTube for "${query}".`);
                    }
                    const videoDetails = await youtube.getVideoInfo(searchResults.pageUrl);
                    if (!videoDetails) {
                        throw new Error('Could not get info for the searched video.');
                    }
                    const songInfo = { 
                        title: videoDetails.title, 
                        source: videoDetails.url, 
                        type: 'youtube', 
                        isLive: videoDetails.isLive,
                        requester: message.author.username
                    };
                    queue.push(songInfo);
                    sendReply(message, '👍', 'Added to Queue', `\`${songInfo.title}\``);
                }

                if (!streamState.playing) {
                    if (!streamState.joined) {
                        await streamer.joinVoice(config.guildId, config.videoChannelId);
                        streamState.joined = true;
                    }
                    processQueue(message);
                }
            } catch (error) {
                // --- LOGIKA BARU: MENANGANI ERROR SPESIFIK ---
                if (error.message === 'members-only') {
                    sendReply(message, '🔒', 'Member-Only Video', 'Video ini hanya untuk anggota channel dan tidak bisa diputar.');
                } else {
                    // Penanganan error umum lainnya
                    logger.error(`Error on /play: ${error.message}`);
                    sendReply(message, '❌', 'Error', `Tidak dapat memproses permintaan Anda: ${error.message}`);
                }
            }
            break;
        }

        case 'pause': {
            if (process.platform === 'win32') {
                return sendReply(message, '⚠️', 'Not Supported', 'The pause feature is not supported on Windows.');
            }
            if (!streamState.playing || streamState.paused) return sendReply(message, '❌', 'Error', 'Not playing or already paused.');
            if (currentFfmpegProcess) {
                currentFfmpegProcess.kill('SIGSTOP');
                streamState.paused = true;
                const currentSongTitle = queue[0]?.title || '...';
                streamer.client.user?.setActivity(status_paused(currentSongTitle));
                sendReply(message, '⏸️', 'Paused', 'Playback is paused.');
            }
            break;
        }

        case 'resume': {
            if (process.platform === 'win32') {
                return sendReply(message, '⚠️', 'Not Supported', 'The resume feature is not supported on Windows.');
            }
            if (!streamState.paused) return sendReply(message, '❌', 'Error', 'Playback is not paused.');
            if (currentFfmpegProcess) {
                currentFfmpegProcess.kill('SIGCONT');
                streamState.paused = false;
                const currentSongTitle = queue[0]?.title || '...';
                streamer.client.user?.setActivity(status_watch(currentSongTitle));
                sendReply(message, '▶️', 'Resumed', 'Playback is resumed.');
            }
            break;
        }

        case 'skip': {
            if (!streamState.playing || queue.length === 0) return sendReply(message, '❌', 'Error', 'Nothing to skip.');
            const skippedTitle = queue[0]?.title || 'current video';
            sendReply(message, '⏭️', 'Skipped', `Skipped \`${skippedTitle}\`.`);
            controller.abort();
            break;
        }

        case 'stop': {
            if (!streamState.joined) return sendReply(message, '❌', 'Error', 'Not in a voice channel.');
            
            sendReply(message, '⏹️', 'Stopped', 'Playback stopped and queue cleared.');
            queue = [];
            streamState.manualStop = true;
            controller.abort();
            
            break;
        }

        case 'playlist':
        case 'queue': {
            if (queue.length === 0) return sendReply(message, 'ℹ️', 'Playlist', 'The queue is empty.');
            const nowPlaying = queue[0];
            const nextUp = queue.slice(1, 11).map((song, index) => `${index + 1}. \`${song.title}\``).join('\n');
            const response = `**Now Playing:** \`${nowPlaying.title}\` (Requested by ${nowPlaying.requester})\n\n**Up Next:**\n${nextUp || 'Nothing else in the queue.'}\n\nTotal in queue: ${queue.length}`;
            message.reply(`📋 **Current Playlist**\n${response}`);
            break;
        }
        
        case 'status': {
            const status = streamState.playing ? (streamState.paused ? 'Paused' : 'Playing') : 'Idle';
            const currentSong = queue[0]?.title || 'N/A';
            const response = `**Status:** ${status}\n**Current Song:** \`${currentSong}\`\n**Queue Length:** ${queue.length}`;
            sendReply(message, 'ℹ️', 'Status', response);
            break;
        }

        case 'help': {
            const helpText = [
                '**StreamBot Commands**',
                '',
                `\`${config.prefix}play <youtube_link|playlist_link|direct_link|search_query>\` - Plays or queues a video/playlist.`,
                `\`${config.prefix}pause\` - Pauses the current video. (Not supported on Windows)`,
                `\`${config.prefix}resume\` - Resumes the paused video. (Not supported on Windows)`,
                `\`${config.prefix}skip\` - Skips the current video.`,
                `\`${config.prefix}stop\` - Stops playback, clears the queue, and disconnects the bot.`,
                `\`${config.prefix}playlist\` - Shows the current video queue.`,
                `\`${config.prefix}status\` - Shows the current playback status.`,
                `\`${config.prefix}help\` - Shows this help message.`
            ].join('\n');
            message.reply(helpText);
            break;
        }
    }
});

process.on('uncaughtException', (error) => {
    if (!(error instanceof Error && error.message.includes('SIGTERM'))) {
        logger.error('Uncaught Exception:', error);
    }
});

if (config.server_enabled) {
    import('./server.js').catch(err => logger.error("Failed to load server:", err));
}

// Login to Discord
streamer.client.login(config.token);