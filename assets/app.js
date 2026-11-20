/* The one Vue application: shared navigation, one router, four views. */

window.Magpie = window.Magpie || {};

Magpie.authState = Vue.observable({ checked: false, ok: false, error: '' });

/* Every component gets t(key[, params]) from the Tooltranslate snapshots. */
Vue.mixin({
	methods: {
		t(key, params) { return Magpie.t(key, params); }
	}
});

Magpie.refreshAuth = async function () {
	try {
		const result = await Magpie.api.checkAuth();
		Magpie.authState.ok = !result.error || result.error === 'OK';
		Magpie.authState.error = Magpie.authState.ok ? '' : (result.error || Magpie.t('magpie_not_logged_in'));
	} catch (error) {
		Magpie.authState.ok = false;
		Magpie.authState.error = String(error.message || error);
	} finally {
		Magpie.authState.checked = true;
	}
};

Vue.component('magpie-shell', {
	template: `
	<div class="magpie-shell">
		<header class="magpie-header">
			<router-link to="/" class="magpie-brand"><img class="magpie-icon" src="/assets/img/magpie.jpg" width="128" height="128" alt="" title="Eurasian magpie by Alexis Lours, CC BY 4.0"> magpie</router-link>
			<nav class="magpie-nav">
				<router-link to="/flickr2commons/">{{ t('magpie_tool_flickr2commons') }}</router-link>
				<router-link to="/url2commons/">{{ t('magpie_tool_url2commons') }}</router-link>
				<router-link to="/geograph2commons/">{{ t('magpie_tool_geograph2commons') }}</router-link>
				<router-link to="/commonshelper/">{{ t('magpie_tool_commonshelper') }}</router-link>
			</nav>
			<label class="magpie-language">
				<span>{{ t('magpie_language') }}</span>
				<select :value="i18n.language" @change="changeLanguage">
					<option v-for="code in i18n.available" :key="code" :value="code">{{ languageName(code) }}</option>
				</select>
			</label>
			<div class="magpie-auth">
				<span v-if="auth.checked && auth.ok" class="magpie-ok">{{ t('magpie_logged_in') }}</span>
				<template v-else-if="auth.checked">
					<a :href="loginUrl" @click="rememberRouteForLogin">{{ t('magpie_log_in_oauth') }}</a>
					<span v-if="auth.error" class="magpie-hint"> ({{ auth.error }})</span>
				</template>
				<a v-if="auth.ok" :href="logoutUrl">{{ t('f2c_log_out') }}</a>
			</div>
		</header>
		<router-view></router-view>
		<footer class="magpie-hint" style="margin-top:2rem">
			{{ t('magpie_footer') }}
		</footer>
	</div>`,
	data() {
		return {
			auth: Magpie.authState,
			i18n: Magpie.i18n.state,
			loginUrl: Magpie.api.authorizeUrl(),
			logoutUrl: Magpie.api.logoutUrl()
		};
	},
	mounted() {
		Magpie.refreshAuth();
	},
	methods: {
		languageName(code) {
			return Magpie.i18n.name(code);
		},
		changeLanguage(event) {
			Magpie.i18n.setLanguage(event.target.value);
		},
		/* OAuth returns to `/`; keep the tool page and its query for then. */
		rememberRouteForLogin() {
			try {
				window.sessionStorage.setItem('magpie_return_to',
					window.location.pathname + window.location.search + window.location.hash);
			} catch (error) {
				/* storage unavailable */
			}
		}
	}
});

/* Restore the page the login button remembered. */
(function restoreRouteAfterLogin() {
	try {
		const pending = window.sessionStorage.getItem('magpie_return_to');
		if (!pending || window.location.pathname !== '/') return;
		window.sessionStorage.removeItem('magpie_return_to');
		window.location.replace(pending);
	} catch (error) {
		/* storage unavailable */
	}
})();

const routes = [
	{ path: '/', component: Magpie.Views.home },
	{ path: '/flickr2commons/', component: Magpie.Views.flickr2commons },
	{ path: '/url2commons/', component: Magpie.Views.url2commons },
	{ path: '/geograph2commons/', component: Magpie.Views.geograph2commons },
	{ path: '/commonshelper/', component: Magpie.Views.commonshelper },
	{ path: '*', redirect: '/' }
];

const router = new VueRouter({ mode: 'history', routes: routes });

(async function boot() {
	try {
		await Magpie.i18n.init();
	} catch (error) {
		/* The bundled English fallback is already enough to render. */
	}
	new Vue({ router: router }).$mount('#app');
})();
