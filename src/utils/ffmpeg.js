import config from "../config.js";
import ffmpeg from "fluent-ffmpeg";
import path from "path";

export async function getVideoParams(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                return reject(err);
            }

            const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');

            if (videoStream && videoStream.width && videoStream.height) {
                const rFrameRate = videoStream.r_frame_rate || videoStream.avg_frame_rate;

                if (rFrameRate) {
                    const [numerator, denominator] = rFrameRate.split('/').map(Number);
                    videoStream.fps = denominator > 0 ? numerator / denominator : 0;
                } else {
                    videoStream.fps = 0;
                }

                resolve({
                    width: videoStream.width,
                    height: videoStream.height,
                    bitrate: videoStream.bit_rate || "N/A",
                    maxbitrate: videoStream.max_bit_rate || "N/A",
                    fps: videoStream.fps
                });
            } else {
                reject(new Error('Unable to get video parameters.'));
            }
        });
    });
}