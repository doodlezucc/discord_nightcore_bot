export class NoResultsError extends Error {
    constructor() {
        super("No media sources matched the input query");
        this.name = this.constructor.name;
    }
}
