import * as Discord from "discord.js";
import * as Voice from "@discordjs/voice";
import ffmpeg from "fluent-ffmpeg";
import * as Stream from "stream";
import * as fs from "fs";
import * as traffic from "./traffic.js";
import { InteractiveVideoSearcher } from "./search/media-search-interactive.js";
import { secondsToDuration } from "./duration.js";
import { playSong, rawFormat } from "./player/playback.js";
import {
    smiley,
    smileys,
    markdownEscape,
    happy,
    sad,
    party,
    mad,
} from "./branding.js";

const jobsDir = "jobs/";
if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir);
}

// pitched up by 4 semitones = 1.25992
const defaultRate = Math.pow(Math.pow(2, 1 / 12), 4);

import config from "../config.json";
import { Connection } from "./player/connection.js";
import { ErrorWithEmotion } from "./error-with-emotion.js";
import { Song } from "./player/song.js";
import { Effects } from "./player/effects.js";
import type { PlayCommandParameters } from "./player/play-command.js";
const { prefix, token, color } = config;

const client = new Discord.Client({
    intents: [
        "GuildVoiceStates",
        "GuildMessages",
        "Guilds",
        "GuildMessageReactions",
        "MessageContent",
    ],
});

client.login(token);

client.once("ready", () => {
    console.log("Ready!");

    client.user.setPresence({
        status: "online",
        activities: [
            {
                type: Discord.ActivityType.Playing,
                name: prefix + " help",
            },
        ],
    });
});
client.on("reconnecting", () => {
    console.log("Reconnecting!");
});
client.on("disconnect", () => {
    console.log("Disconnect!");
});
client.on("voiceStateUpdate", (_, state) => {
    if (!state.channel && client.user.id === state.member.id) {
        connections.get(state.guild.id)?.onLeave();
    }
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith(prefix)) return;

    handleMessage(message);
});

export const connections = new Map<string, Connection>();

async function handleMessage(message: Discord.Message) {
    const cmd = message.content.substring(prefix.length).trim();
    if (!cmd.length) {
        return message.channel.send(smiley(happy, true));
    }

    const args = cmd.split(" ");
    if (args.length == 1) {
        switch (args[0].toLowerCase()) {
            case "help":
                return respondHelp(message);
            case "skip":
                return respondSkip(message);
            case "stop":
            case "ouch":
                return respondStop(message);
            case "leave":
                return respondStop(message, true);
            case "save":
                return respondSave(message);
        }
    } else if (args.length == 2 && args[0] === "debug") {
        switch (args[1]) {
            case "smileys":
                return respondDebugSmileys(message);
            case "traffic":
                return respondDebugTraffic(message);
        }
    }

    respondPlay(message);
}

/** @param {Discord.Message} message */
async function respondDebugSmileys(message) {
    let s = "";
    for (let group in smileys) {
        s += "\n\n**" + group + "**:\n";
        s += smileys[group].map((sm) => markdownEscape(sm)).join("\n");
    }
    return message.channel.send(s.trim());
}

/** @param {Discord.Message} message */
async function respondDebugTraffic(message) {
    const read = traffic.getRead();
    const written = traffic.getWritten();

    function toLine(bytes) {
        return bytes + " bytes (" + (bytes / 1000 / 1000).toFixed(1) + "MB)";
    }

    return message.channel.send(
        [
            "**Approximate traffic this month**",
            "Read: " + toLine(read),
            "Written: " + toLine(written),
        ].join("\n"),
    );
}

/** @param {Discord.Message} message */
async function respondHelp(message) {
    function singleParam(aliases, description) {
        return (
            "     •  `" +
            aliases.map((a) => "-" + a).join("`/`") +
            "` : " +
            description
        );
    }

    function randomRange(start, end) {
        return (start + Math.random() * (end - start)).toFixed(1);
    }

    const sender = message.member?.nickname ?? message.author.username;

    let examples = [
        "-r " + randomRange(0.5, 2.0),
        "-bass " + randomRange(1, 30),
        "-amp " + randomRange(-10, 10),
    ];
    shuffle(examples);
    if (Math.random() <= 0.5) examples.pop();

    message.channel.send(
        [
            "*I can help " + sender + "-chan! " + smiley(happy) + "*",
            ":musical_note: **Play some nightcore in your voice channel**: `" +
                prefix +
                " [params] <song>`",
            "",
            "    *params* can be any combination of the following, separated by spaces:",
            singleParam(
                ["r", "rate", "speed <rate>"],
                "Plays the song at `rate` speed (default is " +
                    defaultRate.toFixed(2) +
                    "x)",
            ),
            singleParam(
                ["b", "bass", "bassboost <dB>"],
                "Boosts the bass frequencies by `dB` decibels",
            ),
            singleParam(
                ["amp", "amplify", "volume <dB>"],
                "Amplifies the song by `dB` decibels",
            ),
            "",
            "    Example: `" +
                prefix +
                " " +
                examples.join(" ") +
                " despacito`",
            "",
            ":next_track: **Skip the current song**: `" + prefix + " skip`",
            "",
            ":wave: **Stop playback**: `" + prefix + " stop/ouch/leave`",
            "",
            ":floppy_disk: **Save the currently playing song**: `" +
                prefix +
                " save`",
        ].join("\n"),
    );
}

