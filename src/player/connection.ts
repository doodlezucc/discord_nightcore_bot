import * as Voice from "@discordjs/voice";
import { SongPlayback } from "./playback";
import type { Song } from "./song";

// A friend wanted this to be exactly 3:32.
const idleTimeoutInSeconds = 60 * 3 + 32;

export type LeaveCallback = () => void;

export class Connection {
    private readonly vc: Voice.VoiceConnection;
    private readonly onLeave: LeaveCallback;

    private readonly player: Voice.AudioPlayer;
    private queue: Song[] = [];

    private currentPlayback?: SongPlayback;
    private idleTimeout?: NodeJS.Timeout;

    constructor(
        voiceConnection: Voice.VoiceConnection,
        onLeave: LeaveCallback,
    ) {
        this.vc = voiceConnection;
        this.onLeave = onLeave;

        this.player = Voice.createAudioPlayer({
            debug: true,
            behaviors: { maxMissedFrames: 100 },
        });
        this.vc.subscribe(this.player);
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

    skip() {
        this.player.stop();
    }

    stop() {
        this.queue = [];
        this.player.stop();
    }

    leave() {
        this.vc.disconnect();
        this.onLeave();
    }

    get playing() {
        return this.queue.length > 0;
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
}
