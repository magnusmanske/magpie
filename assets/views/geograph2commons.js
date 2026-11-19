Magpie.Views = Magpie.Views || {};

Magpie.Views.geograph2commons = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>Geograph2Commons</h2>
			<p class="magpie-hint">Transfer a photo from Geograph with its description and reuse terms.</p>
			<div v-if="auth.checked && !auth.ok" class="magpie-card">
				<strong>You are not logged in.</strong>
				<a :href="authorizeUrl">Log in with OAuth</a> to upload under your own Commons account.
			</div>
			<div class="magpie-row">
				<div class="magpie-field">
					<label for="g2c-server">Server</label>
					<select id="g2c-server" v-model="server" class="form-control">
						<option v-for="s in servers" :key="s" :value="s">{{ s }}</option>
					</select>
				</div>
				<div class="magpie-field">
					<label for="g2c-id">Photo ID</label>
					<input id="g2c-id" v-model="photoId" class="form-control magpie-mono" inputmode="numeric">
				</div>
				<div class="magpie-field">
					<label for="g2c-name">New file name (optional)</label>
					<input id="g2c-name" v-model="newFilename" class="form-control">
				</div>
			</div>
			<div class="magpie-field">
				<label for="g2c-cats">Extra categories, one per line</label>
				<textarea id="g2c-cats" v-model="categories" rows="3" class="form-control"></textarea>
			</div>
			<div class="magpie-actions">
				<button class="btn btn-primary" :disabled="loading" @click="load">Load photo</button>
				<button class="btn btn-success" :disabled="!result || uploading" @click="upload">Upload</button>
			</div>
			<p v-if="message" class="magpie-status magpie-error">{{ message }}</p>
		</div>

		<div class="magpie-card" v-if="result">
			<h3>Preview</h3>
			<div class="magpie-field">
				<label>File name</label>
				<input v-model="row.newfile" class="form-control">
			</div>
			<div class="magpie-field">
				<label>Description</label>
				<textarea v-model="row.desc" rows="12" class="form-control magpie-mono"></textarea>
			</div>
			<p><a :href="row.sourceUrl" target="_blank" rel="noopener">Hi-res image</a></p>
			<p v-if="row.page" class="magpie-ok">Uploaded: <a :href="row.page" target="_blank">{{ row.page }}</a></p>
			<p v-else-if="row.message" class="magpie-status" :class="statusClass(row.status)">{{ row.message }}</p>
		</div>
	</div>`,
	data() {
		return {
			auth: Magpie.authState,
			authorizeUrl: Magpie.api.authorizeUrl(),
			servers: ['www.geograph.org.uk', 'www.geograph.ie', 'www.geograph.org.gg', 'geo-en.hlipp.de'],
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
				this.message = 'Please enter a numeric photo ID.';
				return;
			}
			this.loading = true;
			try {
				const query = new URLSearchParams({ server: this.server, photo_id: id });
				const response = await fetch('/geograph2commons/g2c.php?' + query.toString());
				const data = await response.json();
				if (!data.main || !data.reuse) throw new Error('Could not load photo ' + id + ' from ' + this.server);
				this.parse(id, data);
			} catch (error) {
				this.message = String(error.message || error);
			} finally {
				this.loading = false;
			}
		},
		parse(id, data) {
			const main = new DOMParser().parseFromString(data.main, 'text/html');
			const reuse = new DOMParser().parseFromString(data.reuse, 'text/html');

			const textarea = reuse.querySelector('#wikipedia textarea');
			let description = textarea ? textarea.textContent : '';
			if (!description.trim()) throw new Error('Could not get a description; check the photo ID.');

			description = description.trim() + '\n\n';
			String(this.categories || '').split('\n').forEach((category) => {
				category = category.trim();
				if (category) description += '[[Category:' + category + ']]\n';
			});
			description = description.trim().replace(/http:/g, 'https:');

			const titles = Array.from(reuse.querySelectorAll('h2 a'))
				.map((a) => a.textContent.trim()).filter(Boolean);
			if (titles.length < 2) throw new Error('Could not get a title; check the photo ID.');
			let name = titles[1].replace(/'/g, '') + ' (geograph ' + id + ').jpg';
			name = name.replace(/ *[\/|]/g, ',').replace(/\s+/g, ' ').replace(/:/g, '-');

			const image = main.querySelector('#mainphoto img');
			let hires = image ? image.getAttribute('src') : '';
			reuse.querySelectorAll('a[rel="license"]').forEach((link) => {
				const about = link.getAttribute('about');
				if (!about) return;
				const match = about.match(/\/\d+_([0-9a-f]+)\.jpg/);
				if (match) {
					hires = 'https://' + this.server + '/reuse.php?id=' + id + '&download=' + match[1] + '&size=largest';
				}
			});
			if (hires && hires.indexOf('//') === 0) hires = 'https:' + hires;
			if (hires && hires.charAt(0) === '/' && hires.indexOf('//') !== 0) hires = 'https://' + this.server + hires;
			if (!hires) throw new Error('Could not find the image URL.');

			const newfile = this.newFilename.trim() || name;
			this.newFilename = newfile;
			this.result = { id: id, server: this.server };
			this.row = {
				sourceUrl: hires,
				newfile: Magpie.fileName(newfile),
				desc: description,
				comment: 'Transferred from ' + this.server + ' using magpie',
				ignorewarnings: true,
				blockwarnings: '',
				status: 'ready',
				message: '',
				page: ''
			};
		},
		async upload() {
			if (!this.row) return;
			this.uploading = true;
			this.row.status = 'uploading';
			this.row.message = '';
			try {
				const result = await Magpie.api.uploadFromUrl(this.row);
				if (result.error && result.error !== 'OK') throw new Error(result.error);
				this.row.status = 'done';
				this.row.page = Magpie.commonsPage(this.row.newfile);
				this.row.message = 'Uploaded';
			} catch (error) {
				this.row.status = 'error';
				this.row.message = String(error.message || error);
			} finally {
				this.uploading = false;
			}
		}
	}
};
