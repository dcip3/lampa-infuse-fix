(function () {
    'use strict';

    var PLUGIN_ID = 'lampa_infuse_torrserver_fix';
    var PLUGIN_VERSION = '1.1.0';
    var MAX_PLAYLIST_ITEMS = 40;
    var MAX_URL_LENGTH = 65536;
    var interceptionCount = 0;
    var lastPlaylistSize = 0;

    if (window[PLUGIN_ID + '_ready']) return;
    window[PLUGIN_ID + '_ready'] = true;

    function sanitizeStreamUrl(value) {
        return String(value || '')
            .replace(/([?&])preload(?=(&|=|$))/gi, '$1play')
            .replace(/\s/g, '%20');
    }

    function isTorrServerStream(data) {
        if (!data) return false;
        if (data.torrent_hash) return true;

        var url = String(data.url || '');
        return /\/stream\//i.test(url) && /[?&]link=/i.test(url);
    }

    function safeDecode(value) {
        try {
            return decodeURIComponent(value);
        } catch (error) {
            return value;
        }
    }

    function queryValue(url, name) {
        var expression = new RegExp('[?&]' + name + '=([^&#]*)', 'i');
        var match = String(url || '').match(expression);
        return match ? safeDecode(match[1]) : '';
    }

    function comparableStream(url) {
        var normalized = sanitizeStreamUrl(url);
        var path = normalized.split('?')[0];
        var index = queryValue(normalized, 'index');
        var link = queryValue(normalized, 'link');

        return {
            full: normalized,
            path: path,
            index: index,
            link: link
        };
    }

    function sameStream(left, right) {
        if (!left || !right) return false;

        var a = comparableStream(left);
        var b = comparableStream(right);

        if (a.full === b.full) return true;
        if (a.path !== b.path) return false;
        if (a.index || b.index) return a.index === b.index;
        if (a.link || b.link) return a.link === b.link;

        return true;
    }

    function playlistFromSelected(data) {
        var source = data && Array.isArray(data.playlist) ? data.playlist : [];
        var playlist = source.filter(function (item) {
            return item && !item.separator && typeof item.url === 'string';
        });

        for (var i = 0; i < playlist.length; i++) {
            if (sameStream(playlist[i].url, data.url)) {
                return playlist.slice(i, i + MAX_PLAYLIST_ITEMS);
            }
        }

        return data && data.url ? [data] : [];
    }

    function basename(value) {
        var text = String(value || '').split('#')[0].split('?')[0];
        var parts = text.replace(/\\/g, '/').split('/');
        return safeDecode(parts[parts.length - 1] || '');
    }

    function cleanText(value) {
        return String(value || '')
            .replace(/<[^>]*>/g, '')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function filenameFor(data, item, streamUrl, isSelected) {
        var candidates = [
            item && item.path,
            isSelected && data && data.path,
            streamUrl,
            item && item.title,
            isSelected && data && data.title
        ];

        for (var i = 0; i < candidates.length; i++) {
            var name = basename(candidates[i]);
            if (name) return cleanText(name);
        }

        return '';
    }

    function firstSubtitleUrl(data, item, isSelected) {
        var subtitles = item && item.subtitles;
        if (!subtitles && isSelected) subtitles = data && data.subtitles;
        if (!Array.isArray(subtitles)) return '';

        for (var i = 0; i < subtitles.length; i++) {
            if (subtitles[i] && subtitles[i].url) {
                return sanitizeStreamUrl(subtitles[i].url);
            }
        }

        return '';
    }

    function resumePosition(data, item, isSelected) {
        var timeline = item && item.timeline;
        if (!timeline && isSelected) timeline = data && data.timeline;
        if (!timeline) return 0;

        var time = Number(timeline.time);
        if (isFinite(time) && time > 1) return Math.floor(time);

        var percent = Number(timeline.percent);
        var duration = Number(timeline.duration);

        if (isFinite(percent) && isFinite(duration) && duration > 0) {
            if (percent > 1) percent = percent / 100;
            if (percent > 0) return Math.floor(duration * percent);
        }

        return 0;
    }

    function resolveCallbacks(callbacks) {
        callbacks = callbacks || {};

        var client = 'lampa';
        if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.field === 'function') {
            client = Lampa.Storage.field('apple_tv_client') || client;
        }

        return {
            success: callbacks.x_success || (client + '://infuseDidFinish'),
            error: callbacks.x_error || (client + '://infuseDidFail')
        };
    }

    function addParameter(parts, name, value) {
        if (value === undefined || value === null || value === '') return;
        parts.push(name + '=' + encodeURIComponent(String(value)));
    }

    function buildItemParameters(data, item, isSelected) {
        var streamUrl = sanitizeStreamUrl(isSelected ? data.url : item.url);
        var parts = [];

        addParameter(parts, 'url', streamUrl);
        var position = resumePosition(data, item, isSelected);

        if (position > 0) addParameter(parts, 'position', position);
        addParameter(parts, 'filename', filenameFor(data, item, streamUrl, isSelected));
        addParameter(parts, 'sub', firstSubtitleUrl(data, item, isSelected));

        return parts;
    }

    function buildInfuseUrl(data, callbacks) {
        var prefix = 'infuse://x-callback-url/play?';
        var items = playlistFromSelected(data);
        var callbackUrls = resolveCallbacks(callbacks);
        var callbackParts = [];
        var itemParts = [];

        addParameter(callbackParts, 'x-success', callbackUrls.success);
        addParameter(callbackParts, 'x-error', callbackUrls.error);

        for (var i = 0; i < items.length; i++) {
            var nextParts = buildItemParameters(data, items[i], i === 0);
            var candidate = prefix + itemParts.concat(nextParts, callbackParts).join('&');

            if (candidate.length > MAX_URL_LENGTH && itemParts.length) break;
            itemParts = itemParts.concat(nextParts);
        }

        lastPlaylistSize = itemParts.filter(function (part) {
            return part.indexOf('url=') === 0;
        }).length;

        return prefix + itemParts.concat(callbackParts).join('&');
    }

    function onInfuseBuildUrl(event) {
        if (!event || typeof event.setUrl !== 'function') return;
        if (!isTorrServerStream(event.data)) return;

        interceptionCount += 1;
        event.setUrl(buildInfuseUrl(event.data, event.callbacks));
    }

    function install() {
        if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener) return;
        if (typeof Lampa.Player.listener.follow !== 'function') return;
        if (window[PLUGIN_ID + '_installed']) return;

        window[PLUGIN_ID + '_installed'] = true;
        Lampa.Player.listener.follow('infuse_build_url', onInfuseBuildUrl);

        if (Lampa.Manifest) {
            Lampa.Manifest.plugins = {
                type: 'other',
                version: PLUGIN_VERSION,
                name: 'Infuse TorrServer Episode Fix',
                description: 'Opens the selected TorrServer episode in Infuse',
                component: PLUGIN_ID
            };
        }
    }

    window.LampaInfuseTorrServerFix = {
        version: PLUGIN_VERSION,
        isTorrServerStream: isTorrServerStream,
        buildInfuseUrl: buildInfuseUrl,
        status: function () {
            return {
                installed: Boolean(window[PLUGIN_ID + '_installed']),
                interceptions: interceptionCount,
                lastPlaylistSize: lastPlaylistSize
            };
        },
        limits: {
            playlistItems: MAX_PLAYLIST_ITEMS,
            urlLength: MAX_URL_LENGTH
        }
    };

    if (window.appready) {
        install();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event && event.type === 'ready') install();
        });
    }
})();
