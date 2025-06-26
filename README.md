# 🎶 Discord Music Video livestream Bot 🎶

A powerful and reliable Discord bot for streaming from YouTube directly or video url to your voice channel. Built with Bun and Node.js for maximum performance.

---

## ✨ Features

- **YouTube Integration:** Easily play any video or playlist from YouTube.
- **Easy to Use:** Simple commands to get the music playing in seconds.
  
---

## 🚀 Getting Started Guide

Follow these steps to get your own instance of the bot running.

### Prerequisites

- [Bun](https://bun.sh/) installed on your system.
- A Discord Bot Token. You can get one from the [tutorial](https://www.reddit.com/r/Discord_selfbots/comments/1koj2mh/comment/mu6fq5t/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button).
- `yt-dlp.exe` placed inside the `scripts/` directory.

### Installation & Setup

1.  **Clone the Repository (or use your local copy):**
    ```bash
    git clone https://github.com/bayusegara27/discord-music-stream-bot.git
    cd discord-music-stream-bot
    ```

2.  **Install Dependencies:**
    ```bash
    bun install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file by copying the example file.
    ```bash
    cp example.env .env
    ```
    Open the `.env` file and fill in your bot token and other required values.
    ```
    DISCORD_TOKEN=YOUR_BOT_TOKEN
    CLIENT_ID=YOUR_BOT_CLIENT_ID
    GUILD_ID=YOUR_TEST_SERVER_ID
    ```

4.  **Run the Bot:**
    Use the following command to start the bot.
    ```bash
    bun run start
    ```

---

## 🤖 Bot Commands


- `/play <youtube_url_or_keywords>`: Plays a song from YouTube.
- `/stop`: Stops the music and clears the queue.
- `/skip`: Skips the currently playing song.
- and more.

---

Enjoy the music! 🎧
