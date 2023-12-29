export class NoAudioSourceError extends Error {
    constructor() {
        super("No audio sources found");
        this.name = this.constructor.name;
    }
}
