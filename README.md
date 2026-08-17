# Lampa Infuse Fix

A small, dependency-free Lampa plugin that fixes incorrect episode selection when opening large TorrServer torrent packs in Infuse.

When an episode is selected, the plugin sends that episode first, followed by up to 39 subsequent files from the torrent. This guarantees that Infuse opens the requested episode and can continue forward without wrapping back to the beginning of the torrent. Regular URLs, other external players, and Lampa's built-in player are not modified.

## Installation

Lampa loads plugins from a URL, so `infuse-fix.js` must be available over HTTP(S).

### GitHub Pages

This repository publishes the plugin through GitHub Pages. Add the following URL in **Lampa → Settings → Extensions → Add plugin**:

```text
https://dcip3.github.io/lampa-infuse-fix/infuse-fix.js?v=1.1.0
```

Fully restart Lampa after adding the URL.

### Local testing on macOS

Run a temporary local server:

```sh
python3 -m http.server 8765 --directory /Users/dcip3/Documents/lampa-infuse-fix
```

Then add this URL in Lampa:

```text
http://localhost:8765/infuse-fix.js
```

This works when Lampa runs on the same Mac. If the browser blocks an HTTP plugin loaded by `https://lampa.mx`, use the GitHub Pages URL above or another HTTPS host.

## Usage

1. Select **Infuse** as the external player for torrents or TV episodes.
2. Open a torrent pack through TorrServer.
3. Select any episode, including one far down the list.
4. Infuse should open that exact episode.

For example, a selected TorrServer stream containing `index=85` becomes the first item in an Infuse request similar to:

```text
infuse://x-callback-url/play?url=...%26index%3D85%26play&filename=...S09E04.mkv&url=...%26index%3D86%26play&filename=...S09E05.mkv&...
```

The selected TorrServer URL is always first. Only subsequent items are appended; files before the selected item are never added at the end.

## Root cause

As reviewed on August 17, 2026, Lampa's `src/core/infusePlayer.js` performs these steps:

1. Finds the selected episode and records its `startIndex`.
2. Builds links from the beginning of the source playlist, stopping at `maxItems: 40`.
3. Attempts to rotate the truncated list using the original `startIndex`.

If the selected episode is at position 40 or later, it is already absent from the truncated list. The rotation is skipped because the original index is outside the new list, leaving the first torrent episode at the front.

## How it works

The plugin subscribes to Lampa's supported `infuse_build_url` extension event. Immediately before Infuse launches, it checks whether the selected stream is a TorrServer URL, finds that URL in the original playlist, and builds a forward-only temporary playlist:

1. The selected item is placed first.
2. Up to 39 subsequent items are appended in their original order.
3. Items before the selection are never appended, so playback cannot wrap to the first season.
4. The list is shortened further if the deep link approaches 65,536 characters.

When available, the request also preserves:

- The episode filename for Infuse metadata matching
- The playback resume position
- The first external subtitle track
- Lampa's `x-success` and `x-error` callbacks

Non-TorrServer streams are ignored.

## Relationship to `infuseSave.js`

`https://lampame.github.io/main/infuseSave.js` is only a loader for:

```text
https://lampame.github.io/main/its/its.js
```

The loaded AppleTV Tweaks / Infuse Saver plugin adds torrent-file context menu actions to save one file, save all files, or edit the selection before saving. It does not intercept `infuse_build_url` and does not fix normal playback of an episode selected from a large torrent pack.

Both plugins can be installed at the same time because they handle different Lampa events.

## Diagnostics

After the plugin loads, its version is available in the Lampa developer console:

```js
LampaInfuseTorrServerFix.version
```

Expected result:

```text
1.1.0
```

To confirm that the plugin subscribed to the player event and intercepted a launch, run:

```js
LampaInfuseTorrServerFix.status()
```

After at least one TorrServer launch through Infuse, the expected result is similar to:

```js
{ installed: true, interceptions: 1, lastPlaylistSize: 40 }
```

The URL generator can also be checked without launching Infuse:

```js
LampaInfuseTorrServerFix.buildInfuseUrl({
  url: 'http://192.168.1.7:8090/stream/Rick.and.Morty.S09E04.mkv?link=HASH&index=85&play'
})
```

## Compatibility

The plugin requires a Lampa version that provides the `infuse_build_url` event. The event is present in both the current source and published Lampa bundle at the time of this review.

## Playlist limits

The temporary playlist contains at most 40 items in total: the selected episode plus up to 39 following items. If the remaining deep link would exceed 65,536 characters, fewer items are included. The selected episode is always retained as the first item.

Earlier episodes are intentionally omitted. Infuse's URL API plays entries sequentially and does not provide a documented start-index parameter, so including earlier episodes while preserving chronological order would cause Infuse to start the wrong item.

## References

- [Lampa Infuse integration](https://github.com/yumata/lampa-source/blob/main/src/core/infusePlayer.js)
- [Lampa player extension hook](https://github.com/yumata/lampa-source/blob/main/src/interaction/player.js)
- [`infuseSave.js` loader](https://github.com/lampame/main/blob/main/infuseSave.js)
- [Infuse Saver / AppleTV Tweaks implementation](https://github.com/lampame/main/blob/main/its/its.js)
- [Firecore x-callback-url API](https://support.firecore.com/hc/en-us/articles/215090997-API-for-Third-Party-Apps-Services)
