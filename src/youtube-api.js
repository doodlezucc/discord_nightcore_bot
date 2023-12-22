import { youtube, youtube_v3 } from "@googleapis/youtube";
import { MockVideo } from "./videosearch.js";

import config from "../config.json" assert { type: "json" };
import { ptDurationToSeconds } from "./duration.js";
const { googleApiKey } = config;

const yt = youtube({
    version: "v3",
    auth: googleApiKey,
});

/**
 * @param {string} query
 * @returns {Promise<youtube_v3.Schema$SearchResult[]>}
 */
async function searchVideoSnippets(query) {
    const response = await yt.search.list({
        q: query,
        maxResults: 10,
        type: ["video"],
        eventType: "none", // = no livestream
        part: ["snippet"],
    });

    return response.data.items ?? [];
}

/**
 * Returns search results fully mapped to MockVideos.
 *
 * @param {string} query
 * @returns {Promise<MockVideo[]>}
 */
export async function searchVideos(query) {
    const resultSnippets = await searchVideoSnippets(query);

    /** @type {string[]} */
    const videoIds = resultSnippets
        .map((result) => result.id.videoId)
        .filter((videoId) => !!videoId);

    const detailedResponse = await yt.videos.list({
        id: videoIds,
        part: ["contentDetails"],
    });

    const mocks = [];
    for (let i = 0; i < resultSnippets.length; i++) {
        const searchResult = resultSnippets[i];
        const videoDetail = detailedResponse.data.items[i];

        mocks.push(mockVideoFromSearchAndDetail(searchResult, videoDetail));
    }

    return mocks;
}

/**
 * Returns a filled in object with all necessary information we need about a video.
 *
 * @param {youtube_v3.Schema$SearchResult} searchResult
 * @param {youtube_v3.Schema$Video} videoDetail
 */
function mockVideoFromSearchAndDetail(searchResult, videoDetail) {
    const id = videoDetail.id;

    return new MockVideo(
        `https://youtu.be/${id}`,
        id,
        searchResult.snippet.title,
        ptDurationToSeconds(videoDetail.contentDetails.duration),
        searchResult.snippet.thumbnails.high.url,
    );
}
