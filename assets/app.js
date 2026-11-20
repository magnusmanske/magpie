/* The one Vue application: shared navigation, one router, four views. */

window.Magpie = window.Magpie || {};

Magpie.authState = Vue.observable({ checked: false, ok: false, error: '' });

Magpie.refreshAuth = async function () {
	try {
		const result = await Magpie.api.checkAuth();
		Magpie.authState.ok = !result.error || result.error === 'OK';
		Magpie.authState.error = Magpie.authState.ok ? '' : (result.error || 'Not logged in');
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
				<router-link to="/flickr2commons/">Flickr2Commons</router-link>
				<router-link to="/url2commons/">Url2Commons</router-link>
				<router-link to="/geograph2commons/">Geograph2Commons</router-link>
				<router-link to="/commonshelper/">CommonsHelper</router-link>
			</nav>
			<div class="magpie-auth">
				<span v-if="auth.checked && auth.ok" class="magpie-ok">Logged in</span>
				<template v-else-if="auth.checked">
					<a :href="loginUrl" @click="rememberRouteForLogin">Log in with OAuth</a>
					<span v-if="auth.error" class="magpie-hint"> ({{ auth.error }})</span>
				</template>
				<a v-if="auth.ok" :href="logoutUrl">Log out</a>
			</div>
		</header>
		<router-view></router-view>
		<footer class="magpie-hint" style="margin-top:2rem">
			Files go to Wikimedia Commons. Only upload media whose license allows reuse.
		</footer>
	</div>`,
	data() {
		return {
			auth: Magpie.authState,
			loginUrl: Magpie.api.authorizeUrl(),
			logoutUrl: Magpie.api.logoutUrl()
		};
	},
	mounted() {
		Magpie.refreshAuth();
	},
	methods: {
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

new Vue({ router: router }).$mount('#app');
