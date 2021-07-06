const fs = require("fs");

const directory = "./traffic";

let monthBuffer = -1;

function trafficFile() {
    const now = new Date();
    const month = now.getUTCMonth();

    // Initialize new monthly traffic report
    if (monthBuffer >= 0 && month != monthBuffer) {
        console.log("NEW MONTH");
        traffic.read = 0;
        traffic.written = 0;
    }
    monthBuffer = month;

    const date = now.getUTCFullYear() + "-" + (month + 1 + "").padStart(2, "0");
    return directory + "/traffic-" + date + ".json";
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