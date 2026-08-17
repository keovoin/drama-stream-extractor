# Current provider review

## Supplied DramaFren page

`https://dramafren.org/watch/i-dumped-my-chancellor-husband/` loads as a single watch page with one embedded **Abyss** player. The visible page does not publish an episode matrix, a per-episode API route, or subtitle-track metadata. Its visible player subtitles are part of the external embedded experience rather than fields exposed in the extractor's stream workbook.

## Supplied ShortMax page

`https://shortmax.dramafren.org/index.php?page=detail&id=7482&lang=en` currently stops at a Cloudflare security-verification page. No extraction attempt was made beyond that gate. The existing ShortMax review remains a potential supported route only when the protected session reaches the provider's published player data.

## Reliability and subtitles

DramaBox extraction is intentionally sequential, with a maximum of three per-episode attempts and a 20-second request timeout per attempt. It continues to the next episode after an unavailable result and the retry-only action later retries just those rows. The recent supplied 48-episode DramaBox series completed with 48 URLs, so no current high-load source failure was reproduced. A source-side verification page or unavailable player response is recorded as an unavailable row rather than retried indefinitely.

The workbook exports the primary player stream URL, server label, source request URL, and status. The supported DramaBox and iDrama payloads used by the extractor do not currently publish subtitle-track fields. When captions are visible in a source player, they may be embedded in the video image or controlled by a separate player track; neither can be inferred safely from the primary stream URL alone.

## Release status

The retry-only feature is published on the managed site and synchronized to the private GitHub `main` branch at commit `bb542c0` when this review began. These review notes are documentation only and do not change the deployed extractor behavior.
