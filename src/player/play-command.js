import { Effects } from "./effects";

export class PlayCommandParameters {
    constructor() {
        this.query = "";
        this.effects = new Effects();
    }
}
