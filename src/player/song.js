export class Song {
    /**
     * @param {string} file
     * @param {string} title
     * @param {string} url
     * @param {number} duration Song duration in seconds.
     * @param {string} searchQuery
     * @param {Effects} effects
     * @param {Discord.Message} message
     * @param {MockFormat} format
     * @param {Promise} writtenToDisk
     */
    constructor(
        file,
        title,
        url,
        duration,
        searchQuery,
        effects,
        message,
        format,
        writtenToDisk,
    ) {
        this.file = file;
        this.title = title;
        this.url = url;
        this.duration = duration;
        this.searchQuery = searchQuery;
        this.effects = effects;
        this.message = message;
        this.format = format;
        this.writtenToDisk = writtenToDisk;
    }
}
