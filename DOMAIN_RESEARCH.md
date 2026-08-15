# DramaFren-Family Domain Research

## iDrama

- Sample detail URL: `https://idrama.dramafren.org/index.php?page=detail&id=100000643589&lang=en`
- The page renders a detail view with a visible `26 Episodes` count and individual episode links labelled `Ep 1` through `Ep 26`.
- The URL structure resembles the existing DramaBox detail-page pattern but uses the `idrama.dramafren.org` host. The player endpoint still needs confirmation from an episode page or page source.
- Testing the existing DramaBox-style `action=get_video` URL did not return structured episode data; it routed to iDrama Unlocked’s separate share-URL interface. This detail-page format therefore cannot safely reuse the DramaBox API adapter.
- A supplied `page=watch` URL successfully loads the native iDrama player, exposes 33 episode controls, and lists two selectable servers. The saved player markup is being inspected to identify its actual episode-data request.
- The supplied watch page exposes a direct HLS source in its player initialization as `var videoSrc`, and its per-episode URLs follow `index.php?page=watch&id=<numeric-id>&ep=<episode>&server=<server>&lang=<lang>`. This supports a dedicated iDrama watch-page adapter rather than the incompatible DramaBox API adapter.

## ShortWave

- Sample detail URL: `https://shortwave.dramafren.org/?id=6a7abff188333fa88a6207aa&slug=my-grumpy-billionaire-boss`
- The page renders a direct player and a visible `Episodes` list with `Ep 1` through `Ep 32`.
- Its identifier is an alphanumeric content ID in the root query string rather than the numeric `index.php?page=detail` pattern used by DramaBox/iDrama. The player payload format still needs confirmation.
- The verified browser session renders the 32-episode list and native player controls, but the initial player remains in a buffering state and does not expose playback metadata in the accessible page content.
- Selecting episode 2 shows an explicit site gate requiring at least one minute of the preceding episode before playback proceeds. The extractor will not bypass this access restriction.

## StardustTV

- Supplied detail URL: `https://stardusttv.dramafren.org/index.php?page=detail&id=20117&slug=call-me-trash-now-i-rule-you-all&lang=en`
- The detail page exposes a visible `Total: 73 Eps` label, a `Start Watching` control, and links for all episodes 1 through 73. The published per-episode route is `index.php?page=watch&id=20117&slug=call-me-trash-now-i-rule-you-all&ep=<episode>&lang=en`.
- The captured watch-page markup shows a browser-created `blob:` player source rather than a direct media URL. It also enforces a source-side rule requiring at least one minute of the previous episode before the next episode plays.
- **Conclusion:** The series navigation is compatible in shape, but automated full-series extraction would conflict with the page’s prior-episode viewing gate. It is not a suitable adapter candidate through the observed non-bypass flow.

## ShortMax

- Supplied detail URL: `https://shortmax.dramafren.org/index.php?page=detail&id=858629&lang=en`
- The page renders `Total: 23 Eps`, labels the available server `Primary`, and exposes individual links for episodes 1 through 23. Its public episode-one route is `index.php?page=watch&id=858629&ep=1&lang=en`.
- The watch page exposes 23 episode selectors, a ready primary server and a backup server, but its player remains at `0:00` and does not display a direct source URL or transparent per-episode API in the rendered page state.
- The captured markup does provide the source contract: it renders a per-episode HLS URL and requests server data from `https://cdn-shortmax.dramafren.org/index.php?action=video_server&server=<server>&id=<id>&ep=<episode>&lang=<lang>`. The response is expected to include `playUrl`, fallbacks, and quality options.
- **Conclusion:** This is a strong candidate for a dedicated adapter. Its per-episode route and structured server request are visible, though no adapter was added in this review.

## MoboReels

- Supplied detail URL: `https://moboreels.dramafren.org/?id=62386322&slug=the-betrayed-heirs-bloody-comeback`
- The page completes loading with a visible native video control, previous/next controls, and an episode selector for 55 episodes. It therefore has an appropriate high-level series shape, but the readable player page does not expose a direct source or a repeatable per-episode request format yet.
- The page’s own script requests `?api_route=video&lang=<lang>&id=<seriesId>&episNum=<episode>` and receives structured media data. The episode-one request was verified to return `data.mediaUrl`.
- **Conclusion:** This is a strong candidate for a dedicated adapter; its public player flow supplies a transparent structured media response for each episode.

## ReelFren

- Supplied watch URL: `https://reelfren.dramafren.org/watch/vibeshort/858389-the-path-to-immortality?ep=1&lang=en`
- The page renders an Episode Matrix and selectable episodes 1 through 60, plus one listed server and a quality control. However, the visible player remains at `0 Episode` with no media source shown after loading; the `Force Retry` control is a source-site recovery action and was not used during this passive review.
- Captured markup shows a browser-created `blob:` video source and serialized episode inventory, but not a direct media URL or transparent per-episode resolver. The underlying React source request was not available from the passive page state.
- **Conclusion:** It is not ready for an adapter based on the observed non-bypass path; its actual media resolver needs provider-authorized documentation or a stable visible request contract.

## DramaFren

- Sample series URL: `https://dramafren.org/series/a-lock-to-find-my-daughter/`
- The page currently exposes a WordPress-style series page with an `Episodes` section and a single visible `EP 1` / `FULL EPISODE` link.
- It appears to be a third-party episode index rather than a multi-episode provider detail page. The linked full-episode destination must be inspected before deciding whether a multi-episode adapter is appropriate.
- The supplied full-episode page embeds a single external `player.abyssplayer.com` iframe. It does not expose an in-page multi-episode API or a verified direct media URL.
- The supplied `/watch/a-lock-to-find-my-daughter/#/` page likewise renders a single embedded watch experience rather than a source-site episode list. Its current player state shows a continue-watching prompt, so the page does not provide a supported in-page full-series extraction surface.

## ReelFren

- Sample detail URL: `https://reelfren.dramafren.org/drama/wetv/bldjcvtb0dwqpu4-empress-reborn?lang=en`
- The page identifies its source provider as WeTV but reports `0 Episode`, while still offering `Start Episode 1`.
- This format has a path-based provider/content identifier and an episode matrix component. Its episode payload and the reason for zero reported episodes need confirmation before support can be added.
- Selecting the ReelFren start control produced an advertising redirect rather than a confirmed episode-player route. That destination will not be used as an extraction source.
