/* Commons-side checks for Flickr2Commons: file-name status, TitleBlacklist,
   and the small text helpers the per-file rows use. */

window.Magpie = window.Magpie || {};

Magpie.commons = (function () {
	/* Keys are display filenames (spaces, no underscores, no ucFirst).
	   Values: 0 unused, 1 exists, 2 previously deleted, 3 blacklisted. */
	const cache = {};
	const titleBlacklistCache = {};
	const inFlight = new Map();

	const API_USER_AGENT = 'magpie/1.0 (https://magpie.toolforge.org/)';
	const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

	const SIMPLE_FILENAME_RE = /^[0-9() ]*(\.[a-z]+)?$/i;
	const FORBIDDEN_TITLE_CHARACTER_RE = /[\u00ad\u00a0\u1680\u180e\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\u202a-\u202e\ufeff\ue000-\uf8ff\ufff0-\uffff\u{40000}-\u{10ffff}\p{Cc}]/u;

	/* Local mirror of the Commons TitleBlacklist patterns that matter for new
	   file titles, so the warning works without contacting Commons. Synced
	   2026-07-03 from [[MediaWiki:Titleblacklist]]. */
	const LOCAL_BLACKLIST = [
		/^test[\d\s]+\.jpe?g$/i,
		/^dcp[\d\s]+\.jpe?g$/i,
		/^dsc.[\d\s]+\.jpe?g$/i,
		/^mvc-?[\d\s]+\.jpe?g$/i,
		/^p[\da-f][\d\s]+\.jpe?g$/i,
		/^(mv)?i?mg[p_]?[\d\s]+\.jpe?g$/i,
		/^1\d+-\d+(_img)?\.jpe?g$/i,
		/^(im|ex)[\d\s]+\.jpe?g$/i,
		/^dc[\d\s]+[sml]\.jpe?g$/i,
		/^pic[t_]?[\d\s]+\.jpe?g$/i,
		/^pana[\d\s]+\.jpe?g$/i,
		/^duw[\d\s]+\.jpe?g$/i,
		/^cimg[\d\s]+\.jpe?g$/i,
		/^jd[\d\s]+\.jpe?g$/i,
		/^sdc[\d\s]+\.jpe?g$/i,
		/^dvc[\d\s]+\.jpe?g$/i,
		/^sany[\d\s]+\.jpe?g$/i,
		/^sam[\d\s]+\.jpe?g$/i,
		/^dji[\d\s]+\.jpe?g$/i,
		/^pxl[\d\s]+\.jpe?g$/i,
		/^hpim\d+\.jpe?g$/i,
		/^snv[\d\s]+\.jpe?g$/i,
		/^kimg[\d\s]+\.jpe?g$/i,
		/^gopr\d{3,}\..+$/i,
		/^vid[ _]\d{4,}\..+$/i,
		/^(mv)?img \d{3,}.*$/i,
		/^screen_?shot[ _][\d٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹\-]{8,}\b.+\.[a-z]{3,}$/iu,
		/^whatsapp[_\-]?image\b.+/i,
		/^whatsapp[_\-]?video\b.+/i,
		/^instagramcapture_.+/i,
		/^received_?\d.+/i,
		/^camscanner\b.+/i,
		/^inshot .+\.jpe?g$/i,
		/^picsart([^a-z].*?)?\.[a-z]{3,}$/i,
		/^beautyplus(me)?\b.+/i,
		/^snapchat\-\d.+/i,
		/^bandicam[_\d].+/i,
		/^lrm_export\b.+/i,
		/^fullsizeoutput.+/i,
		/^psx 20\d{2}.+/i,
		/^file_\d+_.+/i,
		/^wechatimg.+/i,
		/^kakaotalk.+/i,
		/^robloxscreenshot\d{8}_\d{9}\.png$/i,
		/^static_svgfiles.+/i,
		/^tumblr_(?=\d*[a-z])(?=\d*[a-z])[a-z\d]+(?:_[a-z\d]{2})?_\d+\.[a-z]{3,}$/i,
		/^mv5b[\w@]{44}\._v1[\w,]+\.jpe?g$/i,
		/^wp_\d+[\b_].+\.[a-z]{3,}$/i,
		/^fb_img_\d+(?:_\(\d\))?\.\w+$/i,
		/^win_\d{8}\b.*\.jpe?g$/i,
		/^c360_\d.*\.jpe?g$/i,
		/^s-l\d+\.[a-z]{3,}$/i,
		/^images \(\d+\)\.jpe?g$/i,
		/^vlcsnap-\d{4}-\d{2}-\d{2}-[\dhms]+\.[^.]+$/i,
		/^vid-\d{8}.*$/i,
		/^img-\d{8}-wa\d{4}\.jpe?g$/i,
		/^photogrid \d.+/i,
		/^tmpdoodle[^a-z].*/i,
		/^adobephotoshopexpress[^a-z].*/i,
		/^https?--.*/i,
		/.*microsoft word document.*\.pdf$/i,
		/.*convert-video-online\.com.*/i,
		/.*videotomp4.*/i,
		/.*unadjustednonraw.*/i,
		/.*ezgif.*/i,
		/^(.)\1+\.\w+$/i,
		/^\d{4,}(_\d{6,}){2,}_(a|b|n|o|s).+/i,
		/^[0-9]+[0-9\ \_\-]+ios\W*\.[a-z]+$/i,
		/^(?:[\da-f]{8}-)?[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-?[\da-f]{12}.*$/i,
		/^([sml]|\d+)_[\da-f]{10,}(-\d+-|_?(\w\w?|full))?\.[^.]+$/i,
		/^(?=\d*[a-f]+\d+[a-f]+)(?=[a-f]*\d+[a-f]+\d+)[a-f\d]{10,}\.\w+$/i,
		/^\d{9}[a-z]{6}_[a-z]{2}\P{L}*\.\w+$/iu,
		/^\d{8,}_[\da-f]{10}(?:_[a-z])?\P{L}*\.\w+$/iu,
		/^at[aeimquycgkosw048]aaa[a-d][-_a-z0-9]+\.jpe?g$/i,
		/^(?:照|图)片.*/u,
		/^(?:无|未|無)(?:标|標|命)(?:题|題|名).*/u,
		/^(?:屏|螢)幕快照.*/u,
		/^(?:qq|微信)图片.*/iu,
		/^(?:tim|360|qq|微信)截图.*/iu,
		/^(?:screenshot|screencap|螢幕截圖|截圖|截图|写真)s*[\d\s.,_'~()-]*[a-z]?\.[a-z]{2,}$/iu,
		/^(?:untitled|no[-_]?name|unbenannt|picture|pict?|imagem?n?|img|immagine|clip|photo|foto|bild|scan[\W\d_]|panorama|sin_título|capture)_?\P{L}*\.\w+$/iu,
		/^(?:january|jan|february|febr?|march|mar|april|apr|may|june?|july?|august|aug|september|sept?|october|oct|november|nov|december|dec)\P{L}*\.jpe?g$/iu,
		/^\P{L}*\.[^.]+$/u,
		/^\P{L}*(?:small|medium|large)\)?\.[^.]+$/iu,
		/^\d+px-.*/i,
		/.*(?:,|\.)(?:a?png|gif|jp[egs]g?|tiff?|xcf|pdf|midi?|kar|svg|djvu?|og[avgx]|flac|opus|spx|wav|web[mp]|mp[ae23g]g?|stl)(?: |,)?\.(?:a?png|gif|jp[egs]g?|tiff?|xcf|pdf|midi?|kar|svg|djvu?|og[avgx]|flac|opus|spx|wav|web[mp]|mp[ae23g]g?|stl)$/i,
		/.*'{2,}.*/,
		/.*\s(?:,|\.)(?:a?png|gif|jp[egs]g?|tiff?|xcf|pdf|midi?|kar|svg|djvu?|og[avgx]|flac|opus|spx|wav|web[mp]|mp[ae23g]g?|stl)$/i,
		/^[\w\d\s]+$/u
	];

	const api = {
		cache,
		titleBlacklistCache,

		ucFirst(text) {
			text = String(text || '');
			return text ? text[0].toUpperCase() + text.slice(1) : '';
		},

		normalizeTitle(title) {
			return String(title || '')
				.normalize('NFC')
				.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
				.replace(/[_\s]+/gu, ' ')
				.trim();
		},

		/* The key the server uses for a filename. */
		fileKey(title) {
			return api.ucFirst(api.normalizeTitle(title).replace(/ /g, '_'));
		},

		splitPhotoIds(value) {
			return String(value || '').split(',').map((id) => id.trim()).filter(Boolean);
		},

		cleanFilenameSpacing(filename) {
			return String(filename || '')
				.trimStart()
				.replace(/\s+(?=\.[^.\s]+\s*$)/, '')
				.trimEnd();
		},

		/* Transform the descriptive part of a filename, keeping a generated
		   " (12345)" suffix and the extension intact. */
		transformFilenameStem(filename, transform) {
			const value = api.cleanFilenameSpacing(filename);
			let stem = value;
			let flickrId = '';
			let extension = '';
			let match = value.match(/^(.*?)(\s+\(\d+\))(\.[^.]+)$/);
			if (match) {
				[, stem, flickrId, extension] = match;
			} else {
				match = value.match(/^(.*?)(\.[^.]+)$/);
				if (match) [, stem, extension] = match;
			}
			return `${transform(stem).trim()}${flickrId}${extension}`;
		},

		/* A title is "simple" when it carries no useful words. */
		isSimpleFilename(title) {
			const value = title || '';
			if (SIMPLE_FILENAME_RE.test(value)) return true;
			const stem = value.replace(/\s*\(\d+\)\s*(\.[a-z]+)?$/i, '').trim();
			return Boolean(stem && !/[a-z]{2,}/i.test(stem));
		},

		checkLocalBlacklist(title) {
			const raw = String(title || '');
			if (FORBIDDEN_TITLE_CHARACTER_RE.test(raw)) {
				return { reason: 'Forbidden or invisible character', line: FORBIDDEN_TITLE_CHARACTER_RE.source };
			}
			const normalized = api.normalizeTitle(raw);
			const candidates = raw === normalized ? [raw] : [raw, normalized];
			if (!candidates.some((candidate) => candidate.replace(/\.[^.]+$/, '').trim().length)) return null;
			for (const re of LOCAL_BLACKLIST) {
				if (candidates.some((candidate) => re.test(candidate))) {
					return { reason: 'Local blacklist match', line: re.source };
				}
			}
			return null;
		},

		/* 'exists' > 'deleted' > 'blacklisted' > 'simple' > 'checking' > 'ok' */
		statusFromCache(title) {
			if (api.checkLocalBlacklist(title)) return 'blacklisted';
			const key = api.normalizeTitle(title);
			const cached = cache[key];
			if (cached === 1 || cached === true) return 'exists';
			if (cached === 2) return 'deleted';
			if (cached === 3) return 'blacklisted';
			if (api.isSimpleFilename(title)) return 'blacklisted';
			if (cached === undefined) return 'checking';
			return 'ok';
		},

		async checkTitleBlacklist(title) {
			const local = api.checkLocalBlacklist(title);
			const key = api.normalizeTitle(title);
			if (titleBlacklistCache[key] !== undefined) return titleBlacklistCache[key];
			if (local) {
				titleBlacklistCache[key] = local;
				return local;
			}
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 8000);
			try {
				const url = new URL(COMMONS_API);
				url.searchParams.set('action', 'titleblacklist');
				url.searchParams.set('tbaction', 'create');
				url.searchParams.set('tbtitle', 'File:' + key);
				url.searchParams.set('format', 'json');
				url.searchParams.set('formatversion', '2');
				url.searchParams.set('origin', '*');
				const response = await fetch(url, {
					headers: { 'Api-User-Agent': API_USER_AGENT },
					signal: controller.signal
				});
				if (!response.ok) return false;
				const data = await response.json();
				if (data.error) return false;
				const list = data.titleblacklist;
				if (!list || list.result === 'ok') {
					titleBlacklistCache[key] = false;
					return false;
				}
				const result = { reason: list.reason || '', line: list.line || '' };
				titleBlacklistCache[key] = result;
				return result;
			} catch (error) {
				return false;
			} finally {
				clearTimeout(timeout);
			}
		},

		/* Look up one filename on Commons, with caching and de-duplication. */
		lookupFilename(title) {
			const key = api.normalizeTitle(title);
			if (cache[key] !== undefined) return Promise.resolve(cache[key]);
			if (api.isSimpleFilename(title)) {
				cache[key] = 0;
				return Promise.resolve(0);
			}
			if (inFlight.has(key)) return inFlight.get(key);

			const job = (async () => {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 10000);
				try {
					const url = new URL(COMMONS_API);
					const apiTitle = 'File:' + api.ucFirst(key);
					const query = {
						action: 'query',
						titles: apiTitle,
						prop: 'imageinfo',
						list: 'logevents',
						letype: 'delete',
						letitle: apiTitle,
						lelimit: 1,
						format: 'json',
						formatversion: 2,
						errorformat: 'plaintext',
						maxlag: 10,
						origin: '*'
					};
					Object.keys(query).forEach((name) => url.searchParams.set(name, query[name]));
					const response = await fetch(url, {
						headers: { 'Api-User-Agent': API_USER_AGENT },
						signal: controller.signal
					});
					if (!response.ok) {
						cache[key] = 0;
						return 0;
					}
					const data = await response.json();
					if (data.error) {
						cache[key] = 0;
						return 0;
					}
					let exists = false;
					for (const page of (data.query && data.query.pages) || []) {
						if (!page.missing) exists = true;
					}
					const deleted = !exists && data.query && data.query.logevents && data.query.logevents.length > 0;
					const result = exists ? 1 : (deleted ? 2 : 0);
					cache[key] = result;
					return result;
				} catch (error) {
					/* Fail open: upload-side checks still run. */
					cache[key] = 0;
					return 0;
				} finally {
					clearTimeout(timeout);
					inFlight.delete(key);
				}
			})();

			inFlight.set(key, job);
			return job;
		},

		/* A translated message would live here; magpie is English-only. */
		msg(key, fallback, params) {
			if (!params) return fallback;
			return String(fallback).replace(/\$(\d+)/g, (whole, index) => {
				const value = params[Number(index) - 1];
				return value === undefined ? whole : String(value);
			});
		},

		skippedFileMessages({ nonFree = 0, noUrl = 0, loaded = 0 } = {}) {
			const messages = [];
			if (nonFree > 0) {
				messages.push(loaded === 0
					? api.msg('f2c_non_free_only',
						'None of the $1 Flickr files found can be transferred: their licences are not accepted on Wikimedia Commons.',
						[nonFree])
					: api.msg('f2c_non_free_skipped',
						'$1 Flickr files were skipped because their licences are not accepted on Wikimedia Commons.',
						[nonFree]));
			}
			if (noUrl > 0) {
				messages.push(api.msg('f2c_no_usable_size_skipped',
					'$1 Flickr files were skipped because Flickr offers no downloadable image size for them.',
					[noUrl]));
			}
			return messages;
		},

		/* Flickr descriptions can contain HTML links and pipes; make them safe
		   inside an Information template. */
		sanitizeDescription(text) {
			if (!text) return '';
			return String(text)
				.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
					(whole, href, label) => {
						const clean = label.replace(/<[^>]+>/g, '').trim();
						return clean ? `[${href} ${clean}]` : `[${href}]`;
					})
				.replace(/\|/g, '{{!}}');
		},

		/* Names after "Speakers:" in re:publica-style descriptions. */
		extractSpeakerCategories(description) {
			const text = String(description || '')
				.replace(/<br\s*\/?\s*>/gi, '\n')
				.replace(/<[^>]*>/g, ' ')
				.replace(/[ \t]+/g, ' ')
				.replace(/ *\n+ */g, '\n')
				.trim();
			const categories = [];
			const seen = new Set();
			const boundary = String.raw`(?=\s*(?:[—–|•]|\n|(?:moderator|moderation|host|location|ort|date|datum|description|beschreibung|presented by)\s*:|(?:presented|presenting|präsentiert|präsentation|photo|foto|the re:publica|die re:publica)\b)|$)`;
			const speakerPattern = new RegExp(String.raw`\bSpeakers?\s*:\s*(.*?)${boundary}`, 'giu');
			for (const match of text.matchAll(speakerPattern)) {
				for (const rawName of match[1].split(/\s*[,;]\s*/)) {
					const name = api.normalizePersonName(rawName.replace(/^[\s—–|•-]+|[\s—–|•.,-]+$/g, ''));
					const key = name.toLocaleLowerCase();
					if (!name || seen.has(key)) continue;
					seen.add(key);
					categories.push(name);
				}
			}
			return categories;
		},

		normalizePersonName(name) {
			const particles = new Set(['da', 'de', 'del', 'der', 'di', 'du', 'la', 'le', 'van', 'von']);
			return String(name || '').trim().toLocaleLowerCase().split(/\s+/).map((word, index) => {
				if (index > 0 && particles.has(word)) return word;
				return word.replace(/(^|[-'’])\p{L}/gu, (match) => match.toLocaleUpperCase());
			}).join(' ');
		}
	};

	return api;
})();
