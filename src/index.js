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
client.once("reconnecting", () => {
    console.log("Reconnecting!");
});
client.once("disconnect", () => {
    console.log("Disconnect!");
});

client.on("message", async message => {
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
     * @param {string} searchQuery
     * @param {Effects} effects
     */
    constructor(file, title, url, searchQuery, effects) {
        this.file = file;
        this.title = title;
        this.url = url;
        this.searchQuery = searchQuery;
        this.effects = effects;
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
        this.changingSong = false;

        /** @type {Discord.StreamDispatcher} */
        this.dispatcher = null;

        /** @type {Song[]} */
        this.queue = [];
    }

    addToQueue(song) {
        this.queue.push(song);
        if (this.queue.length == 1) {
            playSong(this);
        }
    }

    onSongEnd() {
        this.queue.shift();
        if (this.queue.length) {
            playSong(this);
        }
    }

    skip() {
        this.changingSong = true;
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
            case "save":
                return respondSave(message);
            case "leave":
            case "quit":
            case "stop":
            case "ouch":
                return respondLeave(message);
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
        "Read: " + toLine(read),
        "Written: " + toLine(written),
    ].join("\n"));
}

/** @param {Discord.Message} message */
async function respondHelp(message) {
    function singleParam(aliases, description) {
        return s = "        `"
            + aliases.map((a) => "-" + a).join("`/`")
            + "` : " + description;
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
        ":musical_note: **Play some nightcore in your voice channel**: `" + prefix + " [params] <song>`",
        "",
        "    *params* can be any of the following, separated by spaces:",
        singleParam(["r", "rate", "speed <rate>"], "Plays the song at `rate` speed (default is " + defaultRate + "x)"),
        singleParam(["b", "bass", "bassboost <dB>"], "Boosts the bass frequencies by `dB` decibels"),
        singleParam(["amp", "amplify", "volume <dB>"], "Amplifies the song by `dB` decibels"),
        "",
        "    Example: `" + prefix + " " + examples.join(" ") + " despacito`",
        "",
        ":floppy_disk: **Save the currently playing song**: `" + prefix + " save`",
        "",
        ":wave: **Stop playback**: `" + prefix + " leave/stop/quit/ouch`",
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
        return message.channel.send("There's nothing playing rn, dingus " + smiley(mad));
    }

    const song = connection.currentSong;
    const name = song.searchQuery + "-nightcore.mp3";

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

function isUnderThreeHours(durationString) {
    return !(/([1-9][0-9]|[3-9]):.*:/).test(durationString);
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

    if (query.startsWith("https://") && query.includes("&")) {
        query = query.substr(0, query.indexOf("&"));
    }

    //console.log(query, rate, bassboost, amplify);

    const searchMsg = message.channel.send(
        "Searching for `" + query + "`... _kinda weird tbh but I don't judge_"
    );

    function onPlayError(err) {
        console.log('Error executing "' + message.content + '":');
        console.error(err);
    }

    try {
        const search = await ytsr(query, {
            limit: 5,
        });

        let tooLong = false;
        const video = search.items.find((item) => {
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
        if (!connection) {
            connection = new Connection(await voiceChannel.join());
            connections.set(message.guild.id, connection);
        } else {
            if (voiceChannel.id !== connection.vc.channel.id) {
                connection.vc = await voiceChannel.join();
            }

            if (connection.queue.length) {
                playMsg = "Playing after "
                    + (connection.queue.length >= 2
                        ? (connection.queue.length + " songs!")
                        : "this song!");
            }
        }

        message.channel.send(new Discord.MessageEmbed()
            .setColor("#51cdd7")
            .setTitle(video.title.replace(/(\[|\()(.*?)(\]|\))/g, "").trim()) // Remove parenthese stuff
            .setURL(video.url)
            .setThumbnail(video.bestThumbnail.url)
            .setDescription("**" + playMsg + " " + smiley(party) + "**"));

        const tempFile = jobsDir + video.id + "_" + Date.now();
        connection.addToQueue(new Song(
            tempFile,
            video.title,
            video.url,
            query,
            new Effects(rate, amplify, bassboost),
        ));

        await new Promise(done => setTimeout(done, 1000));
        (await searchMsg).delete();
    } catch (err) {
        onPlayError(err);
        connections.delete(message.guild.id);
        message.channel.send(
            "**oh god oh no** " + smiley(nervous) + " uhm so I don't know how to tell you but "
            + "there was some sort of error " + smiley(nervous)
        );
    }
}

/** @param {Connection} connection */
async function playSong(connection) {
    const song = connection.queue[0];

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
        filters.push("firequalizer=gain_entry='entry(0,0);entry(100," + bassboost + ");entry(350,0)'");
    }
    if (song.effects.amplify != 0) {
        filters.push("volume=" + amplify + "dB");
    }

    const ff = ffmpeg()
        .addInput(format.url)
        .audioFilter(filters)
        .format("opus")
        .on("error", (err) => {
            if (!(err.message.includes("SIGTERM") || err.message.includes("signal 15"))) {
                onPlayError(err);
            }
        });
    ff.pipe(fs.createWriteStream(song.file), { end: true });

    // Register audio download as traffic
    traffic.onRead(parseInt(format.contentLength));

    // Give the server a head start on writing the nightcorified file.
    // If this timeout is set too low, an end of stream occurs.
    await new Promise(done => setTimeout(done, 1500));

    const readStream = fs.createReadStream(song.file);
    readStream.on("data", traffic.onWrite);

    const dispatcher = connection.vc.play(readStream, {
        volume: 0.8,
    })
        .on("finish", () => {
            readStream.destroy();
            ff.kill("SIGTERM");
            fs.unlinkSync(song.file);

            connection.onSongEnd();
        })
        .on("error", error => console.error(error));
    connection.dispatcher = dispatcher;
}
