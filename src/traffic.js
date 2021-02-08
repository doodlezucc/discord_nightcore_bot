const fs = require("fs");

const directory = "./traffic";

function trafficFile() {
    const date = new Date();
    const month = date.getUTCFullYear() + "-" + (date.getUTCMonth() + 1 + "").padStart(2, "0");
    return directory + "/traffic-" + month + ".json";
}

let changed = false;
let traffic = {
    read: 0,
    written: 0,
};

if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
}
if (fs.existsSync(trafficFile())) {
    traffic = JSON.parse(fs.readFileSync(trafficFile(), { encoding: "utf8" }));
}

function onChange() {
    changed = true;
}

exports.onRead = function onRead(chunk) {
    traffic.read += chunk.length ?? chunk;
    onChange();
}
exports.onWrite = function onWrite(chunk) {
    traffic.written += chunk.length ?? chunk;
    onChange();
}
exports.getRead = () => traffic.read;
exports.getWritten = () => traffic.written;

exports.save = function save() {
    fs.writeFileSync(trafficFile(), JSON.stringify(traffic, null, 2));
}

setInterval(() => {
    if (changed) {
        changed = false;
        exports.save();
    }
}, 10000);