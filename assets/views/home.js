Magpie.Views = Magpie.Views || {};

Magpie.Views.home = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>Move files to Wikimedia Commons</h2>
			<p class="magpie-hint">Four tools share one login, one uploader, and one description format.</p>
			<div class="row">
				<div class="col-md-6" v-for="tool in tools" :key="tool.to">
					<div class="magpie-card">
						<h3><router-link :to="tool.to">{{ tool.name }}</router-link></h3>
						<p>{{ tool.description }}</p>
					</div>
				</div>
			</div>
		</div>
	</div>`,
	data() {
		return {
			tools: [
				{ to: '/flickr2commons/', name: 'Flickr2Commons', description: 'Batch-upload free Flickr photos, with duplicate checks.' },
				{ to: '/url2commons/', name: 'Url2Commons', description: 'Upload files from URLs, one or many at a time.' },
				{ to: '/geograph2commons/', name: 'Geograph2Commons', description: 'Transfer a Geograph photo with its description and coordinates.' },
				{ to: '/commonshelper/', name: 'CommonsHelper', description: 'Move a file from another wiki, translating its description and license.' }
			]
		};
	}
};
