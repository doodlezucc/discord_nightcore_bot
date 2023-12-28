import * as Discord from "discord.js";
import * as Voice from "@discordjs/voice";
import ffmpeg from "fluent-ffmpeg";
import * as Stream from "stream";
import * as fs from "fs";
import * as traffic from "./traffic.js";
import { MockFormat, findVideo } from "./videosearch.js";
import { secondsToDuration } from "./duration.js";
import { playSong, rawFormat } from "./playback.js";
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

import config from "../config.json" assert { type: "json" };
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

class Effects {
    constructor(rate, amplify, bassboost) {
        this.rate = rate;
        this.amplify = amplify;
        this.bassboost = bassboost;
    }
}

class Song {
    /**
     * @param {string} file
     * @param {string} title
     * @param {string} url
     * @param {number} duration Song duration in seconds.
     * @param {string} searchQuery
     * @param {Effects} effects
     * @param {Discord.Message} message
     * @param {MockFormat} format
     * @param {Promise} writtenToDisk
     */
    constructor(
        file,
        title,
        url,
        duration,
        searchQuery,
        effects,
        message,
        format,
        writtenToDisk,
    ) {
        this.file = file;
        this.title = title;
        this.url = url;
        this.duration = duration;
        this.searchQuery = searchQuery;
        this.effects = effects;
        this.message = message;
        this.format = format;
        this.writtenToDisk = writtenToDisk;
    }
}

class Connection {
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

/** @type {Map<string, Connection>} */
const connections = new Map();

/** @param {Discord.Message} message */
async function handleMessage(message) {
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

/**
 * Stops playback.
 * @param {Discord.Message} message
 */
async function respondStop(message, leave) {
    const connection = connections.get(message.guild.id);
    if (!connection || (!connection.queue.length && !leave)) {
        return message.channel.send("wtf I'm not even doing anything");
    }

    connection.queue = [];
    connection.player.stop();

    await message.channel.send("oh- okay... " + smiley(sad));

    if (leave) connection.vc.disconnect();
}

/**
 * Skips the current song.
 * @param {Discord.Message} message
 */
async function respondSkip(message) {
    const connection = connections.get(message.guild.id);
    if (!connection || !connection.queue.length) {
        return message.channel.send("afaik there's nothing playing right now.");
    }

    message.channel.send("Skipping! " + smiley(happy, true));
    connection.skip();
}

/**
 * Shuffles array in place. ES6 version
 * @param {Array} a items An array containing the items.
 */
function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** @param {Discord.TextChannel} textChannel */
export function onPlayError(search, textChannel, err) {
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

/** @param {Discord.Message} message */
async function respondPlay(message) {
    /** @type {Discord.VoiceChannel} */
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        message.channel.send("join a voice channel first");
        return setTimeout(() => {
            message.channel.send("twat");
        }, 1000);
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("Connect") || !permissions.has("Speak")) {
        return message.channel.send(
            smiley(sad) +
                " somebody pls give me permission to join voice channels.",
        );
    }

    let doSkip = false;
    let cmd = message.content.substr(prefix.length).trim();
    if (cmd.startsWith("skip ")) {
        doSkip = true;
        cmd = cmd.substr(5);
    }
    const args = cmd.split(" ");

    let rate = defaultRate;
    let bassboost = 0;
    let amplify = 0;
    let query = "";

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("-") && arg.length > 1) {
            i++;
            const argValue = args[i];

            function parse(value, min, max) {
                if (i >= args.length) {
                    return message.channel.send(
                        smiley(sad) +
                            " Parameter `" +
                            arg +
                            "` doesn't have a value!",
                    );
                }
                let parsed = parseFloat(value);
                if (isNaN(parsed)) {
                    message.channel.send(
                        smiley(sad) +
                            " Couldn't parse `" +
                            arg +
                            " " +
                            argValue +
                            "`!",
                    );
                    return null;
                }
                if (parsed < min || parsed > max) {
                    message.channel.send(
                        smiley(sad) +
                            " Parameter `" +
                            arg +
                            " " +
                            argValue +
                            "` is not in range [" +
                            min +
                            " to " +
                            max +
                            "]!",
                    );
                    return null;
                }
                return parsed;
            }

            switch (arg.substring(1).toLowerCase()) {
                case "r":
                case "rate":
                case "speed":
                    rate = parse(argValue, 0.5, 16);
                    break;
                case "amp":
                case "amplify":
                case "volume":
                    amplify = parse(argValue, -20, 60);
                    break;
                case "b":
                case "bass":
                case "bassboost":
                    bassboost = parse(argValue, 0, 60);
                    break;
                default:
                    return message.channel.send(
                        smiley(sad) + " Unknown parameter `" + arg + "`!",
                    );
            }
        } else {
            query += arg + " ";
        }
    }

    if (rate == null || amplify == null || bassboost == null) {
        return;
    }

    query = query.trim();
    if (!query.length) {
        return message.channel.send(
            "B-b-but you forgot the search query... " + smiley(sad),
        );
    }

    if (query.startsWith("https://")) {
        if (query.includes("&")) {
            query = query.substring(0, query.indexOf("&"));
        }
    }

    const searchMsg = message.channel.send(
        "Searching for `" + query + "`... _kinda weird tbh but I don't judge_",
    );

    try {
        const video = await findVideo(query, message);

        if (!video) return;

        let playMsg = "Playing right now!";

        // Join voice channel
        let connection = connections.get(message.guild.id);
        let songLength = connection?.queue?.length ?? 0;
        if (!connection) {
            const voiceConnection = Voice.joinVoiceChannel({
                selfMute: false,
                selfDeaf: false,
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            connection = new Connection(voiceConnection, message.channel);
            connections.set(message.guild.id, connection);
        } else {
            if (voiceChannel.id !== connection.vc.joinConfig.channelId) {
                connection.vc = await voiceChannel.join();
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
                    .setColor(color)
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
