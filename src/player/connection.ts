import type * as Discord from "discord.js";
import * as Voice from "@discordjs/voice";
import { SongPlayback } from "./playback";
import type { Song } from "./song";
import * as traffic from "../traffic";

// A friend wanted this to be exactly 3:32.
const idleTimeoutInSeconds = 60 * 3 + 32;

export type LeaveCallback = () => void;

export class Connection {
    private readonly onLeave: LeaveCallback;
    private readonly player: Voice.AudioPlayer;
    private queue: Song[] = [];

    private voiceConnection?: Voice.VoiceConnection;
    private currentPlayback?: SongPlayback;
    private idleTimeout?: NodeJS.Timeout;

    constructor(onLeave: LeaveCallback) {
        this.onLeave = onLeave;

        this.player = Voice.createAudioPlayer({
            debug: true,
            behaviors: { maxMissedFrames: 100 },
        });
    }

    get queueLength() {
        return this.queue.length;
    }

    get secondsUntilIdle() {
        if (!this.currentPlayback) {
            throw new Error("Nothing is playing right now");
        }

        let sumOfSongDurations = this.queue.reduce(
            (seconds, song) => seconds + song.durationInSeconds,
            0,
        );

        const secondsIntoCurrentSong =
            (Date.now() - this.currentPlayback.startTimestamp) / 1000;

        return sumOfSongDurations - secondsIntoCurrentSong;
    }

    get currentSong() {
        return this.playing ? this.queue[0] : undefined;
    }

    get playing() {
        return this.queue.length > 0;
    }

    join(channel: Discord.VoiceBasedChannel) {
        if (this.voiceConnection) {
            const currentChannelId = this.voiceConnection.joinConfig.channelId;

            if (channel.id === currentChannelId) {
                return;
            }
        }

        this.voiceConnection = Voice.joinVoiceChannel({
            selfMute: false,
            selfDeaf: false,
            channelId: channel.id,
            guildId: channel.guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });
        this.voiceConnection.subscribe(this.player);
    }

    addToQueue(song: Song) {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
        }

        this.queue.push(song);
        if (this.queue.length == 1) {
            // Queue was previously empty
            this.startNextSong();
        }
    }

    skipCurrentSong() {
        this.player.stop();
    }

    stop() {
        this.queue = [];
        this.player.stop();
    }

    leave() {
        this.voiceConnection?.disconnect();
        this.onLeave();
    }

    private startNextSong() {
        if (this.currentPlayback) {
            throw new Error("Another playback is already playing");
        }

        this.currentPlayback = new SongPlayback(
            this.queue[0],
            this.player,
            this.onSongEnd,
        );

        this.currentPlayback!.start();
    }

    private onSongEnd() {
        this.currentPlayback = undefined;

        if (this.queue.length) this.queue.shift();

        if (this.queue.length) {
            this.startNextSong();
        } else {
            this.idleTimeout = setTimeout(
                this.leave,
                idleTimeoutInSeconds * 1000,
            );
        }
    }

    async saveToMp3() {
        return await this.currentPlayback!.saveToMp3();
    }

    ensureConnectionToVoiceChannel(vc: Discord.VoiceBasedChannel) {}
}
