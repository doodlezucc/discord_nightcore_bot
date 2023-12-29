import { youtube, youtube_v3 } from "@googleapis/youtube";

import config from "../../config.json" assert { type: "json" };
import { ptDurationToSeconds } from "../duration.js";
import type { BasicMedia, MockMedia } from "./media-search.js";
const { googleApiKey } = config;

const yt = youtube({
    version: "v3",
    auth: googleApiKey,
});

async function searchVideoSnippets(query: string) {
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
 */
export async function searchVideos(query: string) {
    const resultSnippets = await searchVideoSnippets(query);

    const videoIds = resultSnippets
        .map((result) => result.id!.videoId!)
        .filter((videoId) => !!videoId);

    const detailedResponse = await yt.videos.list({
        id: videoIds,
        part: ["contentDetails"],
    });

    const mocks: BasicMedia[] = [];
    for (let i = 0; i < resultSnippets.length; i++) {
        const searchResult = resultSnippets[i];
        const videoDetail = detailedResponse.data.items![i];

        mocks.push(mockVideoFromSearchAndDetail(searchResult, videoDetail));
    }

    return mocks;
}

/**
 * Returns a filled in object with all necessary information we need about a video.
 */
function mockVideoFromSearchAndDetail(
    searchResult: youtube_v3.Schema$SearchResult,
    videoDetail: youtube_v3.Schema$Video,
): BasicMedia {
    const id = videoDetail.id!;

    return {
        url: `https://youtu.be/${id}`,
        title: searchResult.snippet!.title!,
        durationInSeconds: ptDurationToSeconds(
            videoDetail.contentDetails!.duration!,
        ),
        thumbnail: searchResult.snippet!.thumbnails!.high!.url!,
    };
}
