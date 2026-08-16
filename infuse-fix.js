(function () {
    'use strict';

    var PLUGIN_ID = 'lampa_infuse_torrserver_fix';
    var PLUGIN_VERSION = '1.0.0';

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

    function selectedItem(data) {
        var playlist = data && Array.isArray(data.playlist) ? data.playlist : [];

        for (var i = 0; i < playlist.length; i++) {
            if (playlist[i] && sameStream(playlist[i].url, data.url)) {
                return playlist[i];
            }
        }

        return data || {};
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

    function filenameFor(data, item, streamUrl) {
        var candidates = [
            item && item.path,
            data && data.path,
            streamUrl,
            item && item.title,
            data && data.title
        ];

        for (var i = 0; i < candidates.length; i++) {
            var name = basename(candidates[i]);
            if (name) return cleanText(name);
        }

        return '';
    }

    function firstSubtitleUrl(data, item) {
        var subtitles = (item && item.subtitles) || (data && data.subtitles);
        if (!Array.isArray(subtitles)) return '';

        for (var i = 0; i < subtitles.length; i++) {
            if (subtitles[i] && subtitles[i].url) {
                return sanitizeStreamUrl(subtitles[i].url);
            }
        }

        return '';
    }

    function resumePosition(data, item) {
        var timeline = (item && item.timeline) || (data && data.timeline);
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

    function buildInfuseUrl(data, callbacks) {
        var item = selectedItem(data);
        var streamUrl = sanitizeStreamUrl(data.url);
        var callbackUrls = resolveCallbacks(callbacks);
        var parts = [];

        addParameter(parts, 'url', streamUrl);
        var position = resumePosition(data, item);

        if (position > 0) addParameter(parts, 'position', position);
        addParameter(parts, 'filename', filenameFor(data, item, streamUrl));
        addParameter(parts, 'sub', firstSubtitleUrl(data, item));
        addParameter(parts, 'x-success', callbackUrls.success);
        addParameter(parts, 'x-error', callbackUrls.error);

        return 'infuse://x-callback-url/play?' + parts.join('&');
    }

    function onInfuseBuildUrl(event) {
        if (!event || typeof event.setUrl !== 'function') return;
        if (!isTorrServerStream(event.data)) return;

        event.setUrl(buildInfuseUrl(event.data, event.callbacks));
    }

    function install() {
        if (!window.Lampa || !Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return;
        if (window[PLUGIN_ID + '_installed']) return;

        window[PLUGIN_ID + '_installed'] = true;
        Lampa.Listener.follow('infuse_build_url', onInfuseBuildUrl);

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
        buildInfuseUrl: buildInfuseUrl
    };

    if (window.appready) {
        install();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event && event.type === 'ready') install();
        });
    }
})();
