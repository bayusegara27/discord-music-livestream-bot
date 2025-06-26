import dotenv from "dotenv";

dotenv.config();

// MODIFIKASI: Menambahkan codec spesifik NVIDIA
const VALID_VIDEO_CODECS = ['VP8', 'H264', 'H265', 'VP9', 'AV1', 'H264_NVENC', 'HEVC_NVENC'];

function parseBoolean(value) {
    if (typeof value === "string") {
        value = value.trim().toLowerCase();
    }
    return value === "true";
}

function parseVideoCodec(value) {
    if (typeof value === "string") {
        value = value.trim().toUpperCase();
    }
    // Logika diubah agar lebih fleksibel
    if (VALID_VIDEO_CODECS.includes(value)) {
        return value;
    }
    // Default ke H264 jika tidak valid
    console.warn(`Invalid or unsupported video codec "${value}". Defaulting to H264.`)
    return "H264";
}

function parsePreset(value) {
    if (typeof value === "string") {
        value = value.trim().toLowerCase();
    }
    const presets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"];
    if (presets.includes(value)) {
        return value;
    }
    return "ultrafast";
}

export default {
    // Selfbot options
    token: process.env.TOKEN || '',
    prefix: process.env.PREFIX || '$',
    guildId: process.env.GUILD_ID || '',
    cmdChannelId: process.env.COMMAND_CHANNEL_ID || '',
    videoChannelId: process.env.VIDEO_CHANNEL_ID || '',

    // General options
    videosDir: process.env.VIDEOS_DIR || './videos',

    // Stream options
    respect_video_params: parseBoolean(process.env.STREAM_RESPECT_VIDEO_PARAMS),
    width: parseInt(process.env.STREAM_WIDTH) || 1280,
    height: parseInt(process.env.STREAM_HEIGHT) || 720,
    fps: parseInt(process.env.STREAM_FPS) || 30,
    bitrateKbps: parseInt(process.env.STREAM_BITRATE_KBPS) || 2000,
    maxBitrateKbps: parseInt(process.env.STREAM_MAX_BITRATE_KBPS) || 2500,
    hardwareAcceleratedDecoding: parseBoolean(process.env.STREAM_HARDWARE_ACCELERATION),
    h26xPreset: parsePreset(process.env.STREAM_H26X_PRESET),
    videoCodec: parseVideoCodec(process.env.STREAM_VIDEO_CODEC),
};