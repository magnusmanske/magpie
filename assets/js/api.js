/* The shared upload API. All tools use these calls. */

window.Magpie = window.Magpie || {};

Magpie.api = {
	async post(params) {
		const body = new URLSearchParams();
		Object.keys(params).forEach(function (key) {
			if (params[key] !== undefined && params[key] !== null) body.append(key, params[key]);
		});
		const response = await fetch('/api.php?rand=' + Math.random(), {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
			body: body.toString()
		});
		if (!response.ok) throw new Error('The API failed (' + response.status + ')');
		return response.json();
	},

	async get(params) {
		const query = new URLSearchParams(params).toString();
		const response = await fetch('/api.php?' + query, { credentials: 'same-origin' });
		if (!response.ok) throw new Error('The API failed (' + response.status + ')');
		return response.json();
	},

	authorizeUrl() { return '/api.php?action=authorize'; },
	logoutUrl() { return '/api.php?action=logout'; },

	async getRights() {
		return Magpie.api.get({ action: 'get_rights', botmode: '1', site: 'commons.wikimedia.org' });
	},

	async checkAuth() {
		return Magpie.api.get({ action: 'checkauth', botmode: '1' });
	},

	async uploadFromUrl(options) {
		return Magpie.api.post({
			action: 'upload_from_url',
			botmode: '1',
			site: options.site || 'commons.wikimedia.org',
			url: options.url,
			newfile: options.newfile,
			desc: options.desc,
			comment: options.comment,
			ignorewarnings: options.ignorewarnings ? '1' : '',
			blockwarnings: options.blockwarnings || ''
		});
	},

	async setPageText(page, text, site, summary, basetimestamp) {
		return Magpie.api.post({
			action: 'setpagetext',
			botmode: '1',
			site: site || '',
			page: page,
			text: text,
			summary: summary || '',
			basetimestamp: basetimestamp || ''
		});
	},

	/* Flickr2Commons bookkeeping. */
	async flickrKey() {
		return Magpie.api.get({ action: 'get_flickr_key' });
	},

	async flickrExisting(filenames) {
		return Magpie.api.post({ action: 'check_existing_commons_filenames', filenames: JSON.stringify(filenames) });
	},

	async flickrInCommons(data) {
		return Magpie.api.post({ action: 'check_flickr_files_in_commons', data: JSON.stringify(data) });
	}
};
