import ffmpeg from "fluent-ffmpeg";

import { searchVideos } from "./youtube-api.js";
import { durationToSeconds } from "../duration.js";
import { readableStreamToText } from "bun";
import { MediaTooLongError } from "./errors/media-too-long-error.js";
import { NoResultsError } from "./errors/no-results-error.js";

export const allowedMaximumDurationInSeconds = 60 * 60;

export type AudioFormat = {
    url: string;
    sizeInBytes: number;
    audioChannels: number;
    audioSampleRate: number;
};

export type InternetMedia = {
    id?: string;
    url: string;
    title: string;
    thumbnail?: string;
    durationInSeconds: number;
};

export type UnprobedInternetMedia = Omit<InternetMedia, "durationInSeconds"> & {
    durationInSeconds?: number;
};

function extractVideoInfoFromYtdl(
    url: string,
    ytdlOutput: string[],
): UnprobedInternetMedia {
    const durationString = ytdlOutput[4];

    const duration = durationString
        ? durationToSeconds(durationString)
        : undefined;

    return {
        url: url,
        id: ytdlOutput[1] ?? undefined,
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

async function probeAudioDurationInSeconds(mediaUrl: string): Promise<number> {
    const probeData = await asyncFfprobe(mediaUrl);

    const audioStream = probeData.streams.find((s) => s.codec_type === "audio");

    if (!audioStream || !audioStream.duration) {
        throw new Error("No audio stream found.");
    }

    return durationToSeconds(audioStream.duration);
}

export async function urlToInfo(url: string): Promise<InternetMedia> {
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

    const unprobed = extractVideoInfoFromYtdl(url, ytdlOutputLines);

    if (unprobed.durationInSeconds) return unprobed as InternetMedia;

    const mediaUrl = ytdlOutputLines[2];
    const duration = await probeAudioDurationInSeconds(mediaUrl);

    return {
        ...unprobed,
        durationInSeconds: duration,
    };
}

export abstract class GenericSearcher {
    protected async findVideoFromLink(url: string): Promise<InternetMedia> {
        const mock = await urlToInfo(url);

        if (mock.durationInSeconds > allowedMaximumDurationInSeconds) {
            throw new MediaTooLongError();
        }

        return mock;
    }

    protected async findVideoFromQuery(query: string): Promise<InternetMedia> {
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

    async findVideo(query: string): Promise<InternetMedia> {
        if (query.startsWith("https://") && !query.includes(" ")) {
            return await this.findVideoFromLink(query);
        } else {
            return await this.findVideoFromQuery(query);
        }
    }
}
