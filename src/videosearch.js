import ChildProcess from "child_process";
import Discord from "discord.js";
import ffmpeg from "fluent-ffmpeg";
import { secondsToDuration } from "./duration.js";

import smiley, {
    sad,
    nervous
} from "./smiley.js";
import { searchOnYoutube } from "./youtube-api.js";

export class MockFormat {
    /**
     * A video/media format extracted from a site other than YouTube containing similar properties.
     * @param {string} url
     * @param {number} audioChannels
     * @param {number} audioSampleRate
     */
    constructor(url, audioChannels, audioSampleRate) {
        this.url = url;
        this.audioChannels = audioChannels;
        this.audioSampleRate = audioSampleRate;
    }
}

export class MockVideo {
    /**
     * A video/media object extracted from a site other than YouTube containing similar properties.
     * @param {string} url
     * @param {string} id
     * @param {string} title
     * @param {string} duration
     * @param {string} thumbnail
     * @param {MockFormat} format
     */
    constructor(url, id, title, duration, thumbnail, format) {
        this.url = url;
        this.id = id;
        this.title = title;
        this.duration = duration;
        this.thumbnail = thumbnail;
        this.format = format;
    }

    get bestThumbnail() {
        return { "url": this.thumbnail };
    }
}

/**
 * @param {string} url
 * @returns {Promise<MockVideo>}
 */
export async function urlToInfo(url) {
    return new Promise((resolve, reject) => {
        const lines = [];

        const child = ChildProcess.spawn("yt-dlp", [
            "--get-title",
            "--get-thumbnail",
            "--get-duration",
            "--get-id",
            "--get-url",
            "-f", "worstaudio/worst",
            url
        ], { shell: true, })
            .on("close", async (code) => {
                if (code == 0) {
                    const mock = new MockVideo(url, lines[1], lines[0], lines[4], lines[3]);

                    await new Promise(probed => {
                        const mediaUrl = lines[2];
                        ffmpeg.ffprobe(mediaUrl, [
                            "-hide_banner",
                            "-loglevel",
                            "warning"
                        ], (err, data) => {
                            if (err) return reject(err);

                            const format = data.format;
                            const stream = data.streams.find(s => s.codec_type === "audio");
                            if (stream) {
                                if (!mock.duration) {
                                    const seconds = format.duration;
                                    mock.duration = secondsToDuration(parseFloat(seconds));
                                }
                                mock.format = new MockFormat(mediaUrl, stream.channels, stream.sample_rate);
                                probed();
                            } else {
                                reject(new Error("No audio stream found."));
                            }
                        });
                    });

                    resolve(mock);
                } else {
                    reject(new Error("Failed to get video info."));
                }
            });

        child.stdout.on('data', (data) => {
            const s = data.toString() + "";
            for (const line of s.trim().split("\n")) {
                lines.push(line);
            }
        });
        child.stderr.on('data', (data) => {
            const s = data.toString() + "";
            if (s.includes("ERROR:")) {
                reject(s.trim());
            }
        });
    });
}

export function isUnderThreeHours(durationString) {
    return !(/([1-9][0-9]|[3-9]):.*:/).test(durationString);
}

/**
 * @param {string} query
 * @param {Discord.Message} message
 * @returns {Promise<MockVideo>}
 */
export async function findVideo(query, message) {
    let video;
    let tooLong = false;

    if (query.startsWith("https://") && !query.includes(" ")) {
        // Find non-youtube video/media
        if (!(query.includes("youtu.be/") || query.includes("youtube.com/"))) {
            setTimeout(() => {
                message.channel.send("cringe bro that ain't even a youtube link but whatever I'll try my best");
            }, 500);
        }
        const mock = await urlToInfo(query);

        if (mock.duration && !isUnderThreeHours(mock.duration)) {
            tooLong = true;
        } else {
            video = mock;
        }
    } else {
        // Find youtube video
        const searchResults = await searchOnYoutube(query);

        video = searchResults.find((item) => {
            if (item.snippet.liveBroadcastContent !== "none") return false;

            const isGoodDuration = isUnderThreeHours(item.contentDetails.duration);
            if (!isGoodDuration) tooLong = true;
            return isGoodDuration;
        });
    }

    if (!video) {
        if (tooLong) {
            message.channel.send("**holy frick...** it's so long " + smiley(nervous, true));
            setTimeout(() => {
                message.channel.send("I- I don't think I can fit this in my storage, sowwy " + smiley(sad));
            }, 1000);
        } else {
            message.channel.send(
                "**ok wow** I couldn't find any video at all how is that even possible? " + smiley(sad));
        }
    }

    return video;
}
