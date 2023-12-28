import * as iso8601 from "iso8601-duration";

/** @param {String} d */
export function durationToSeconds(d) {
    const parts = d.split(":").reverse();
    let sec = parseInt(parts[0]);
    if (parts.length >= 2) {
        sec += 60 * parts[1];
        if (parts.length >= 3) sec += 60 * 60 * parts[2];
    }
    return sec;
}

/** @param {string} ptString */
export function ptDurationToSeconds(ptString) {
    const pt = iso8601.parse(ptString);
    return pt.seconds + 60 * (pt.minutes + 60 * pt.hours);
}

/** @param {number} sec */
export function secondsToDuration(sec) {
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
