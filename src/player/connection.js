import * as Discord from "discord.js";
import * as Voice from "@discordjs/voice";
import { connections } from "..";
import { playSong } from "../playback";

export class Connection {
    /**
     * @param {Voice.VoiceConnection} vconnect
     * @param {Discord.TextChannel} textChannel
     * */
    constructor(vconnect, textChannel) {
        this.vc = vconnect;
        this.textChannel = textChannel;

        this.player = Voice.createAudioPlayer({
            debug: true,
            behaviors: { maxMissedFrames: 100 },
        });
        this.vc.subscribe(this.player);

        /** @type {Song[]} */
        this.queue = [];

        /** @type {number} */
        this.songStartTimestamp = 0;

        this.timeout = null;
        this.attempts = 0;
    }

    addToQueue(song) {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.queue.push(song);
        if (this.queue.length == 1) {
            playSong(this);
        }
    }

    onSongEnd() {
        if (this.queue.length) this.queue.shift();

        if (this.queue.length) {
            playSong(this);
        } else {
            // A friend wanted this to be exactly 3:32.
            this.timeout = setTimeout(
                () => {
                    this.onLeave();
                },
                (3 * 60 + 32) * 1000,
            );
        }
    }

    onLeave() {
        this.player.stop();
        this.vc.disconnect();
        connections.delete(this.textChannel.guild.id);
    }

    skip() {
        this.player.stop();
    }
}
