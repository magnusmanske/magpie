Magpie.Views = Magpie.Views || {};

Magpie.Views.geograph2commons = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>{{ t('magpie_tool_geograph2commons') }}</h2>
			<p class="magpie-hint">{{ t('magpie_g2c_intro') }}</p>
			<div v-if="auth.checked && !auth.ok" class="magpie-card">
				<strong>{{ t('magpie_not_logged_in') }}</strong>
				<a :href="authorizeUrl">{{ t('magpie_login_to_upload') }}</a>
			</div>
			<div class="magpie-row">
				<div class="magpie-field">
					<label for="g2c-server">{{ t('magpie_server') }}</label>
					<select id="g2c-server" v-model="server" class="form-control">
						<option v-for="s in servers" :key="s" :value="s">{{ s }}</option>
					</select>
				</div>
				<div class="magpie-field">
					<label for="g2c-id">{{ t('magpie_photo_id') }}</label>
					<input id="g2c-id" v-model="photoId" class="form-control magpie-mono" inputmode="numeric">
				</div>
				<div class="magpie-field">
					<label for="g2c-name">{{ t('magpie_new_filename_optional') }}</label>
					<input id="g2c-name" v-model="newFilename" class="form-control">
				</div>
			</div>
			<div class="magpie-field">
				<label for="g2c-cats">{{ t('magpie_extra_categories') }}</label>
				<textarea id="g2c-cats" v-model="categories" rows="3" class="form-control"></textarea>
			</div>
			<div class="magpie-actions">
				<button class="btn btn-primary" :disabled="loading" @click="load">{{ t('magpie_load_photo') }}</button>
				<button class="btn btn-success" :disabled="!result || uploading" @click="upload">{{ t('magpie_upload') }}</button>
			</div>
			<p v-if="message" class="magpie-status magpie-error">{{ message }}</p>
		</div>

		<div class="magpie-card" v-if="result">
			<h3>{{ t('magpie_preview') }}</h3>
			<div class="magpie-field">
				<label>{{ t('magpie_file_name') }}</label>
				<input v-model="row.newfile" class="form-control">
			</div>
			<div class="magpie-field">
				<label>{{ t('description') }}</label>
				<textarea v-model="row.desc" rows="12" class="form-control magpie-mono"></textarea>
			</div>
			<p><a :href="row.sourceUrl" target="_blank" rel="noopener">{{ t('magpie_hires_image') }}</a></p>
			<p v-if="row.page" class="magpie-ok">{{ t('magpie_uploaded_at') }} <a :href="row.page" target="_blank">{{ row.page }}</a></p>
			<p v-else-if="row.message" class="magpie-status" :class="statusClass(row.status)">{{ row.message }}</p>
		</div>
	</div>`,
	data() {
		return {
			auth: Magpie.authState,
			authorizeUrl: Magpie.api.authorizeUrl(),
			servers: ['www.geograph.org.uk', 'www.geograph.ie', 'www.geograph.org.gg', 'geo.hlipp.de', 'geo-en.hlipp.de'],
			server: 'www.geograph.org.uk',
			photoId: '',
			categories: '',
			newFilename: '',
			loading: false,
			uploading: false,
			message: '',
			result: null,
			row: null
		};
	},
	mounted() {
		Magpie.refreshAuth();
		const params = new URLSearchParams(window.location.search);
		if (params.get('server') && this.servers.indexOf(params.get('server')) !== -1) this.server = params.get('server');
		if (params.get('photo_id')) this.photoId = params.get('photo_id');
		if (params.get('categories')) this.categories = params.get('categories');
		if (params.get('new_filename')) this.newFilename = params.get('new_filename');
		if (this.photoId) this.load();
	},
	methods: {
		statusClass(item) {
			return Magpie.statusClass(item.status);
		},
		async load() {
			this.message = '';
			this.result = null;
			const id = String(this.photoId).trim();
			if (!/^\d+$/.test(id)) {
				this.message = this.t('magpie_numeric_photo_id');
				return;
			}
			this.loading = true;
			try {
				const query = new URLSearchParams({ server: this.server, photo_id: id });
				const response = await fetch('/geograph2commons/g2c.php?' + query.toString());
				const data = await response.json();
				if (!data.main && !data.reuse && !data.api) throw new Error(this.t('magpie_could_not_load_photo', [id, this.server]));
				this.parse(id, data);
			} catch (error) {
				this.message = String(error.message || error);
			} finally {
				this.loading = false;
			}
		},
		parse(id, data) {
			const info = data.api || null;
			const main = new DOMParser().parseFromString(data.main || '', 'text/html');
			const reuse = new DOMParser().parseFromString(data.reuse || '', 'text/html');

			const textarea = reuse.querySelector('#wikipedia textarea');
			let description = textarea ? textarea.textContent.trim() : '';
			if (!description && info) description = this.apiDescription(info, id);
			if (!description) throw new Error(this.t('magpie_no_description_check_id'));

			description += '\n\n';
			String(this.categories || '').split('\n').forEach((category) => {
				category = category.trim();
				if (category) description += '[[Category:' + category + ']]\n';
			});
			description = description.trim().replace(/http:/g, 'https:');

			const titles = Array.from(reuse.querySelectorAll('h2 a'))
				.map((a) => a.textContent.trim()).filter(Boolean);
			let title = titles.length >= 2 ? titles[1] : (info && info.title ? String(info.title) : '');
			if (!title) throw new Error(this.t('magpie_no_title_check_id'));
			let name = title.replace(/'/g, '') + ' (geograph ' + id + ').jpg';
			name = name.replace(/ *[\/|]/g, ',').replace(/\s+/g, ' ').replace(/:/g, '-');

			// The reuse page's direct download link, the API's image, or the
			// photo page's displayed image. Never synthesise a reuse.php URL.
			const image = main.querySelector('#mainphoto img');
			const imageUrl = /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i;
			const licenceLinks = Array.from(reuse.querySelectorAll('a[rel="license"]'))
				.concat(Array.from(main.querySelectorAll('a[rel="license"]')));
			const about = licenceLinks
				.map((link) => link.getAttribute('about'))
				.find((value) => value && imageUrl.test(value));
			let hires = about || '';
			if (!hires && info && info.image) {
				try {
					hires = info.imgserver ? new URL(info.image, info.imgserver).href : String(info.image);
				} catch (error) {
					hires = String(info.image);
				}
			}
			if (!hires && image) hires = image.getAttribute('src') || '';
			if (hires && hires.indexOf('//') === 0) hires = 'https:' + hires;
			if (hires && hires.charAt(0) === '/' && hires.indexOf('//') !== 0) hires = 'https://' + this.server + hires;
			if (!hires) throw new Error(this.t('magpie_no_image_url'));

			const newfile = this.newFilename.trim() || name;
			this.newFilename = newfile;
			this.result = { id: id, server: this.server };
			this.row = {
				sourceUrl: hires,
				newfile: Magpie.fileName(newfile),
				desc: description,
				comment: 'Transferred from ' + this.server + ' using [https://geograph2commons.toolforge.org/ geograph2commons]',
				ignorewarnings: true,
				blockwarnings: '',
				status: 'ready',
				message: '',
				page: ''
			};
		},
		/* Used when Geograph's reuse page is behind a Cloudflare challenge. */
		apiDescription(info, id) {
			const clean = (value) => String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
			const parameter = (value) => clean(value).replace(/\|/g, '{{!}}');
			const title = parameter(info.title);
			const comment = parameter(info.comment);
			const author = parameter(info.realname) || 'unknown';
			const photoUrl = 'https://' + this.server + '/photo/' + id;
			const profile = info.profile_link
				? 'https://www.geograph.org.uk' + String(info.profile_link)
				: photoUrl;
			const description = [title, comment].filter(Boolean).join('<br/>');
			let wikitext = '== {{int:filedesc}} ==\n{{Information\n';
			wikitext += '|Description={{en|1=' + description + '}}\n';
			wikitext += '|Source=From [' + photoUrl + ' geograph.org.uk]\n';
			wikitext += '|Date=' + clean(info.taken) + '\n';
			wikitext += '|Author=[' + profile + ' ' + author + ']\n';
			wikitext += '|Permission=\n|Other fields=\n}}\n';
			const latitude = clean(info.wgs84_lat);
			const longitude = clean(info.wgs84_long);
			if (latitude && longitude) {
				wikitext += '{{Location dec|' + latitude + '|' + longitude + '|source:geograph}}\n';
			}
			wikitext += '\n== {{int:license-header}} ==\n{{geograph|' + id + '|' + author + '}}\n';
			return wikitext;
		},
		async upload() {
			if (!this.row) return;
			this.uploading = true;
			this.row.status = 'uploading';
			this.row.message = '';
			try {
				const result = await Magpie.api.uploadFromUrl(this.row);
				if (result.error && result.error !== 'OK') throw new Error(Magpie.uploadFailure(result));
				this.row.status = 'done';
				const uploaded = result.res && result.res.upload && result.res.upload.filename;
				this.row.page = Magpie.commonsPage(uploaded || this.row.newfile);
				this.row.message = this.t('magpie_uploaded');
			} catch (error) {
				this.row.status = 'error';
				this.row.message = String(error.message || error);
			} finally {
				this.uploading = false;
			}
		}
	}
};
