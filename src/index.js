const Discord = require("discord.js");
const ytdl = require("ytdl-core");
const ytsr = require("ytsr");
const ffmpeg = require("fluent-ffmpeg");
const Stream = require("stream");
const fs = require("fs");
const traffic = require("./traffic");

const jobsDir = "jobs/";
if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir);
}

const defaultRate = 1.3;

const {
    prefix,
    token,
} = require("../config.json");

const smileys = require("./smileys.json");
const {
    happy,
    sad,
    party,
    mad,
    nervous,
} = smileys;

function markdownEscape(s) {
    // https://stackoverflow.com/a/56567342
    return s.replace(/((\_|\*|\~|\`|\|)+)/g, "\\$1");
}

function smiley(arr, bold) {
    let s = arr[Math.floor(Math.random() * arr.length)];
    s = markdownEscape(s);
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
            name: prefix + " help"
        }
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

client.on("message", async message => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith(prefix)) return;

    handleMessage(message);
});

const reactions = {
    nowPlaying: "🎵"
};

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
     */
    constructor(file, title, url, duration, searchQuery, effects, message) {
        this.file = file;
        this.title = title;
        this.url = url;
        this.duration = duration;
        this.searchQuery = searchQuery;
        this.effects = effects;
        this.message = message;
    }
}

class Connection {
    /**
     * @param {Discord.VoiceConnection} vconnect
     * @param {Discord.TextChannel} textChannel
     * */
    constructor(vconnect, textChannel) {
        this.vc = vconnect;
        this.textChannel = textChannel;

        /** @type {Discord.StreamDispatcher} */
        this.dispatcher = null;

        /** @type {Song[]} */
        this.queue = [];

        /** @type {number} */
        this.songStartTimestamp = 0;

        this.timeout = null;
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
            this.timeout = setTimeout(() => {
                this.onLeave();
            }, (3 * 60 + 32) * 1000);
        }
    }

    onLeave() {
        this.dispatcher.end();
        this.vc.disconnect();
        connections.delete(this.textChannel.guild.id);
    }

    skip() {
        this.dispatcher.end();
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
        return bytes + " bytes (" + (bytes / 1024 / 1024).toFixed(1) + "MB)";
    }

    return message.channel.send([
        "**Approximate traffic this month**",
        "Read: " + toLine(read),
        "Written: " + toLine(written),
    ].join("\n"));
}

/** @param {Discord.Message} message */
async function respondHelp(message) {
    function singleParam(aliases, description) {
        return s = "     •  `"
            + aliases.map((a) => "-" + a).join("`/`")
            + "` : " + description;
    }

    function randomRange(start, end) {
        return (start + Math.random() * (end - start)).toFixed(1);
    }

    const sender = message.guild.member(message.author).nickname ?? message.author.username;

    let examples = [
        "-r " + randomRange(0.5, 2.0),
        "-bass " + randomRange(1, 30),
        "-amp " + randomRange(-10, 10),
    ];
    shuffle(examples);
    if (Math.random() <= 0.5) examples.pop();

    message.channel.send([
        "*I can help " + sender + "-chan! " + smiley(happy) + "*",
        ":musical_note: **Play some nightcore in your voice channel**: `" + prefix + " [params] <song>`",
        "",
        "    *params* can be any combination of the following, separated by spaces:",
        singleParam(["r", "rate", "speed <rate>"], "Plays the song at `rate` speed (default is " + defaultRate + "x)"),
        singleParam(["b", "bass", "bassboost <dB>"], "Boosts the bass frequencies by `dB` decibels"),
        singleParam(["amp", "amplify", "volume <dB>"], "Amplifies the song by `dB` decibels"),
        "",
        "    Example: `" + prefix + " " + examples.join(" ") + " despacito`",
        "",
        ":next_track: **Skip the current song**: `" + prefix + " skip`",
        "",
        ":wave: **Stop playback**: `" + prefix + " stop/ouch/leave`",
        "",
        ":floppy_disk: **Save the currently playing song**: `" + prefix + " save`",
    ].join("\n"));
}

/** 
 * Converts the currently playing song to mp3
 * and sends it to the text channel.
 * @param {Discord.Message} message
*/
async function respondSave(message) {
    const connection = connections.get(message.guild.id);
    if (!connection || !connection.queue.length) {
        return message.channel.send("There's nothing playing rn, dingus " + smiley(mad));
    }

    const song = connection.queue[0];
    const name = song.searchQuery + "-nightcore.mp3";

    // If this isn't awaited, not the entire stream is sent.
    await message.channel.send("Converting to MP3!");

    const stream = new Stream.PassThrough();
    stream.on("data", traffic.onWrite);
    ffmpeg(song.file)
        .format("mp3")
        .pipe(stream);

    message.channel.send(new Discord.MessageAttachment(stream, name));
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

    if (leave) connection.vc.disconnect();

    connection.queue = [];
    connection.dispatcher.end();

    message.channel.send("oh- okay... " + smiley(sad));
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
function onPlayError(search, textChannel, err) {
    console.log('Error executing "' + search + '":');
    console.error(err);
    textChannel?.send(
        "**oh god oh no** " + smiley(nervous) + " uhm so I don't know how to tell you but "
        + "there was some sort of error " + smiley(sad)
    );
}

function isUnderThreeHours(durationString) {
    return !(/([1-9][0-9]|[3-9]):.*:/).test(durationString);
}

/** @param {Discord.Message} message */
async function respondPlay(message) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        message.channel.send("join a voice channel first");
        return setTimeout(() => {
            message.channel.send("twat");
        }, 1000);
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
        return message.channel.send(smiley(sad) + " somebody pls give me permission to join voice channels.");
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
                    return message.channel.send(smiley(sad) + " Parameter `" + arg + "` doesn't have a value!");
                }
                let parsed = parseFloat(value);
                if (isNaN(parsed)) {
                    message.channel.send(smiley(sad) + " Couldn't parse `" + arg + " " + argValue + "`!");
                    return null;
                }
                if (parsed < min || parsed > max) {
                    message.channel.send(smiley(sad)
                        + " Parameter `" + arg + " " + argValue
                        + "` is not in range [" + min + " to " + max + "]!"
                    );
                    return null;
                }
                return parsed;
            }

            switch (arg.substr(1).toLowerCase()) {
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

    if (query.startsWith("https://")) {
        if (query.includes("&")) {
            query = query.substr(0, query.indexOf("&"));
        }
        if (query.includes("?v=")) {
            query = query.substr(query.indexOf("?v=") + 3);
        } else if (query.includes("youtu.be/")) {
            query = query.substr(query.lastIndexOf("/"));
        } else {
            // TODO: handle URLs outside youtube
        }
    }

    //console.log(query, rate, bassboost, amplify);

    const searchMsg = message.channel.send(
        "Searching for `" + query + "`... _kinda weird tbh but I don't judge_"
    );

    try {
        const search = await ytsr(query, {
            limit: 10,
        });

        let tooLong = false;
        const video = search.items.find((item) => {
            if (item.isLive) return false;

            const isGoodDuration = isUnderThreeHours(item.duration);
            if (!isGoodDuration) tooLong = true;
            return item.type === "video" && isGoodDuration;
        });

        if (!video) {
            if (tooLong) {
                message.channel.send("**holy frick...** it's so long " + smiley(nervous, true));
                return setTimeout(() => {
                    message.channel.send("I- I don't think I can fit this in my storage, sowwy " + smiley(sad));
                }, 1000);
            }
            return message.channel.send(
                "**ok wow** I couldn't find any video at all how is that even possible? " + smiley(sad));
        }

        let playMsg = "Playing right now!";

        // Join voice channel
        let connection = connections.get(message.guild.id);
        let songLength = connection?.queue?.length ?? 0;
        if (!connection) {
            connection = new Connection(await voiceChannel.join(), message.channel);
            connections.set(message.guild.id, connection);
        } else {
            if (voiceChannel.id !== connection.vc.channel.id) {
                connection.vc = await voiceChannel.join();
            }

            if (songLength && doSkip) {
                connection.skip();
                songLength--;
            }

            if (songLength) {
                playMsg = "Playing after "
                    + (songLength >= 2
                        ? (songLength + " songs!")
                        : "1 song!");
            }
        }

        const duration = durationToSeconds(video.duration) / rate;
        let msg = "**" + playMsg + " " + smiley(party) + "**"
            + "\nDuration: `" + secondsToDuration(duration) + "`";

        if (songLength) {
            let secondsUntil = connection.queue.reduce((seconds, song) => seconds + song.duration, 0);
            secondsUntil -= (Date.now() - connection.songStartTimestamp) / 1000;
            msg += " / Playing in: `" + secondsToDuration(secondsUntil) + "`";
        }

        const sent = await message.channel.send(new Discord.MessageEmbed()
            .setColor("#51cdd7")
            .setTitle(video.title.replace(/(\[|\()(.*?)(\]|\))/g, "").trim()) // Remove parenthese stuff
            .setURL(video.url)
            .setThumbnail(video.bestThumbnail.url)
            .setDescription(msg));

        const tempFile = jobsDir + video.id + "_" + Date.now();
        connection.addToQueue(new Song(
            tempFile,
            video.title,
            video.url,
            duration,
            query,
            new Effects(rate, amplify, bassboost),
            sent,
        ));

        await new Promise(done => setTimeout(done, 1000));
        (await searchMsg).delete();
    } catch (err) {
        onPlayError(message.content, message.channel, err);
    }
}

/** @param {String} d */
function durationToSeconds(d) {
    const parts = d.split(":").reverse();
    let sec = parseInt(parts[0]);
    if (parts.length >= 2) {
        sec += 60 * parts[1];
        if (parts.length >= 3) sec += 60 * 60 * parts[2];
    }
    return sec;
}

/** @param {number} sec */
function secondsToDuration(sec) {
    sec = Math.floor(sec);
    const secMod = sec % 60;
    const min = Math.floor(sec / 60) % 60;
    let out = ":" + secMod.toString().padStart(2, "0");
    if (sec >= 60 * 60) {
        const hours = Math.floor(sec / 60 / 60);
        out = hours + ":" + min.toString().padStart(2, "0") + out;
    } else {
        out = min + out;
    }
    return out;
}

/** @param {Connection} connection */
async function playSong(connection) {
    const song = connection.queue[0];
    connection.songStartTimestamp = Date.now();

    try {
        const info = await ytdl.getInfo(song.url);
        let format = {
            contentLength: Infinity,
        };
        for (let fmt of info.formats) {
            if (fmt.hasAudio && !fmt.hasVideo) {
                fmt.contentLength = parseInt(fmt.contentLength);
                // Get smallest audio-only file
                if (fmt.contentLength < format.contentLength) {
                    format = fmt;
                }
            }
        }

        if (!format) {
            connection.textChannel.send(
                "**oh no** I can't find a good audio source for `" + video.title + "` " + smiley(sad));
            return connection.skip();
        }

        // Initialize ffmpeg
        const sampleRate = format.audioSampleRate;

        let filters = [
            "asetrate=" + sampleRate + "*" + song.effects.rate,
            "aresample=" + sampleRate,
        ];
        if (song.effects.bassboost != 0) {
            filters.push("firequalizer=gain_entry='entry(0,0);entry(100," + song.effects.bassboost + ");entry(350,0)'");
        }
        if (song.effects.amplify != 0) {
            filters.push("volume=" + song.effects.amplify + "dB");
        }

        const reaction = song.message.react(reactions.nowPlaying);

        const ff = ffmpeg()
            .addInput(format.url)
            .audioFilter(filters)
            .format("opus")
            .on("error", (err) => {
                if (!(err.message.includes("SIGTERM") || err.message.includes("signal 15"))) {
                    onPlayError(song.searchQuery, connection.textChannel, err);
                }
            });
        ff.pipe(fs.createWriteStream(song.file), { end: true });

        // Register audio download as traffic
        // (might count too much if users decide to skip midway through)
        traffic.onRead(parseInt(format.contentLength));

        // Give the server a head start on writing the nightcorified file.
        // If this timeout is set too low, an end of stream occurs.
        await new Promise(done => setTimeout(done, 1500));

        const readStream = fs.createReadStream(song.file);
        readStream.on("data", traffic.onWrite);

        const dispatcher = connection.vc.play(readStream, {
            volume: 0.8,
        })
            .on("finish", async () => {
                readStream.destroy();
                ff.kill("SIGTERM");
                fs.unlinkSync(song.file);

                connection.onSongEnd();
                var r = await reaction;
                if (r && r.message) {
                    r.remove();
                }
            })
            .on("error", error => console.error(error));
        connection.dispatcher = dispatcher;
    } catch (err) {
        onPlayError(song.searchQuery, connection.textChannel, err);
        connection.onSongEnd();
    }
}
