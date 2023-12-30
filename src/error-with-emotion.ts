import { smiley, type Emotion } from "./branding.js";

export class ErrorWithEmotion extends Error {
    readonly emotion: Emotion;

    constructor(emotion: Emotion, message: string) {
        super(message);
        this.emotion = emotion;
        this.name = this.constructor.name;
    }

    get userMessage() {
        return `${smiley(this.emotion)} ${this.message}`;
    }
}
