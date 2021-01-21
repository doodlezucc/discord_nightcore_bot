const Discord = require("discord.js");
const ytdl = require("ytdl-core");
const ytsr = require("ytsr");
const ffmpeg = require("fluent-ffmpeg");
const Stream = require("stream");
const fs = require("fs");

const jobsDir = "jobs/";
if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir);
}

const defaultRate = 1.3;

const {
    prefix,
    token,
} = require("../config.json");

const {
    happy,
    sad,
    party,
    mad,
} = require("./smileys.json");

function smiley(arr, bold) {
    let s = arr[Math.floor(Math.random() * arr.length)];
    if (bold) return "**" + s + "**";
    return s;
}

const client = new Discord.Client();
client.login(token);

client.once("ready", () => {
    console.log("Ready!");

    client.user.setPresence({
        status: "online",
        activity: {
            type: "PLAYING",
            name: prefix
        }
    });
});
client.once("reconnecting", () => {
    console.log("Reconnecting!");
});
client.once("disconnect", () => {
    console.log("Disconnect!");
});

client.on("message", async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    handleMessage(message);
});

class Connection {
    /** @param {Discord.VoiceConnection} vconnect */
    constructor(vconnect) {
        this.vc = vconnect;
        this.changingSong = false;

        /** @type {Discord.StreamDispatcher} */
        this.dispatcher = null;

        this.currentSong = {
            file: "",
            title: "",
            searchQuery: "",
        };
    }
}

/** @type {Map<string, Connection>} */
const connections = new Map();

/** @param {Discord.Message} message */
async function handleMessage(message) {
    const cmd = message.content.substr(prefix.length).trim();
    if (!cmd.length) {
        return message.channel.send(smiley(happy, true));
    }

    const args = cmd.split(" ");
    if (args.length == 1) {
        switch (args[0].toLowerCase()) {
            case "help":
                return respondHelp(message);
            case "save":
                return respondSave(message);
            case "quit":
            case "stop":
            case "leave":
                return respondLeave(message);
        }
    }

    respondPlay(message);
}

/** @param {Discord.Message} message */
async function respondHelp(message) {
    function singleParam(param, description, alias) {
        let s = "        `-";
        if (alias) s += alias + "`/`-";
        return s + param + "` : " + description;
    }

    function randomRange(start, end) {
        return (start + Math.random() * (end - start)).toFixed(1);
    }

    const sender = message.guild.member(message.author).nickname;

    let examples = [
        "-r " + randomRange(0.5, 2.0),
        "-bass " + randomRange(1, 30),
        "-amp " + randomRange(-10, 10),
    ];
    shuffle(examples);
    if (Math.random() <= 0.5) examples.pop();

    message.channel.send([
        "*I can help " + sender + "-chan! " + smiley(happy) + "*",
        ":arrow_forward: **Play some nightcore in your voice channel**: `" + prefix + " [params] <song>`",
        "",
        "    *params* can be any of the following, separated by spaces:",
        singleParam("rate <rate>", "Plays the song at `rate` speed (default is " + defaultRate + "x)", "r"),
        singleParam("bassboost <dB>", "Boosts the bass frequencies by `dB` decibels", "bass"),
        singleParam("amplify <dB>", "Amplifies the song by `dB` decibels", "amp"),
        "",
        "    Example: `" + prefix + " " + examples.join(" ") + " despacito`",
        "",
        ":floppy_disk: **Save the currently playing song**: `" + prefix + " save`",
        "",
        ":wave: **Stop playback**: `" + prefix + " leave/stop/quit`",
    ].join("\n"));
}

/** 
 * Converts the currently playing song to mp3
 * and sends it to the text channel.
 * @param {Discord.Message} message
*/
async function respondSave(message) {
    const connection = connections.get(message.guild.id);
    if (!connection) {
        return message.channel.send("There's nothing playing rn " + smiley(mad));
    }

    const song = connection.currentSong;
    const name = song.searchQuery + "-nightcore.mp3";

    const stream = new Stream.PassThrough();
    ffmpeg(song.file)
        .format("mp3")
        .pipe(stream);

    message.channel.send(new Discord.MessageAttachment(stream, name));
}

