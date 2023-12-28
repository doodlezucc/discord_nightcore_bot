import smileysJ from "./smileys.json" assert { type: "json" };
export const { happy, sad, party, mad, nervous } = smileysJ;

export const smileys = smileysJ;

export const reactions = {
    nowPlaying: "🎵",
};

export function markdownEscape(s) {
    // https://stackoverflow.com/a/56567342
    return s.replace(/((\_|\*|\~|\`|\|)+)/g, "\\$1");
}

export function smiley(arr, bold) {
    let s = arr[Math.floor(Math.random() * arr.length)];
    s = markdownEscape(s);
    if (bold) return "**" + s + "**";
    return s;
}
