/* Flickr API helpers and the Commons description for a Flickr photo. */

window.Magpie = window.Magpie || {};

Magpie.flickr = {
	LICENSES: {
		'0': { free: false, name: 'All Rights Reserved' },
		'1': { free: false, name: 'CC BY-NC-SA 2.0' },
		'2': { free: false, name: 'CC BY-NC 2.0' },
		'3': { free: false, name: 'CC BY-NC-ND 2.0' },
		'4': { free: true, name: 'CC BY 2.0', template: 'Cc-by-2.0' },
		'5': { free: true, name: 'CC BY-SA 2.0', template: 'Cc-by-sa-2.0' },
		'6': { free: false, name: 'CC BY-ND 2.0' },
		'7': { free: true, name: 'No known copyright restrictions', template: 'Flickr-no known copyright restrictions' },
		'8': { free: true, name: 'United States government work', template: 'PD-USGov' },
		'9': { free: true, name: 'CC0 1.0', template: 'Cc-zero' },
		'10': { free: true, name: 'Public Domain Mark 1.0', template: 'PDM-1.0' }
	},

	parseUrl(text) {
		const match = String(text || '').match(/flickr\.com\/(?:photos|photo)\/([^\/\s]+)\/(\d+)/i);
		if (!match) return null;
		return { owner: match[1], id: match[2] };
	},

	async api(apiKey, method, params) {
		const query = new URLSearchParams(Object.assign({
			method: method,
			api_key: apiKey,
			format: 'json',
			nojsoncallback: '1'
		}, params || {}));
		const response = await fetch('https://api.flickr.com/services/rest/?' + query.toString());
		if (!response.ok) throw new Error('The Flickr API failed (' + response.status + ')');
		const answer = await response.json();
		if (answer.stat !== 'ok') throw new Error(answer.message || 'The Flickr API returned an error');
		return answer;
	},

	async photo(apiKey, id) {
		const info = (await this.api(apiKey, 'flickr.photos.getInfo', { photo_id: id })).photo;
		const sizes = (await this.api(apiKey, 'flickr.photos.getSizes', { photo_id: id })).sizes.size || [];
		const best = sizes.filter(function (size) { return size.media === 'photo'; })
			.sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); })[0];
		return { info: info, size: best };
	},

	license(id) {
		return this.LICENSES[String(id)] || { free: false, name: 'Unknown license (' + id + ')' };
	},

	fileName(title, id, url) {
		let name = String(title || '').trim();
		if (!name) name = 'Flickr ' + id;
		name = name.replace(/[\u0000-\u001f#<>\[\]{}|]/g, ' ').replace(/[:]/g, '-')
			.replace(/\s+/g, ' ').trim();
		if (!/\.[A-Za-z0-9]{2,5}$/.test(name)) {
			const match = String(url || '').match(/\.([A-Za-z0-9]{2,5})(?:\?|$)/);
			name += match ? '.' + match[1].toLowerCase() : '.jpg';
		}
		return Magpie.fileName(name.slice(0, 200));
	},

	description(photo, license, sourceUrl) {
		const info = photo.info || {};
		const title = (info.title && info.title._content) || '';
		const ownDescription = (info.description && info.description._content) || '';
		const owner = (info.owner && (info.owner.realname || info.owner.username)) || (info.owner && info.owner.nsid) || '';
		const ownerUrl = info.owner && info.owner.nsid ? 'https://www.flickr.com/people/' + info.owner.nsid : '';
		const taken = (info.dates && info.dates.taken) || '';
		const source = info.urls && info.urls.url && info.urls.url[0] && info.urls.url[0]._content;

		let description = '{{en|1=' + title + '}}';
		if (ownDescription) description += '<br/>' + ownDescription;

		let out = '== {{int:filedesc}} ==\n';
		out += '{{Information\n';
		out += '|Description=' + description + '\n';
		out += '|Date=' + taken + '\n';
		out += '|Source=' + (source ? '[' + source + ' ' + title + ']' : sourceUrl) + ' at Flickr\n';
		out += '|Author=' + (ownerUrl ? '[' + ownerUrl + ' ' + owner + ']' : owner) + '\n';
		out += '|Permission=\n';
		out += '|other_versions=\n';
		out += '}}\n';
		out += '{{FlickrReview}}\n';
		if (license.template) out += '{{' + license.template + '}}\n';
		out += '[[Category:Photographs]]\n';
		return out;
	}
};
