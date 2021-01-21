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

const {
    prefix,
    token,
} = require("../config.json");

const client = new Discord.Client();
client.login(token);

client.once("ready", () => {
    console.log("Ready!");
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

const connections = new Map();

class Connection {
    /**
     * @param {Discord.VoiceConnection} vconnect 
     */
    constructor(vconnect) {
        this.vc = vconnect;
        /**
         * @type {Discord.StreamDispatcher}
         */
        this.dispatcher = null;
        this.changingSong = false;
    }
}

/**
 * @param {Discord.Message} message
 */
async function handleMessage(message) {
    const cmd = message.content.substr(prefix.length).trim();

    if (!cmd.length) {
        return message.channel.send("owo");
    }

    const query = cmd;

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        message.channel.send("join a voice channel first");
        setTimeout(() => {
            message.channel.send("cunt");
        }, 1000);
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
        return message.channel.send("somebody pls give me permission to join voice channels.");
    }

    const searchMsg = message.channel.send(
        "Searching for `" + query + "`... _kinda weird tbh but I don't judge_"
    );

    const search = await ytsr(query, {
        limit: 5,
    });
    const video = search.items.find((item) => item.type === "video");

    const info = await ytdl.getInfo(video.url);
    let format;
    for (let fmt of info.formats) {
        if (fmt.hasAudio && !fmt.hasVideo) {
            format = fmt;
            break;
        }
    }

    if (!format) {
        return message.channel.send("oh no there's no audio source for `" + video.title + "`");
    }

    try {
        /**
         * @type {Connection}
         */
        let connection = connections.get(message.guild.id);
        if (!connection) {
            connection = new Connection(await voiceChannel.join());
            connections.set(message.guild.id, connection);
        } else {
            connection.changingSong = true;
            connection.dispatcher.end();
        }

        message.channel.send("Have some nightcorified `" + video.title + "`!");

        const sampleRate = format.audioSampleRate;

        const rate = 1.3;
        let filters = [
            "asetrate=" + sampleRate + "*" + rate,
            "aresample=" + sampleRate,
        ];
        const bassboost = false;
        if (bassboost) {
            filters.push("firequalizer=gain_entry='entry(0,0);entry(100,30);entry(150,0)'");
        }

        const tempFile = jobsDir + video.id + "_" + Date.now();

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

        const dispatcher = connection.vc.play(fs.createReadStream(tempFile), {
            volume: bassboost ? 0.5 : 0.8,
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
