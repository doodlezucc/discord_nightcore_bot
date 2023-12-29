import ffmpeg from "fluent-ffmpeg";

import { searchVideos } from "./youtube-api.js";
import { durationToSeconds } from "../duration.js";
import { readableStreamToText } from "bun";
import { MediaTooLongError } from "./errors/media-too-long-error.js";
import { NoResultsError } from "./errors/no-results-error.js";

export const allowedMaximumDurationInSeconds = 60 * 60;

export type AudioFormat = {
    url: string;
    audioChannels: number;
    audioSampleRate: number;
};

export type BasicMedia = {
    url: string;
    title: string;
    durationInSeconds: number;
    thumbnail?: string;
};

/**
 * A video/media object extracted from a site other than YouTube containing similar properties.
 */
export type MockMedia = BasicMedia & {
    id: string;
    format: AudioFormat;
};

function extractVideoInfoFromYtdl(
    url: string,
    ytdlOutput: string[],
): Partial<MockMedia> {
    const durationString = ytdlOutput[4];

    const duration = durationString
        ? durationToSeconds(durationString)
        : undefined;

    return {
        url: url,
        id: ytdlOutput[1],
        title: ytdlOutput[0],
        durationInSeconds: duration,
        thumbnail: ytdlOutput[3],
    };
}

async function asyncFfprobe(mediaSrc: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(
            mediaSrc,
            ["-hide_banner", "-loglevel", "warning"],
            (err, data) => {
                if (err) {
                    return reject(err);
                }

                return resolve(data);
            },
        );
    });
}

async function probeOutput(url: string, ytdlOutput: string[]) {
    const mock = extractVideoInfoFromYtdl(url, ytdlOutput);

    const mediaUrl = ytdlOutput[2];
    const probeData = await asyncFfprobe(mediaUrl);

    const format = probeData.format;
    const audioStream = probeData.streams.find((s) => s.codec_type === "audio");

    if (audioStream) {
        if (!mock.durationInSeconds) {
            const seconds = format.duration;
            mock.durationInSeconds = seconds;
        }
        mock.format = {
            url: mediaUrl,
            audioChannels: audioStream.channels!,
            audioSampleRate: audioStream.sample_rate!,
        };
    } else {
        throw new Error("No audio stream found.");
    }

    return mock as MockMedia;
}

export async function urlToInfo(url: string): Promise<MockMedia> {
    const child = Bun.spawn([
        "yt-dlp",
        "--get-title",
        "--get-thumbnail",
        "--get-duration",
        "--get-id",
        "--get-url",
        "-f",
        "worstaudio/worst",
        url,
    ]);

    const output = await readableStreamToText(child.stdout);
    const ytdlOutputLines = output.split("\n");

    if (child.exitCode != 0) {
        throw new Error("Failed to get video info.");
    }

    return await probeOutput(url, ytdlOutputLines);
}

export abstract class GenericSearcher {
    protected async findVideoFromLink(url: string): Promise<MockMedia> {
        const mock = await urlToInfo(url);

        if (mock.durationInSeconds > allowedMaximumDurationInSeconds) {
            throw new MediaTooLongError();
        }

        return mock;
    }

    protected async findVideoFromQuery(query: string): Promise<BasicMedia> {
        const videoResults = await searchVideos(query);

        if (!videoResults.length) {
            throw new NoResultsError();
        }

        const video = videoResults.find(
            (vid) => vid.durationInSeconds <= allowedMaximumDurationInSeconds,
        );

        if (!video) {
            throw new MediaTooLongError();
        }

        return video;
    }

    async findVideo(query: string): Promise<BasicMedia> {
        if (query.startsWith("https://") && !query.includes(" ")) {
            return await this.findVideoFromLink(query);
        } else {
            return await this.findVideoFromQuery(query);
        }
    }
}
