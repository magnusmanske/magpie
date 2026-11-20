/* Tooltranslate interface strings for the unified magpie UI.
   Translations live only in Tooltranslate (the `magpie` tool); this module
   fetches the published snapshots and falls back to English when a key or
   language is missing. */

window.Magpie = window.Magpie || {};

Magpie.i18n = (function () {
	const LANGUAGE_NAMES = {
		en: 'English',
		ar: 'العربية',
		bn: 'বাংলা',
		ca: 'català',
		ckb: 'کوردی',
		de: 'Deutsch',
		es: 'español',
		fr: 'français',
		ga: 'Gaeilge',
		gl: 'galego',
		gu: 'ગુજરાતી',
		he: 'עברית',
		hu: 'magyar',
		id: 'Bahasa Indonesia',
		it: 'italiano',
		ja: '日本語',
		ko: '한국어',
		lb: 'Lëtzebuergesch',
		mk: 'македонски',
		ml: 'മലയാളം',
		nb: 'norsk bokmål',
		nl: 'Nederlands',
		pl: 'polski',
		ps: 'پښتو',
		pt: 'português',
		ru: 'русский',
		sk: 'slovenčina',
		sr: 'српски',
		sv: 'svenska',
		te: 'తెలుగు',
		tr: 'Türkçe',
		uk: 'українська',
		'zh-hans': '简体中文',
		'zh-hant': '繁體中文'
	};
	const RTL = new Set(['ar', 'arc', 'arz', 'ckb', 'dv', 'fa', 'glk', 'he', 'ks',
		'lrc', 'mzn', 'nqo', 'pnb', 'ps', 'sd', 'ug', 'ur', 'yi']);
	const REMOTE = 'https://tools-static.wmflabs.org/tooltranslate/data/magpie/';
	const state = Vue.observable({
		language: 'en',
		available: ['en'],
		ready: false,
		version: 0
	});
	const cache = {};

	function normalize(language) {
		const code = String(language || '').toLowerCase().replace(/_/g, '-');
		if (!code) return 'en';
		if (LANGUAGE_NAMES[code]) return code;
		const base = code.replace(/-.+$/, '');
		if (LANGUAGE_NAMES[base]) return base;
		return /^[a-z][a-z0-9-]*$/.test(base) ? base : 'en';
	}

	/* Tooltranslate values may contain HTML (older Flickr strings do). The
	   unified interface is text-only, so render them as text and keep the
	   value safe whichever language was selected. */
	function plain(text) {
		if (typeof text !== 'string') text = String(text == null ? '' : text);
		if (text.indexOf('<') === -1 && text.indexOf('&') === -1) return text;
		const element = document.createElement('div');
		element.innerHTML = text;
		return element.textContent || '';
	}

	async function getJSON(url) {
		try {
			const response = await fetch(url, { cache: 'no-cache' });
			if (!response.ok) return undefined;
			return await response.json();
		} catch (error) {
			return undefined;
		}
	}

	async function ensure(language) {
		if (!cache[language]) cache[language] = (await getJSON(REMOTE + encodeURIComponent(language) + '.json')) || {};
		return cache[language];
	}

	function t(key, params) {
		// Reading these makes every template re-render when the language or
		// the loaded cache changes.
		state.version;
		const values = cache[state.language] || {};
		const english = cache.en || {};
		let text = values[key];
		if (text === undefined) text = english[key];
		if (text === undefined) text = key;
		text = plain(text);
		if (Array.isArray(params)) {
			params.forEach((value, index) => {
				text = text.split('$' + (index + 1)).join(String(value));
			});
		}
		return text;
	}

	function cookie(name, value) {
		if (value === undefined) {
			const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
			return match ? decodeURIComponent(match[1]) : '';
		}
		document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; SameSite=Lax';
	}

	function applyDocument() {
		const dir = RTL.has(state.language.replace(/-.+$/, '')) ? 'rtl' : 'ltr';
		document.documentElement.setAttribute('lang', state.language);
		document.documentElement.setAttribute('dir', dir);
		if (document.body) document.body.setAttribute('dir', dir);
		document.title = t('magpie_title');
	}

	async function setLanguage(language) {
		const code = normalize(language);
		if (!state.available.includes(code) && code !== 'en') return;
		await ensure(code);
		state.language = code;
		state.ready = true;
		state.version++;
		cookie('interface_language', code);
		applyDocument();
	}

	async function init() {
		const info = await getJSON(REMOTE + 'toolinfo.json');
		const available = ((info && info.languages) || [])
			.map(normalize)
			.filter((code) => /^[a-z][a-z0-9-]*$/.test(code));
		if (!available.includes('en')) available.unshift('en');
		Vue.set(state, 'available', Array.from(new Set(available)));

		const fromUrl = window.location.href.match(/[#&?]interface_language=([a-z_-]+)/i);
		let language = normalize(
			(fromUrl && fromUrl[1]) || cookie('interface_language') || navigator.language || 'en');
		if (!state.available.includes(language)) language = 'en';
		await Promise.all([ensure('en'), language === 'en' ? undefined : ensure(language)]);
		state.language = language;
		state.ready = true;
		state.version++;
		applyDocument();
	}

	return {
		LANGUAGE_NAMES,
		state,
		init,
		setLanguage,
		normalize,
		name(code) { return LANGUAGE_NAMES[code] || code; },
		t
	};
})();

Magpie.t = function (key, params) {
	return Magpie.i18n.t(key, params);
};
