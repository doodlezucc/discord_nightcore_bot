import { youtube, youtube_v3 } from '@googleapis/youtube';

import config from "../config.json" assert { type: "json" };
const {
    googleApiKey
} = config;

const yt = youtube({
    version: "v3",
    auth: googleApiKey
});

/**
 * @param {string} query
 * @returns {Promise<youtube_v3.Schema$Video[]>}
 */
export async function searchOnYoutube(query) {
    const response = await yt.search.list({
        q: query,
        maxResults: 10,
        type: ["video"],
        eventType: "none", // = no livestream
        part: ["snippet", "contentDetails"]
    });
    return response.data.items ?? [];
}

