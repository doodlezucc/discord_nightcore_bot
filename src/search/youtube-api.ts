import { youtube, youtube_v3 } from "@googleapis/youtube";

import config from "../../config.json" assert { type: "json" };
import { ptDurationToSeconds } from "../duration.js";
import type { InternetMedia } from "./media-search.js";
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
 * Returns search results mapped to InternetMedia objects.
 */
export async function searchVideos(query: string): Promise<InternetMedia[]> {
    const resultSnippets = await searchVideoSnippets(query);

    const videoIds = resultSnippets
        .map((result) => result.id!.videoId!)
        .filter((videoId) => !!videoId);

    const detailedResponse = await yt.videos.list({
        id: videoIds,
        part: ["contentDetails"],
    });

    const mediaResults: InternetMedia[] = [];
    for (let i = 0; i < resultSnippets.length; i++) {
        const searchResult = resultSnippets[i];
        const videoDetail = detailedResponse.data.items![i];

        mediaResults.push(mediaFromSearchAndDetail(searchResult, videoDetail));
    }

    return mediaResults;
}

/**
 * Returns a filled in object with all necessary information we need about a video.
 */
function mediaFromSearchAndDetail(
    searchResult: youtube_v3.Schema$SearchResult,
    videoDetail: youtube_v3.Schema$Video,
): InternetMedia {
    const id = videoDetail.id!;

    return {
        id: id,
        url: `https://youtu.be/${id}`,
        title: searchResult.snippet!.title!,
        durationInSeconds: ptDurationToSeconds(
            videoDetail.contentDetails!.duration!,
        ),
        thumbnail: searchResult.snippet!.thumbnails!.high!.url!,
    };
}