/** 
 * Stops playback.
 * @param {Discord.Message} message
*/
async function respondLeave(message) {
    const connection = connections.get(message.guild.id);
    if (!connection) {
        return message.channel.send("wtf I'm not even doing anything");
    }

    connection.dispatcher.end();
    message.channel.send("oh- okay... " + smiley(sad));
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

/** @param {Discord.Message} message */
async function respondPlay(message) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        message.channel.send("join a voice channel first");
        return setTimeout(() => {
            message.channel.send("cunt");
        }, 1000);
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
        return message.channel.send(smiley(sad) + " somebody pls give me permission to join voice channels.");
    }

    const cmd = message.content.substr(prefix.length).trim();
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

            function parse(value) {
                if (i >= args.length) {
                    return message.channel.send(smiley(sad) + " Parameter `" + arg + "` doesn't have a value!");
                }
                let parsed = parseFloat(value);
                if (isNaN(parsed)) {
                    message.channel.send(smiley(sad) + " Couldn't parse `" + arg + " " + argValue + "`!");
                    return null;
                }
                return parsed;
            }

            switch (arg.substr(1)) {
                case "r":
                case "rate":
                    rate = parse(argValue.replace("x", ""));
                    break;
                case "amp":
                case "amplify":
                    amplify = parse(argValue);
                    break;
                case "bass":
                case "bassboost":
                    bassboost = parse(argValue);
                    break;
                default:
                    return message.channel.send(smiley(sad) + " Unknown parameter `" + arg + "`!");
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
        return message.channel.send("B-b-but you forgot the search query... " + smiley(sad));
    }
    //console.log(query, rate, bassboost, amplify);

    const searchMsg = message.channel.send(
        "Searching for `" + query + "`... _kinda weird tbh but I don't judge_"
    );

    try {
        const search = await ytsr(query, {
            limit: 5,
        });
        const video = search.items.find((item) => item.type === "video");

        if (!video) {
            return message.channel.send(
                "**ok wow** I couldn't find any video at all how is that even possible? " + smiley(sad));
        }

        const info = await ytdl.getInfo(video.url);
        let format;
        for (let fmt of info.formats) {
            if (fmt.hasAudio && !fmt.hasVideo) {
                format = fmt;
                break;
            }
        }

        if (!format) {
            message.channel.send(
                "**oh no** there's no audio source for `" + video.title + "` " + smiley(sad));
            return (await searchMsg).delete();
        }

        let connection = connections.get(message.guild.id);
        if (!connection) {
            connection = new Connection(await voiceChannel.join());
            connections.set(message.guild.id, connection);
        } else {
            connection.changingSong = true;
            connection.dispatcher.end();
            if (voiceChannel.id !== connection.vc.channel.id) {
                connection.vc = await voiceChannel.join();
            }
        }

        message.channel.send("Have some nightcorified `" + video.title + "` " + smiley(party, true));

        const sampleRate = format.audioSampleRate;

        let filters = [
            "asetrate=" + sampleRate + "*" + rate,
            "aresample=" + sampleRate,
        ];
        if (bassboost != 0) {
            filters.push("firequalizer=gain_entry='entry(0,0);entry(100," + bassboost + ");entry(150,0)'");
        }
        if (amplify != 0) {
            filters.push("volume=" + amplify);
        }

        const tempFile = jobsDir + video.id + "_" + Date.now();
        connection.currentSong = {
            file: tempFile,
            title: video.title,
            searchQuery: query,
        };

        const ff = ffmpeg()
            .addInput(format.url)
            .audioFilter(filters)
            .format("opus")
            .on("error", (err) => {
                if (!err.message.includes("SIGTERM")) {
                    console.error(err);
                }
            });
        ff.pipe(fs.createWriteStream(tempFile), { end: true });

        await new Promise(done => setTimeout(done, 1000));
        (await searchMsg).delete();

        /** @type {fs.ReadStream} */
        let readStream;

        const dispatcher = connection.vc.play(readStream = fs.createReadStream(tempFile), {
            volume: 0.8,
        })
            .on("finish", () => {
                readStream.destroy();
                ff.kill("SIGTERM");
                fs.unlinkSync(tempFile);

                if (!connection.changingSong) {
                    voiceChannel.leave();
                    connections.delete(message.guild.id);
                    dispatcher.end();
                } else {
                    connection.changingSong = false;
                }
            })
            .on("error", error => console.error(error));
        connection.dispatcher = dispatcher;
    } catch (err) {
        console.error(err);
        connections.delete(message.guild.id);
        return message.channel.send(err);
    }
}