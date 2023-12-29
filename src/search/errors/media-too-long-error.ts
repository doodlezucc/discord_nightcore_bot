export class MediaTooLongError extends Error {
    constructor() {
        super("Media is too long");
        this.name = this.constructor.name;
    }
}
