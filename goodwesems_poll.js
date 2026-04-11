/**
 * Logica polling veloce/lenta (PIR USER_PRESENCE + suspend MagicMirror).
 * UMD: Node (test) + browser (deve stare nella root del modulo: path con "/" in getScripts() non funziona nel Loader MM).
 */
(function (root, factory) {
	if (typeof module === "object" && module.exports) {
		module.exports = factory();
	} else {
		root.__MMMGoodWeSEMSPolling = factory();
	}
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	/**
	 * @param {{ listenPresenceNotification: boolean, userPresent: boolean, mmHidden: boolean }} s
	 * @returns {boolean}
	 */
	function shouldUseFastPolling (s) {
		const presenceOk = !s.listenPresenceNotification || s.userPresent;
		return presenceOk && !s.mmHidden;
	}

	/**
	 * @param {{ updateInterval?: number, updateIntervalScreenOn?: number|null }} cfg
	 * @returns {number}
	 */
	function getFastIntervalMs (cfg) {
		const explicit = cfg.updateIntervalScreenOn;
		if (explicit != null && explicit !== "") {
			return Number(explicit);
		}
		return Number(cfg.updateInterval) || 20_000;
	}

	/**
	 * @param {{ updateIntervalScreenOff?: number }} cfg
	 * @returns {number}
	 */
	function getSlowIntervalMs (cfg) {
		return Number(cfg.updateIntervalScreenOff) || 60 * 60 * 1000;
	}

	/**
	 * @param {{ listenPresenceNotification?: boolean, updateInterval?: number, updateIntervalScreenOn?: number|null, updateIntervalScreenOff?: number }} cfg
	 * @param {{ userPresent: boolean, mmHidden: boolean }} state
	 * @returns {number}
	 */
	function getCurrentPollIntervalMs (cfg, state) {
		const listen = cfg.listenPresenceNotification !== false;
		const fast = shouldUseFastPolling({
			listenPresenceNotification: listen,
			userPresent: state.userPresent,
			mmHidden: state.mmHidden
		});
		return fast ? getFastIntervalMs(cfg) : getSlowIntervalMs(cfg);
	}

	return {
		shouldUseFastPolling,
		getFastIntervalMs,
		getSlowIntervalMs,
		getCurrentPollIntervalMs
	};
});
