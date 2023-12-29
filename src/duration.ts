import * as iso8601 from "iso8601-duration";

export function durationToSeconds(d: string) {
    const parts = d
        .split(":")
        .reverse()
        .map((part) => parseInt(part));

    const seconds = parts[0];
    const minutes = parts[1];
    let hours = 0;

    if (parts.length >= 2) {
        hours = parts[2];
    }

    return (hours * 60 + minutes) * 60 + seconds;
}

export function ptDurationToSeconds(ptString: string) {
    const pt = iso8601.parse(ptString);
    return (pt.hours! * 60 + pt.minutes!) * 60 + pt.seconds!;
}

export function secondsToDuration(durationInSeconds: number) {
    durationInSeconds = Math.floor(durationInSeconds);

    const secondsPadded = padZeroes(durationInSeconds % 60);
    const minutes = Math.floor(durationInSeconds / 60) % 60;

    const hasHours = durationInSeconds >= 60 * 60;
    if (hasHours) {
        const minutesPadded = padZeroes(minutes);
        const hours = Math.floor(durationInSeconds / 60 / 60);

        return `${hours}:${minutesPadded}:${secondsPadded}`;
    }

    return `${minutes}:${secondsPadded}`;
}

function padZeroes(time: number) {
    return time.toString().padStart(2, "0");
}
