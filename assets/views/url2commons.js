Magpie.Views = Magpie.Views || {};

Magpie.Views.url2commons = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>Url2Commons</h2>
			<p class="magpie-hint">Enter one URL per line. After the URL, an optional file name.
				After <span class="magpie-mono">|</span>, an optional description for
				<span class="magpie-mono">$DESCRIPTOR$</span>.</p>
			<div v-if="auth.checked && !auth.ok" class="magpie-card">
				<strong>You are not logged in.</strong>
				<a :href="authorizeUrl">Log in with OAuth</a> to upload under your own Commons account.
			</div>
			<div class="magpie-field">
				<label for="u2c-urls">URLs</label>
				<textarea id="u2c-urls" v-model="urls" rows="6" class="form-control magpie-mono"></textarea>
			</div>
			<div class="magpie-field">
				<label for="u2c-desc">Description template</label>
				<textarea id="u2c-desc" v-model="description" rows="9" class="form-control magpie-mono"></textarea>
			</div>
			<div class="magpie-row">
				<label class="magpie-check"><input type="checkbox" v-model="ignorewarnings"> Ignore warnings</label>
				<button class="btn btn-primary" :disabled="uploader.busy" @click="run">Upload</button>
				<button class="btn btn-outline-secondary" :disabled="!uploader.busy" @click="uploader.stop">Stop</button>
			</div>
			<p v-if="message" class="magpie-status magpie-error">{{ message }}</p>
		</div>

		<div class="magpie-card" v-if="items.length">
			<h3>Files</h3>
			<table class="magpie-table">
				<thead><tr><th>File</th><th>Source</th><th>Status</th></tr></thead>
				<tbody>
					<tr v-for="(item, index) in items" :key="index">
						<td class="magpie-mono">{{ item.newfile }}</td>
						<td class="url">{{ item.sourceUrl }}</td>
						<td class="magpie-status" :class="statusClass(item)">
							<span v-if="item.page"><a :href="item.page" target="_blank">Uploaded</a></span>
							<span v-else>{{ item.message || item.status }}</span>
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
			urls: '',
			description: '=={{int:filedesc}}==\n{{Information\n| Description    = {{en|$DESCRIPTOR$}}\n| Date           =\n| Source         = $URL$\n| Author         =\n| Permission     =\n| Other_versions =\n}}\n\n[[Category:]]',
			ignorewarnings: true,
			items: [],
			message: '',
			uploader: Magpie.makeUploader(() => this.items)
		};
	},
	mounted() {
		Magpie.refreshAuth();
	},
	methods: {
		statusClass(item) {
			return Magpie.statusClass(item.status);
		},
		guessName(url) {
			try {
				const path = new URL(url).pathname;
				const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
				return last || 'File';
			} catch (e) {
				return 'File';
			}
		},
		run() {
			const lines = Magpie.parseUrlLines(this.urls);
			this.message = '';
			if (!lines.length) {
				this.message = 'Please enter at least one URL.';
				return;
			}
			this.items = lines.map((line) => {
				const descriptor = line.descriptor || this.guessName(line.url);
				const name = line.name || this.guessName(line.url);
				return {
					sourceUrl: line.url,
					newfile: Magpie.fileName(name),
					desc: Magpie.fillDescription(this.description, { url: line.url, descriptor: descriptor }),
					comment: 'Transferred from ' + line.url + ' using magpie',
					ignorewarnings: this.ignorewarnings,
					blockwarnings: '',
					status: 'ready',
					message: '',
					page: ''
				};
			});
			this.uploader.run();
		}
	}
};