/**
 * Converts the currently playing song to mp3
 * and sends it to the text channel.
 * @param {Discord.Message} message
 */
async function respondSave(message) {
    const connection = connections.get(message.guild.id);
    if (!connection || !connection.queue.length) {
        return message.channel.send(
            "There's nothing playing rn, dingus " + smiley(mad),
        );
    }

    const song = connection.queue[0];
    const name = song.searchQuery + "-nightcore.mp3";

    await song.writtenToDisk;

    // If this isn't awaited, not the entire stream is sent.
    await message.channel.send("Converting to MP3!");

    const stream = new Stream.PassThrough();
    stream.on("data", traffic.onWrite);
    ffmpeg(song.file)
        .inputFormat(rawFormat)
        .addInputOption("-ar " + song.format.audioSampleRate)
        .addInputOption("-channels " + song.format.audioChannels)
        .outputFormat("mp3")
        .pipe(stream);

    message.channel.send({
        files: [
            {
                name: name,
                attachment: stream,
            },
        ],
    });
}

async function respondStop(message: Discord.Message, leaveInstantly: boolean) {
    const connection = connections.get(message.guild!.id);

    const canAct = connection && (leaveInstantly || connection.playing);
    if (!canAct) {
        return message.channel.send("wtf I'm not even doing anything");
    }

    await message.channel.send("oh- okay... " + smiley(sad));

    if (leaveInstantly) connection.leave();
}

async function respondSkip(message: Discord.Message) {
    const connection = connections.get(message.guild!.id);
    if (!connection || !connection.queue.length) {
        return message.channel.send("afaik there's nothing playing right now.");
    }

    message.channel.send("Skipping! " + smiley(happy, true));
    connection.skip();
}

/**
 * Shuffles array in place. ES6 version
 */
function shuffle<T>(a: Array<T>) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function onPlayError(
    search: string,
    textChannel: Discord.TextBasedChannel,
    err: any,
) {
    console.error('Error executing "' + search + '":\n' + (err.stack || err));
    let trim = err + "";
    if (trim.length > 1000) {
        trim = "..." + trim.substring(trim.length - 1000);
    }
    textChannel?.send(
        "uhm so I don't know how to tell you but apparently " +
            "there was some sort of error " +
            smiley(sad) +
            "\n```" +
            trim +
            "```",
    );
}

function parseArgument(
    arg: string,
    argValue: string,
    min: number,
    max: number,
) {
    const valueAsNumber = parseFloat(argValue);
    if (isNaN(valueAsNumber)) {
        throw new ErrorWithEmotion(
            sad,
            `Couldn't parse \`${arg} ${argValue}\`!`,
        );
    }
    if (valueAsNumber < min || valueAsNumber > max) {
        throw new ErrorWithEmotion(
            sad,
            `Parameter \`${arg} ${argValue}\` is not in range [${min} to ${max}]!`,
        );
    }
    return valueAsNumber;
}

function refineQuery(query: string) {
    query = query.trim();
    if (!query.length) {
        throw new Error(
            "B-b-but you forgot the search query... " + smiley(sad),
        );
    }

    if (query.startsWith("https://")) {
        if (query.includes("&")) {
            return query.substring(0, query.indexOf("&"));
        }
    }

    return query;
}

