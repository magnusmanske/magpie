Magpie.Views = Magpie.Views || {};

Magpie.Views.home = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>{{ t('magpie_home_heading') }}</h2>
			<p class="magpie-hint">{{ t('magpie_home_intro') }}</p>
			<div class="row">
				<div class="col-md-6" v-for="tool in tools" :key="tool.to">
					<div class="magpie-card">
						<h3><router-link :to="tool.to">{{ t(tool.name) }}</router-link></h3>
						<p>{{ t(tool.description) }}</p>
					</div>
				</div>
			</div>
		</div>
	</div>`,
	data() {
		return {
			tools: [
				{ to: '/flickr2commons/', name: 'magpie_tool_flickr2commons', description: 'magpie_tool_flickr2commons_desc' },
				{ to: '/url2commons/', name: 'magpie_tool_url2commons', description: 'magpie_tool_url2commons_desc' },
				{ to: '/geograph2commons/', name: 'magpie_tool_geograph2commons', description: 'magpie_tool_geograph2commons_desc' },
				{ to: '/commonshelper/', name: 'magpie_tool_commonshelper', description: 'magpie_tool_commonshelper_desc' }
			]
		};
	}
};
