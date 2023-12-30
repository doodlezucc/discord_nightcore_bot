import type { Message } from "discord.js";
import type { PlayCommandParameters } from "./play-command.js";

export type Song = {
    file: string;
    title: string;
    url: string;
    durationInSeconds: number;
    command: PlayCommandParameters;
    infoMessage: Message;
};
