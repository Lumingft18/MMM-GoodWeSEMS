const {
	shouldUseFastPolling,
	getFastIntervalMs,
	getSlowIntervalMs,
	getCurrentPollIntervalMs
} = require("../goodwesems_poll.js");

describe("MMM-GoodWeSEMS polling (PIR / suspend)", () => {
	const baseCfg = {
		updateInterval: 20_000,
		updateIntervalScreenOff: 3_600_000
	};

	it("USER_PRESENCE off + listenPresence → slow (simula schermo spento PIR)", () => {
		const ms = getCurrentPollIntervalMs(
			{ ...baseCfg, listenPresenceNotification: true },
			{ userPresent: false, mmHidden: false }
		);
		expect(ms).toBe(3_600_000);
		expect(shouldUseFastPolling({ listenPresenceNotification: true, userPresent: false, mmHidden: false })).toBe(false);
	});

	it("USER_PRESENCE on + modulo visibile → fast", () => {
		const ms = getCurrentPollIntervalMs(
			{ ...baseCfg, listenPresenceNotification: true },
			{ userPresent: true, mmHidden: false }
		);
		expect(ms).toBe(20_000);
	});

	it("suspend (mmHidden) → slow anche se presenza true", () => {
		const ms = getCurrentPollIntervalMs(
			{ ...baseCfg, listenPresenceNotification: true },
			{ userPresent: true, mmHidden: true }
		);
		expect(ms).toBe(3_600_000);
	});

	it("listenPresenceNotification false → ignora PIR, solo visibilità modulo", () => {
		expect(
			getCurrentPollIntervalMs(
				{ ...baseCfg, listenPresenceNotification: false },
				{ userPresent: false, mmHidden: false }
			)
		).toBe(20_000);

		expect(
			getCurrentPollIntervalMs(
				{ ...baseCfg, listenPresenceNotification: false },
				{ userPresent: false, mmHidden: true }
			)
		).toBe(3_600_000);
	});

	it("updateIntervalScreenOn override", () => {
		expect(
			getCurrentPollIntervalMs(
				{
					...baseCfg,
					updateIntervalScreenOn: 15_000,
					listenPresenceNotification: true
				},
				{ userPresent: true, mmHidden: false }
			)
		).toBe(15_000);
	});

	it("getFastIntervalMs / getSlowIntervalMs", () => {
		expect(getFastIntervalMs({ updateInterval: 12_000 })).toBe(12_000);
		expect(getSlowIntervalMs({ updateIntervalScreenOff: 5_000 })).toBe(5_000);
	});
});
