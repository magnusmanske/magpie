Magpie.Views = Magpie.Views || {};

Magpie.Views.flickr2commons = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>Flickr2Commons</h2>
			<p class="magpie-hint">Paste Flickr photo URLs (one per line). Free licenses are selected automatically;
				non-free photos cannot be uploaded. New file names and descriptions can be edited before uploading.</p>
			<div v-if="auth.checked && !auth.ok" class="magpie-card">
				<strong>You are not logged in.</strong>
				<a :href="authorizeUrl">Log in with OAuth</a> to upload under your own Commons account.
			</div>
			<div v-if="keyStatus" class="magpie-error">{{ keyStatus }}</div>
			<div class="magpie-field">
				<label for="f2c-urls">Flickr URLs or photo IDs</label>
				<textarea id="f2c-urls" v-model="urls" rows="5" class="form-control magpie-mono"></textarea>
			</div>
			<div class="magpie-actions">
				<button class="btn btn-primary" :disabled="loading || !apiKey" @click="add">Add photos</button>
				<button class="btn btn-outline-secondary" :disabled="!rows.length || checking" @click="checkCommons">Check Commons</button>
				<button class="btn btn-outline-secondary" :disabled="!rows.length || checking" @click="checkNames">Check file names</button>
				<button class="btn btn-success" :disabled="uploader.busy || !rows.length" @click="upload">Upload selected</button>
				<button class="btn btn-outline-secondary" :disabled="!uploader.busy" @click="uploader.stop">Stop</button>
				<label class="magpie-check"><input type="checkbox" v-model="ignorewarnings"> Ignore warnings</label>
			</div>
			<p v-if="message" class="magpie-status magpie-error">{{ message }}</p>
		</div>

		<div class="magpie-card" v-if="rows.length">
			<h3>Photos</h3>
			<table class="magpie-table">
				<thead>
					<tr><th></th><th>File on Commons</th><th>Title / license</th><th>Checks</th><th>Status</th></tr>
				</thead>
				<tbody>
					<tr v-for="(row, index) in rows" :key="row.id">
						<td><input type="checkbox" v-model="row.selected" :disabled="!row.license.free"></td>
						<td>
							<input v-model="row.newfile" class="form-control magpie-mono">
							<a :href="row.flickrUrl" target="_blank" rel="noopener" class="magpie-hint">{{ row.id }}</a>
						</td>
						<td>
							<div>{{ row.title }}</div>
							<div class="magpie-badge" :class="row.license.free ? 'magpie-ok' : 'magpie-error'">
								{{ row.license.name }}
							</div>
						</td>
						<td class="magpie-status">
							<div v-if="row.onCommons">On Commons: <a :href="commonsPage(row.onCommons)" target="_blank">{{ row.onCommons }}</a></div>
							<div v-if="row.exists === 1" class="magpie-error">Name is used</div>
							<div v-else-if="row.exists === 2" class="magpie-error">Name was deleted before</div>
							<div v-else-if="row.exists === 0" class="magpie-ok">Name is free</div>
							<details>
								<summary class="magpie-hint">Description</summary>
								<textarea v-model="row.desc" rows="8" class="form-control magpie-mono"></textarea>
							</details>
						</td>
						<td class="magpie-status" :class="statusClass(row.status)">
							<span v-if="row.page"><a :href="row.page" target="_blank">Uploaded</a></span>
							<span v-else>{{ row.message || row.status }}</span>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>`,
	data() {
		return {
			auth: Magpie.authState,
			authorizeUrl: Magpie.api.authorizeUrl(),
			apiKey: '',
			keyStatus: '',
			urls: '',
			rows: [],
			loading: false,
			checking: false,
			ignorewarnings: true,
			message: '',
			uploader: Magpie.makeUploader(() => this.rows.map((row) => Object.assign(row, {
				skip: !row.selected || !row.license.free,
				blockwarnings: '1',
				comment: 'Transferred from Flickr using magpie'
			})))
		};
	},
	mounted() {
		Magpie.refreshAuth();
		this.loadKey();
	},
	methods: {
		statusClass(status) {
			return Magpie.statusClass(status);
		},
		commonsPage(name) {
			return Magpie.commonsPage(name);
		},
		async loadKey() {
			try {
				const result = await Magpie.api.flickrKey();
				if (result.status === 'OK' && result.data) this.apiKey = result.data;
				else this.keyStatus = result.status || 'The Flickr API key is not configured.';
			} catch (error) {
				this.keyStatus = String(error.message || error);
			}
		},
		async add() {
			this.message = '';
			if (!this.apiKey) {
				this.message = 'The Flickr API key is not configured.';
				return;
			}
			const seen = {};
			this.rows.forEach((row) => { seen[row.id] = true; });
			const added = [];
			String(this.urls || '').split('\n').forEach((line) => {
				line = line.trim();
				if (!line) return;
				const parsed = Magpie.flickr.parseUrl(line);
				const id = parsed ? parsed.id : (line.match(/^\d+$/) ? line : null);
				if (!id || seen[id]) return;
				seen[id] = true;
				const row = {
					flickrUrl: parsed ? line : 'https://www.flickr.com/photo.gne?id=' + id,
					id: id,
					title: '',
					newfile: '',
					sourceUrl: '',
					desc: '',
					license: { free: false, name: 'Unknown' },
					onCommons: '',
					exists: null,
					selected: false,
					status: 'loading',
					message: '',
					page: ''
				};
				this.rows.push(row);
				added.push(row);
			});
			this.urls = '';
			this.loading = true;
			try {
				for (const row of added) {
					await this.loadPhoto(row);
				}
			} finally {
				this.loading = false;
			}
		},
		async loadPhoto(row) {
			try {
				const photo = await Magpie.flickr.photo(this.apiKey, row.id);
				const info = photo.info;
				const license = Magpie.flickr.license(info.license);
				row.title = (info.title && info.title._content) || '';
				row.license = license;
				row.sourceUrl = photo.size ? (photo.size.source || photo.size.url) : '';
				row.newfile = Magpie.flickr.fileName(row.title, row.id, photo.size && photo.size.url);
				row.desc = Magpie.flickr.description(photo, license, row.flickrUrl);
				row.selected = license.free;
				row.status = 'ready';
				row.message = license.free ? '' : 'Not a free license; cannot be uploaded';
			} catch (error) {
				row.status = 'error';
				row.message = String(error.message || error);
			}
		},
		async checkCommons() {
			this.message = '';
			this.checking = true;
			try {
				const owners = {};
				const files = {};
				this.rows.forEach((row) => {
					const parsed = Magpie.flickr.parseUrl(row.flickrUrl);
					const owner = parsed ? parsed.owner : row.id;
					owners[owner] = [owner];
					files[owner] = files[owner] || [];
					files[owner].push(row.id);
				});
				const result = await Magpie.api.flickrInCommons({ owners: owners, files: files });
				if (result.status !== 'OK') throw new Error(result.status);
				const found = (result.data && result.data.files) || {};
				this.rows.forEach((row) => { row.onCommons = found[row.id] || ''; });
			} catch (error) {
				this.message = String(error.message || error);
			} finally {
				this.checking = false;
			}
		},
		async checkNames() {
			this.message = '';
			this.checking = true;
			try {
				const names = this.rows.map((row) => row.newfile);
				const result = await Magpie.api.flickrExisting(names);
				if (result.status !== 'OK') throw new Error(result.status);
				const status = (result.data && result.data.files) || {};
				this.rows.forEach((row) => {
					const key = Magpie.fileName(row.newfile);
					row.exists = status[key] === undefined ? 0 : status[key];
				});
			} catch (error) {
				this.message = String(error.message || error);
			} finally {
				this.checking = false;
			}
		},
		upload() {
			this.message = '';
			if (!this.auth.ok) {
				this.message = 'Please log in first.';
				return;
			}
			this.uploader.run();
		}
	}
};
