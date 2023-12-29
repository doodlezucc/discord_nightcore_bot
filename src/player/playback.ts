import * as fs from "fs";
import * as Voice from "@discordjs/voice";
import ffmpeg from "fluent-ffmpeg";
import ytdl from "ytdl-core";
import { NoAudioSourceError } from "../search/errors/no-audio-source-error.js";
import type { AudioFormat } from "../search/media-search.js";
import type { Song } from "./song.js";
import { reactions } from "../branding.js";
import * as traffic from "../traffic.js";
import type * as Discord from "discord.js";

const rawFormat = "s16le";

async function getAudioFormatInfo(url: string): Promise<AudioFormat> {
    const info = await ytdl.getInfo(url);

    const audioFormat = info.formats.find(
        (format) => format.hasAudio && !format.hasVideo,
    );

    if (!audioFormat) {
        throw new NoAudioSourceError();
    }

    return {
        url: url,
        audioChannels: audioFormat.audioChannels!,
        audioSampleRate: parseInt(audioFormat.audioSampleRate!),
    };

    // if (!songAudioFormat) {
    //     connection.textChannel.send(
    //         "**oh no** I could't find a good audio source for `" +
    //             video.title +
    //             "` " +
    //             smiley(sad),
    //     );
    //     return connection.skip();
    // }
}

function makeFilteringFfmpegPipeline(song: Song, format: AudioFormat) {
    const sampleRate = format.audioSampleRate;

    const { rate, bassboost, amplify } = song.command;

    let filters = [
        `asetrate=${sampleRate}*${(rate * format.audioChannels) / 2}`,
        `aresample=${48000}`,
    ];

    if (bassboost != 0) {
        filters.push(
            `firequalizer=gain_entry='entry(0,0);entry(100,${bassboost});entry(350,0)'`,
        );
    }

    if (amplify != 0) {
        filters.push(`volume=${amplify}dB`);
    }

    return ffmpeg()
        .addInput(format.url)
        .audioFilter(filters)
        .audioCodec("pcm_" + rawFormat)
        .format(rawFormat);
}

export type SongEndedCallback = () => void;

export class SongPlayback {
    private readonly song: Song;
    private readonly player: Voice.AudioPlayer;
    private readonly onSongEnded: SongEndedCallback;

    private isWrittenToDisk: boolean = false;
    private songStartTimestamp: number = 0;
    private attempts: number = 0;
    private reactionPromise?: Promise<Discord.MessageReaction>;

    private ff?: ffmpeg.FfmpegCommand;

    constructor(
        song: Song,
        player: Voice.AudioPlayer,
        onSongEnded: SongEndedCallback,
    ) {
        this.song = song;
        this.player = player;
        this.onSongEnded = onSongEnded;
    }

    private async stop() {
        this.player.removeAllListeners();
        this.player.stop(true);
        this.ff?.kill("SIGTERM");
        if (fs.existsSync(this.song.file)) {
            fs.unlinkSync(this.song.file);
        }
        this.onSongEnded();
        const reaction = await this.reactionPromise;
        if (reaction && reaction.message) {
            try {
                await reaction.remove();
            } catch (error) {
                console.log("Failed to remove reaction");
            }
        }
    }

    private async waitForFfmpegHeadStart(ff: ffmpeg.FfmpegCommand) {
        return new Promise<void>((resolve) => {
            let count = 0;
            ff.on("progress", (progress) => {
                console.log(progress);
                count++;

                if (count == 2) {
                    resolve();
                }
            });

            ff.on("end", () => {
                console.log("ffmpeg end");
                this.isWrittenToDisk = true;
                resolve();
            });
        });
    }

    async start() {
        this.songStartTimestamp = Date.now();
        this.attempts++;

        const format = await getAudioFormatInfo(this.song.url);

        // Initialize ffmpeg
        const ff = makeFilteringFfmpegPipeline(this.song, format);

        this.reactionPromise = this.song.infoMessage.react(
            reactions.nowPlaying,
        );

        const ffmpegReady = this.waitForFfmpegHeadStart(ff);

        const writeStream = fs.createWriteStream(this.song.file);
        ff.pipe(writeStream);

        // Register audio download as traffic
        // (might count too much if users decide to skip midway through)
        traffic.onRead(parseInt(format.contentLength));

        // Give the server a head start on writing the nightcorified file.
        // If this timeout is set too low, an end of stream occurs.
        await ffmpegReady;
        this.songStartTimestamp = Date.now();

        const readStream = fs.createReadStream(this.song.file);
        readStream.on("data", traffic.onWrite);

        const resource = Voice.createAudioResource(readStream, {
            inputType: Voice.StreamType.Raw,
        });
        this.player.play(resource);

        this.player
            .on("stateChange", (oldState, newState) => {
                console.log(newState);
                const playbackHasStopped =
                    newState.status == Voice.AudioPlayerStatus.Idle ||
                    newState.status == Voice.AudioPlayerStatus.AutoPaused;

                if (playbackHasStopped) {
                    this.attempts = 0;
                    this.stop();
                }
            })
            .on("error", (err) => {
                console.error(err.stack || err);
            });
    }
}
