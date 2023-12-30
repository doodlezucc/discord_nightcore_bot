import { nervous, sad, smiley } from "../branding.js";
import { MediaTooLongError } from "./errors/media-too-long-error.js";
import { NoResultsError } from "./errors/no-results-error.js";
import { GenericSearcher } from "./media-search.js";

import Discord from "discord.js";

export class InteractiveVideoSearcher extends GenericSearcher {
    private readonly dispatchMessage: Discord.Message;

    constructor(dispatchMessage: Discord.Message) {
        super();
        this.dispatchMessage = dispatchMessage;
    }

    protected async findVideoFromLink(url: string) {
        if (!(url.includes("youtu.be/") || url.includes("youtube.com/"))) {
            setTimeout(() => {
                this.dispatchMessage.channel.send(
                    "cringe bro that ain't even a youtube link but whatever I'll try my best",
                );
            }, 500);
        }

        return super.findVideoFromLink(url);
    }

    async findVideo(query: string) {
        try {
            return super.findVideo(query);
        } catch (err) {
            const channel = this.dispatchMessage.channel;

            if (err instanceof MediaTooLongError) {
                await this.handleTooLong(channel);
            } else if (err instanceof NoResultsError) {
                await this.handleNoResults(channel);
            }

            throw err;
        }
    }

    private async handleTooLong(channel: Discord.TextBasedChannel) {
        channel.send("**holy frick...** it's so long " + smiley(nervous, true));

        await new Promise((res) => setTimeout(res, 1000));

        channel.send(
            "I- I don't think I can fit this in my storage, sowwy " +
                smiley(sad),
        );
    }

    private async handleNoResults(channel: Discord.TextBasedChannel) {
        channel.send(
            "**ok wow** I couldn't find any video at all how is that even possible? " +
                smiley(sad),
        );
    }
}
