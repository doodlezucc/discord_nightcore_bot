import smileysJ from "./smileys.json" assert { type: "json" };
export const { happy, sad, party, mad, nervous } = smileysJ;

export type Emotion = string[];

export const smileys = smileysJ as {
    [group: string]: Emotion;
};

export const reactions = {
    nowPlaying: "🎵",
};

export function markdownEscape(s: string) {
    // https://stackoverflow.com/a/56567342
    return s.replace(/((\_|\*|\~|\`|\|)+)/g, "\\$1");
}

export function smiley(arr: Emotion, bold: boolean = false) {
    let s = arr[Math.floor(Math.random() * arr.length)];
    s = markdownEscape(s);
    if (bold) return "**" + s + "**";
    return s;
}
