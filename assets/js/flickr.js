/* Flickr API helpers and the Commons description for a Flickr photo. */

window.Magpie = window.Magpie || {};

Magpie.flickr = (function () {
	const FLINFO = 'https://fist.toolforge.org/file_candidates/flinfo_proxy.php';
	const FLICKR_EXTRAS = 'description,license,date_taken,geo,tags,url_o,url_l,url_m,url_q,url_s,path_alias,original_format';

	/* Flickr licence IDs accepted on Commons: */
	const FREE_LICENSE_IDS = new Set(['4', '5', '7', '8', '9', '10', '11', '12']);

	const LICENSES = {
		'0': { free: false, name: 'All Rights Reserved' },
		'1': { free: false, name: 'CC BY-NC-SA 2.0' },
		'2': { free: false, name: 'CC BY-NC 2.0' },
		'3': { free: false, name: 'CC BY-NC-ND 2.0' },
		'4': { free: true, name: 'CC BY 2.0', template: 'Cc-by-2.0' },
		'5': { free: true, name: 'CC BY-SA 2.0', template: 'Cc-by-sa-2.0' },
		'6': { free: false, name: 'CC BY-ND 2.0' },
		'7': { free: true, name: 'No known copyright restrictions', template: 'Flickr-no known copyright restrictions' },
		'8': { free: true, name: 'United States Government Work', template: 'PD-USGov' },
		'9': { free: true, name: 'CC0', template: 'Cc-zero' },
		'10': { free: true, name: 'Public Domain Mark', template: 'Flickr-public domain mark' },
		'11': { free: true, name: 'CC BY 4.0', template: 'Cc-by-4.0' },
		'12': { free: true, name: 'CC BY-SA 4.0', template: 'Cc-by-sa-4.0' }
	};

	const LICENSE_TEMPLATES = {};
	Object.keys(LICENSES).forEach((id) => {
		if (LICENSES[id].template) LICENSE_TEMPLATES[id] = LICENSES[id].template;
	});

	/* Flickr's generic public-domain markers; Commons needs a specific reason. */
	const GENERIC_PD_LICENSE_IDS = new Set(['7', '10']);

	const FLICKR_BASE58 = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

	const userInfoCache = new Map();

	function text(value) {
		if (value == null) return '';
		if (typeof value === 'object' && '_content' in value) return String(value._content);
		return String(value);
	}

	function plain(value) {
		return text(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	}

	/* Flickr thumbnails are blocked by the CSP's default-src; proxy them.
	   Never return an empty or non-web URL: an empty <img src> is resolved by
	   the browser and can turn into a file:// request. */
	function thumbnailUrl(raw) {
		if (!raw) return '';
		try {
			const url = new URL(raw, window.location.href);
			if (url.protocol === 'https:' && url.hostname.endsWith('.staticflickr.com')) {
				return '/api.php?action=flickr_thumb&url=' + encodeURIComponent(url.href);
			}
			if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'data:') {
				return url.href;
			}
		} catch (error) {
			/* not a usable URL */
		}
		return '';
	}

	function decodeBase58(code) {
		let number = 0n;
		for (const character of code) {
			const digit = FLICKR_BASE58.indexOf(character);
			if (digit < 0) return null;
			number = number * 58n + BigInt(digit);
		}
		return number.toString();
	}

	/* Flickr is not in the Toolforge CSP, so reads go through magpie's own API.
	   The key stays on the server. */
	async function api(_apiKey, method, params) {
		const answer = await Magpie.api.post({
			action: 'flickr_api',
			params: JSON.stringify(Object.assign({ method: method }, params || {}))
		});
		if (answer.stat !== 'ok') throw new Error(answer.message || 'The Flickr API returned an error');
		return answer;
	}

	async function fetchJSON(url, params) {
		const target = new URL(url);
		Object.keys(params || {}).forEach((key) => target.searchParams.set(key, params[key]));
		const response = await fetch(target);
		if (!response.ok) throw new Error('HTTP ' + response.status);
		return response.json();
	}

	const flickr = {
		LICENSES,
		GENERIC_PD_LICENSE_IDS,

		decodeBase58,
		text,
		plain,
		thumbnailUrl,

		isFree(id) {
			return FREE_LICENSE_IDS.has(String(id));
		},

		async info(apiKey, id) {
			return (await api(apiKey, 'flickr.photos.getInfo', { photo_id: id })).photo;
		},

		async sizes(apiKey, id) {
			return (await api(apiKey, 'flickr.photos.getSizes', { photo_id: id })).sizes;
		},

		async photoTags(apiKey, id) {
			try {
				const data = await api(apiKey, 'flickr.tags.getListPhoto', { photo_id: id });
				return (data.photo && data.photo.tags && data.photo.tags.tag) || [];
			} catch (error) {
				return [];
			}
		},

		async userInfo(apiKey, nsid) {
			if (userInfoCache.has(nsid)) return userInfoCache.get(nsid);
			const request = (async () => {
				try {
					const data = await api(apiKey, 'flickr.people.getInfo', { user_id: nsid });
					return data.person;
				} catch (error) {
					return undefined;
				}
			})();
			userInfoCache.set(nsid, request);
			return request;
		},

		async sourceInfo(apiKey, type, id) {
			const requests = {
				user: { method: 'flickr.people.getInfo', user_id: id },
				photoset: { method: 'flickr.photosets.getInfo', photoset_id: id },
				group: { method: 'flickr.groups.getInfo', group_id: id },
				photo: { method: 'flickr.photos.getInfo', photo_id: id }
			};
			if (!requests[type]) return undefined;
			try {
				const data = await api(apiKey, requests[type].method, requests[type]);
				return data.person || data.photoset || data.group || data.photo;
			} catch (error) {
				return undefined;
			}
		},

		async resolveUsername(apiKey, user) {
			try {
				const data = await api(apiKey, 'flickr.people.findByUsername', { username: user });
				if (data.user && data.user.nsid) return data.user.nsid;
			} catch (error) {
				/* fall through */
			}
			return user;
		},

		/* Resolve a path alias via flickr.urls.lookupUser. */
		async lookupUserByAlias(apiKey, name) {
			if (/@/.test(name)) return null;
			try {
				const data = await api(apiKey, 'flickr.urls.lookupUser', {
					url: 'https://www.flickr.com/photos/' + encodeURIComponent(name) + '/'
				});
				return data.user && data.user.id ? data.user.id : null;
			} catch (error) {
				return null;
			}
		},

		async resolveGroupName(apiKey, group) {
			try {
				const data = await api(apiKey, 'flickr.groups.getInfo', { group_path_alias: group });
				if (data.group && data.group.nsid) return data.group.nsid;
			} catch (error) {
				/* fall through */
			}
			try {
				const data = await api(apiKey, 'flickr.groups.getInfo', { group_id: group });
				if (data.group && data.group.nsid) return data.group.nsid;
			} catch (error) {
				/* fall through */
			}
			return group;
		},

		/* Fetch all pages of a Flickr listing. Only free licences are returned;
		   the array carries skipped_non_free / skipped_no_url counts. */
		async search(apiKey, params, maxPics, tags, onProgress) {
			const limit = maxPics > 0 ? maxPics : 999999999;
			const results = [];
			const resultKey = params.result_key;
			let skippedNonFree = 0;
			let skippedNoUrl = 0;

			const fetchPage = async (page) => {
				const request = Object.assign({}, params, {
					per_page: Math.min(limit, 500),
					page: page,
					extras: FLICKR_EXTRAS
				});
				if (tags) {
					request.tags = tags;
					request.tag_mode = 'all';
				}
				const data = await api(apiKey, request.method, request);
				const container = data[resultKey];
				if (!container) throw new Error('The Flickr API returned no ' + resultKey);
				const rawOwner = container.owner;
				const owner = typeof rawOwner === 'object'
					? (rawOwner && (rawOwner.nsid || text(rawOwner)))
					: rawOwner;
				const ownerName = text(container.ownername);
				let done = false;
				for (const photo of container.photo || []) {
					if (!photo.owner && owner) photo.owner = owner;
					if (!photo.ownername && ownerName) photo.ownername = ownerName;
					if (!flickr.isFree(photo.license)) {
						skippedNonFree++;
						continue;
					}
					photo.url_best = photo.url_o || photo.url_l || photo.url_m;
					if (!photo.url_best) {
						skippedNoUrl++;
						continue;
					}
					results.push(photo);
					if (results.length >= limit) {
						done = true;
						break;
					}
				}
				return { pages: Number(container.pages) || 1, done: done };
			};

			const first = await fetchPage(1);
			if (onProgress) onProgress({ page: 1, pages: first.pages, so_far: results.length });

			if (!first.done && first.pages > 1) {
				const remaining = [];
				for (let page = 2; page <= first.pages; page++) remaining.push(page);
				await Promise.all(remaining.map(async (page) => {
					if (results.length >= limit) return;
					await fetchPage(page);
					if (onProgress) onProgress({ page: page, pages: first.pages, so_far: results.length });
				}));
			}

			results.skipped_non_free = skippedNonFree;
			results.skipped_no_url = skippedNoUrl;
			return results;
		},

		/* Port of the old name generator: title, photo ID, original format. */
		generateFilename(file, defaultPrefix) {
			let title = plain(file.title)
				.replace(/_/g, ' ')
				.replace(/[:/|]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
				.replace(/\.(JPG|JPEG|PNG|TIF|TIFF)$/i, '');
			if (title.length > 230) title = title.substring(0, 230);
			if (title.trim() === '') title = defaultPrefix || 'Unnamed Flickr file';
			const format = String(file.originalformat || 'jpg').toLowerCase();
			return (title + ' (' + file.id + ').' + format).trim();
		},

		async suggestedCategories(photoId) {
			const data = await fetchJSON(FLINFO, {
				id: photoId,
				raw: 'on',
				repo: 'flickr',
				format: 'json'
			});
			if (!data.wiki || data.wiki.status !== 0) throw new Error('Could not load category suggestions');
			return (data.wiki.categories || [])
				.map((category) => String(category).replace(/^Category:/i, '').trim())
				.filter(Boolean);
		},

		/* Ask flinfo for a Commons Information template. Returns {template} or
		   {error}; the caller can fall back to a locally built template. */
		async informationTemplate(photoId, newDesc, autoCategories) {
			const data = await fetchJSON(FLINFO, {
				id: photoId,
				raw: 'on',
				repo: 'flickr',
				categories: ' ',
				format: 'json'
			});
			if (!data.wiki || data.wiki.status !== 0) {
				const status = data.wiki && data.wiki.status;
				const errors = {
					1: 'Flinfo server failure. Try again.',
					3: 'Flinfo internal error.',
					4: "Flinfo says 'bad user'.",
					5: "Flinfo says 'invalid ID'.",
					6: "Flinfo says 'missing ID'."
				};
				return { error: errors[status] || 'FLinfo issue: ' + status };
			}

			const info = data.wiki.info || {};
			const finalDesc = (newDesc && newDesc !== '') ? newDesc : (info.desc || '');
			let wikitext = '== {{int:filedesc}} ==\n';
			wikitext += '{{Information\n';
			wikitext += '| Description = ' + finalDesc + '\n';
			wikitext += '| Source      = ' + (info.source || '') + '\n';
			wikitext += '| Date        = ' + (info.date || '') + '\n';
			wikitext += '| Author      = ' + (info.author || '') + '\n';
			wikitext += '| Permission  = ' + (info.permission || '') + '\n';
			wikitext += '| other_versions=\n';
			wikitext += '}}\n';

			const geo = data.wiki.geolocation;
			if (geo && geo.latitude !== undefined) {
				wikitext += '{{Location dec|' + geo.latitude + '|' + geo.longitude + '|source:' + geo.source + '}}\n';
			}

			wikitext += '\n=={{int:license-header}}==\n';
			for (const licence of data.wiki.licenses || []) wikitext += '{{' + licence + '}}\n';
			wikitext += '{{Flickrreview}}\n';

			if (autoCategories === undefined || autoCategories) {
				wikitext += '\n';
				for (const category of data.wiki.categories || []) wikitext += '[[' + category + ']]\n';
			}

			return { template: wikitext.trim() };
		},

		/* Locally built fallback if flinfo is unreachable. */
		fallbackTemplate(file, description) {
			const owner = file.path_alias || file.owner || '';
			const page = file.page || (owner
				? 'https://www.flickr.com/photos/' + owner + '/' + file.id + '/'
				: 'https://www.flickr.com/photo.gne?id=' + file.id);
			const sourceTitle = plain(file.title).replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
			const source = sourceTitle ? '[' + page + ' ' + sourceTitle + ']' : page;
			const authorName = file.owner_realname || file.ownername || owner;
			const author = authorName
				? '[https://www.flickr.com/photos/' + owner + '/ ' + authorName + ']'
				: '';
			const date = file.datetaken || file.date_taken || '';
			const licence = LICENSE_TEMPLATES[String(file.license)] || '';
			let wikitext = '== {{int:filedesc}} ==\n';
			wikitext += '{{Information\n';
			wikitext += '| Description = ' + description + '\n';
			wikitext += '| Source      = ' + source + '\n';
			wikitext += '| Date        = ' + date + '\n';
			wikitext += '| Author      = ' + author + '\n';
			wikitext += '| Permission  =\n';
			wikitext += '| other_versions=\n';
			wikitext += '}}\n';
			if (licence) {
				wikitext += '\n=={{int:license-header}}==\n{{' + licence + '}}\n';
				wikitext += '{{Flickrreview}}\n';
			}
			return wikitext.trim();
		}
	};

	return flickr;
})();
