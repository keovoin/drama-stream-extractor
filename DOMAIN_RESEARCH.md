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

## DramaFren

- Sample series URL: `https://dramafren.org/series/a-lock-to-find-my-daughter/`
- The page currently exposes a WordPress-style series page with an `Episodes` section and a single visible `EP 1` / `FULL EPISODE` link.
- It appears to be a third-party episode index rather than a multi-episode provider detail page. The linked full-episode destination must be inspected before deciding whether a multi-episode adapter is appropriate.
- The supplied full-episode page embeds a single external `player.abyssplayer.com` iframe. It does not expose an in-page multi-episode API or a verified direct media URL.

## ReelFren

- Sample detail URL: `https://reelfren.dramafren.org/drama/wetv/bldjcvtb0dwqpu4-empress-reborn?lang=en`
- The page identifies its source provider as WeTV but reports `0 Episode`, while still offering `Start Episode 1`.
- This format has a path-based provider/content identifier and an episode matrix component. Its episode payload and the reason for zero reported episodes need confirmation before support can be added.
- Selecting the ReelFren start control produced an advertising redirect rather than a confirmed episode-player route. That destination will not be used as an extraction source.
