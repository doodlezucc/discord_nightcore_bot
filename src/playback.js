import * as Voice from "@discordjs/voice";
import ffmpeg from "fluent-ffmpeg";
import ytdl from "ytdl-core";
import * as fs from "fs";
import * as traffic from "./traffic.js";
import { onPlayError } from "./index.js";
import { reactions } from "./branding.js";

export const rawFormat = "s16le";

/** @param {Connection} connection */
export async function playSong(connection) {
    const song = connection.queue[0];
    connection.songStartTimestamp = Date.now();
    connection.attempts++;

    try {
        /** @type {MockFormat} */
        let format = song.format;

        if (!format) {
            const info = await ytdl.getInfo(song.url);
            format = {
                contentLength: Infinity,
            };
            for (let fmt of info.formats) {
                if (fmt.hasAudio && !fmt.hasVideo) {
                    fmt.contentLength = parseInt(fmt.contentLength);
                    // Get smallest audio-only file
                    if (
                        fmt.audioBitrate > 56 &&
                        fmt.contentLength < format.contentLength
                    ) {
                        format = fmt;
                    }
                }
            }

            if (!format) {
                connection.textChannel.send(
                    "**oh no** I could't find a good audio source for `" +
                        video.title +
                        "` " +
                        smiley(sad),
                );
                return connection.skip();
            }

            song.format = format;
        }

        // Initialize ffmpeg
        const sampleRate = format.audioSampleRate;

        let filters = [
            "asetrate=" +
                sampleRate +
                "*" +
                (song.effects.rate * format.audioChannels) / 2,
            "aresample=" + 48000,
        ];
        if (song.effects.bassboost != 0) {
            filters.push(
                "firequalizer=gain_entry='entry(0,0);entry(100," +
                    song.effects.bassboost +
                    ");entry(350,0)'",
            );
        }
        if (song.effects.amplify != 0) {
            filters.push("volume=" + song.effects.amplify + "dB");
        }

        const reaction = song.message.react(reactions.nowPlaying);
        /** @type {fs.ReadStream} */
        let readStream;

        async function stopThisSong() {
            connection.player.removeAllListeners();
            connection.player.stop(true);
            ff?.kill("SIGTERM");
            if (fs.existsSync(song.file)) {
                fs.unlinkSync(song.file);
            }
            connection.onSongEnd();
            var r = await reaction;
            if (r && r.message) {
                try {
                    await r.remove();
                } catch (error) {
                    console.log("Failed to remove reaction");
                }
            }
        }

        const ff = ffmpeg()
            .addInput(format.url)
            .audioFilter(filters)
            .audioCodec("pcm_" + rawFormat)
            .format(rawFormat)
            .on("error", (err) => {
                const processWasKilled =
                    err.message.includes("SIGTERM") ||
                    err.message.includes("signal 15");

                if (!processWasKilled) {
                    const doRetry =
                        err.message.includes("403 Forbidden") &&
                        connection.attempts < 3;

                    if (doRetry) {
                        connection.queue.unshift(song);
                        connection.attempts++;
                        console.log("attempt " + connection.attempts);
                    } else {
                        connection.attempts = 0;
                        onPlayError(
                            song.searchQuery,
                            connection.textChannel,
                            err,
                        );
                    }
                    stopThisSong();
                }
            });

        const ffmpegReady = new Promise((resolve) => {
            let count = 0;
            ff.on("progress", (progress) => {
                console.log(progress);
                count++;

                if (count == 2) {
                    resolve();
                }
            });

            song.writtenToDisk = new Promise((onWritten) => {
                ff.on("end", () => {
                    console.log("ffmpeg end");
                    resolve();
                    onWritten();
                });
            });
        });

        const writeStream = fs.createWriteStream(song.file);
        ff.pipe(writeStream);

        // Register audio download as traffic
        // (might count too much if users decide to skip midway through)
        traffic.onRead(parseInt(format.contentLength));

        // Give the server a head start on writing the nightcorified file.
        // If this timeout is set too low, an end of stream occurs.
        await ffmpegReady;
        connection.songStartTimestamp = Date.now();

        readStream = fs.createReadStream(song.file);
        readStream.on("data", traffic.onWrite);

        const resource = Voice.createAudioResource(readStream, {
            inputType: Voice.StreamType.Raw,
        });
        connection.player.play(resource);

        connection.player
            .on("stateChange", (oldState, newState) => {
                console.log(newState);
                const playbackHasStopped =
                    newState.status == Voice.AudioPlayerStatus.Idle ||
                    newState.status == Voice.AudioPlayerStatus.AutoPaused;

                if (playbackHasStopped) {
                    connection.attempts = 0;
                    stopThisSong();
                }
            })
            .on("error", (err) => {
                console.error(err.stack || err);
            });
    } catch (err) {
        connection.attempts = 0;
        onPlayError(song.searchQuery, connection.textChannel, err);
        connection.onSongEnd();
    }
}
