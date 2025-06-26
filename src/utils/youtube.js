import ytdl_dlp from './yt-dlp.js';
import logger from './logger.js';
import play from 'play-dl';

export class Youtube {
    /**
     * Gets video information from a YouTube URL using play-dl.
     * @param {string} url The YouTube video URL.
     * @returns {Promise<object|null>} Video details or null if not found or not a valid video.
     */
    async getVideoInfo(url) {
        try {
            if (play.yt_validate(url) !== 'video') {
                return null;
            }

            const videoInfo = await play.video_info(url, { hls: false });
            const details = videoInfo.video_details;

            if (!details?.id || !details.title) {
                 logger.warn(`Failed to parse video info for URL: ${url}.`);
                 return null;
            }

            return {
                id: details.id,
                title: details.title,
                url: details.url,
                isLive: details.live,
            };
        } catch (error) {
            if (error.message.includes('members-only content')) {
                logger.warn(`Attempted to access a members-only video: ${url}`);
                throw new Error('members-only');
            }
            
            logger.error(`Failed to get video info for URL ${url}: ${error.message}`);
            return null;
        }
    }

    /**
     * Gets all video information from a YouTube playlist, reconstructing clean URLs from video IDs.
     * @param {string} url The YouTube playlist URL.
     * @returns {Promise<Array<object>|null>} An array of video details or null on error.
     */
    async getPlaylistInfo(url) {
        try {
            if (play.yt_validate(url) !== 'playlist') {
                return null;
            }
            const playlist = await play.playlist_info(url, { incomplete: true });
            await playlist.fetch();

            logger.info(`Playlist "${playlist.title}" found. Reconstructing URLs for ${playlist.videos.length} videos...`);

            const videos = playlist.videos.map(video => {
                if (!video.id) {
                    logger.warn(`Skipping a video in playlist "${playlist.title}" because it has no ID.`);
                    return null;
                }
                
                // --- PERBAIKAN: Membuat URL YouTube yang valid dari ID video ---
                const cleanUrl = `https://www.youtube.com/watch?v=${video.id}`;
                
                return {
                    title: video.title || 'Untitled Video',
                    source: cleanUrl, // Gunakan URL yang bersih hasil rekonstruksi
                    type: 'youtube',
                    isLive: video.live,
                };
            }).filter(Boolean); // Hapus video yang gagal (null)

            logger.info(`Successfully reconstructed ${videos.length} URLs from playlist: ${playlist.title}`);
            return videos;
        } catch (error) {
            logger.error(`Failed to get playlist info for URL ${url}: ${error.message}`);
            return null;
        }
    }

    /**
     * Searches YouTube for a title and returns the first video result.
     * @param {string} title The search query.
     * @returns {Promise<{pageUrl: string|null, title: string|null}>}
     */
    async searchAndGetPageUrl(title) {
        try {
            const results = await play.search(title, { limit: 1, source: { youtube: 'video' } });
            if (results.length === 0 || !results[0]?.url) {
                logger.warn(`No video found on YouTube for title: "${title}".`);
                return { pageUrl: null, title: null };
            }
            return { pageUrl: results[0].url, title: results[0].title || null };
        } catch (error) {
            logger.error(`Video search failed for title "${title}": ${error.message}`);
            return { pageUrl: null, title: null };
        }
    }

    /**
     * Gets a direct playable stream URL for a YouTube video (live or not).
     * @param {string} youtubePageUrl The original YouTube page URL.
     * @param {boolean} isLive Indicates if the video is a livestream.
     * @returns {Promise<string|null>} The direct stream URL or null.
     */
    async getStreamUrl(youtubePageUrl, isLive = false) {
        try {
            const format = isLive
                ? 'best[protocol=m3u8_native]/best[protocol=http_dash_segments]/best'
                : 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best';

            logger.info(`Fetching stream URL with format: ${format}`);

            const streamUrl = await ytdl_dlp(youtubePageUrl, {
                getUrl: true,
                format: format,
                noPlaylist: true,
                quiet: true,
                noWarnings: true,
            });

            if (typeof streamUrl === 'string' && streamUrl.trim()) {
                logger.info(`Successfully got stream URL for ${youtubePageUrl}`);
                return streamUrl.split('\n')[0];
            }
            logger.warn(`yt-dlp did not return a valid stream URL for: ${youtubePageUrl}.`);
            return null;
        } catch (error) {
            logger.error(`Failed to get stream URL for ${youtubePageUrl}: ${error.message}`);
            return null;
        }
    }
}