import { smiley } from "./branding";

export class ErrorWithEmotion extends Error {
    /**
     * @param {string[]} emotion
     * @param {string} message
     */
    constructor(emotion, message) {
        super(message);
        this.emotion = emotion;
        this.name = this.constructor.name;
    }

    get userMessage() {
        return `${smiley(this.emotion)} ${this.message}`;
    }
}