function parsePlayCommand(args: string[]): PlayCommandParameters {
    let rate = defaultRate;
    let bassboost = 0;
    let amplify = 0;
    let query = "";

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("-") && arg.length > 1) {
            i++;
            const argValue = args[i];

            if (i >= args.length) {
                throw new ErrorWithEmotion(
                    sad,
                    `Parameter \`${arg}\` doesn't have a value!`,
                );
            }

            switch (arg.substring(1).toLowerCase()) {
                case "r":
                case "rate":
                case "speed":
                    rate = parseArgument(arg, argValue, 0.5, 16);
                    break;
                case "amp":
                case "amplify":
                case "volume":
                    amplify = parseArgument(arg, argValue, -20, 60);
                    break;
                case "b":
                case "bass":
                case "bassboost":
                    bassboost = parseArgument(arg, argValue, 0, 60);
                    break;
                default:
                    throw new ErrorWithEmotion(
                        sad,
                        `Unknown parameter \`${arg}\``,
                    );
            }
        } else {
            query += arg + " ";
        }
    }

    return {
        query: refineQuery(query),
        rate: rate,
        amplify: amplify,
        bassboost: bassboost,
    };
}

function handleNoVoiceChannel(
    dispatchingTextChannel: Discord.TextBasedChannel,
) {
    dispatchingTextChannel.send("join a voice channel first");
    setTimeout(() => {
        dispatchingTextChannel.send("twat");
    }, 1000);
}

function requireSpeakingPermissions(voiceChannel: Discord.VoiceBasedChannel) {
    const permissions = voiceChannel.permissionsFor(voiceChannel.client.user);
    if (
        !permissions ||
        !permissions.has("Connect") ||
        !permissions.has("Speak")
    ) {
        throw new ErrorWithEmotion(
            sad,
            "somebody pls give me permission to join voice channels.",
        );
    }
}

function establishVoiceConnection(voiceChannel: Discord.VoiceBasedChannel) {
    return Voice.joinVoiceChannel({
        selfMute: false,
        selfDeaf: false,
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
}

async function respondPlay(message: Discord.Message) {
    const voiceChannel = message.member!.voice.channel;
    if (!voiceChannel) {
        return handleNoVoiceChannel(message.channel);
    }

    requireSpeakingPermissions(voiceChannel);

    let doSkip = false;
    let cmd = message.content.substring(prefix.length).trim();
    if (cmd.startsWith("skip ")) {
        doSkip = true;
        cmd = cmd.substring(5);
    }

    const args = cmd.split(" ");
    const command = parsePlayCommand(args);

    const searchMsg = message.channel.send(
        "Searching for `" +
            command.query +
            "`... _kinda weird tbh but I don't judge_",
    );

    try {
        const searcher = new InteractiveVideoSearcher(message);
        const video = await searcher.findVideo(command.query);

        let playMsg = "Playing right now!";

        const guildId = message.guild!.id;

        // Join voice channel
        let connection = connections.get(guildId);
        let songLength = connection?.queue?.length ?? 0;
        if (!connection) {
            const voiceConnection = establishVoiceConnection(voiceChannel);

            connection = new Connection(voiceConnection);
            connections.set(guildId, connection);
        } else {
            if (voiceChannel.id !== connection.vc.joinConfig.channelId) {
                connection.vc = establishVoiceConnection(voiceChannel);
            }

            if (songLength && doSkip) {
                connection.skip();
                songLength--;
            }

            if (songLength) {
                playMsg =
                    "Playing after " +
                    (songLength >= 2 ? songLength + " songs!" : "1 song!");
            }
        }

        const duration = video.durationInSeconds / rate;
        let msg =
            "**" +
            playMsg +
            " " +
            smiley(party) +
            "**" +
            "\nDuration: `" +
            secondsToDuration(duration) +
            "`";

        if (songLength) {
            let secondsUntil = connection.queue.reduce(
                (seconds, song) => seconds + song.duration,
                0,
            );
            secondsUntil -= (Date.now() - connection.songStartTimestamp) / 1000;
            msg += " / Playing in: `" + secondsToDuration(secondsUntil) + "`";
        }

        const sent = await message.channel.send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(color as Discord.ColorResolvable)
                    .setTitle(
                        video.title.replace(/(\[|\()(.*?)(\]|\))/g, "").trim(),
                    ) // Remove parenthese stuff
                    .setURL(video.url)
                    .setThumbnail(video.thumbnail)
                    .setDescription(msg),
            ],
        });

        const tempFile = jobsDir + video.id + "_" + Date.now();
        connection.addToQueue(
            new Song(
                tempFile,
                video.title,
                video.url,
                duration,
                query,
                new Effects(rate, amplify, bassboost),
                sent,
                video.format,
            ),
        );
    } catch (err) {
        onPlayError(message.content, message.channel, err);
    } finally {
        await new Promise((done) => setTimeout(done, 1000));
        (await searchMsg).delete();
    }
}
