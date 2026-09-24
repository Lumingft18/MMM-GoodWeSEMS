/**
 * Node helper: solo lettura SEMS (monitoraggio). Nessuna chiamata di controllo inverter / impianto.
 */
const NodeHelper = require("node_helper");
const Log = require("logger");
const path = require("node:path");

const { SemsApi } = require(path.join(__dirname, "lib", "semsApi.js"));
const { normalizeSemsData } = require(path.join(__dirname, "lib", "normalize.js"));

module.exports = NodeHelper.create({
	/** @type {Record<string, { timer: ReturnType<typeof setTimeout> | null, payload: object, api: InstanceType<typeof SemsApi>, errorCount: number, hasReceivedData: boolean }>} */
	instances: {},

	start () {
		Log.log(`Starting node helper for: ${this.name}`);
	},

	stop () {
		for (const id of Object.keys(this.instances)) {
			this.clearInstance(id);
		}
	},

	/**
	 * @param {string} id
	 */
	clearInstance (id) {
		const inst = this.instances[id];
		if (!inst) {
			return;
		}
		if (inst.timer) {
			clearTimeout(inst.timer);
			inst.timer = null;
		}
		delete this.instances[id];
	},

	/**
	 * @param {object} payload
	 */
	scheduleNext (payload, overrideDelay = null) {
		const id = payload.identifier;
		const inst = this.instances[id];
		if (!inst) {
			return;
		}
		if (inst.timer) {
			clearTimeout(inst.timer);
		}
		const baseDelay = Math.max(10_000, Number(payload.updateInterval) || 60_000);
		const delay = overrideDelay || baseDelay;
		inst.timer = setTimeout(() => {
			this.pollOne(payload).catch((err) => {
				this.handlePollError(payload, err, "poll");
			});
		}, delay);
	},

	/**
	 * @param {object} payload
	 * @param {Error} err
	 * @param {string} phase
	 */
	handlePollError (payload, err, phase) {
		const id = payload.identifier;
		const inst = this.instances[id];
		if (!inst) return;
		inst.errorCount += 1;
		const baseDelay = Math.max(10_000, Number(payload.updateInterval) || 60_000);
		const maxDelay = Math.max(5 * 60_000, baseDelay);
		const retryDelay = Math.min(maxDelay, baseDelay * (2 ** Math.min(inst.errorCount, 3)));
		Log.error(`${this.name} ${phase}:`, err);
		this.sendSocketNotification("GOODWE_ERROR", {
			identifier: id,
			message: err.message || String(err)
		});
		this.scheduleNext(payload, retryDelay);
	},

	/**
	 * @param {object} payload
	 */
	async pollOne (payload) {
		const id = payload.identifier;
		let inst = this.instances[id];
		if (!inst) {
			return;
		}
		const api = inst.api;

		let stationId = payload.powerStationId;
		if (!stationId) {
			stationId = await api.getPowerStationId();
		}

		inst = this.instances[id];
		if (!inst) {
			return;
		}

		const raw = await api.getMonitorDetail(String(stationId));

		inst = this.instances[id];
		if (!inst) {
			return;
		}

		const view = normalizeSemsData(raw);
		if (!inst.hasReceivedData) {
			const flowState = view.station.hasPowerflow ? "with power flow" : "without power flow";
			Log.info(`${this.name}: received ${view.inverters.length} inverter(s) ${flowState} via ${api.mode}`);
			inst.hasReceivedData = true;
		}
		inst.errorCount = 0;

		this.sendSocketNotification("GOODWE_DATA", {
			identifier: id,
			view,
			resolvedStationId: stationId
		});

		this.scheduleNext(payload);
	},

	socketNotificationReceived (notification, payload) {
		if (notification === "FETCH_GOODWE") {
			const id = payload.identifier;
			if (!id) {
				Log.error(`${this.name}: missing identifier in FETCH_GOODWE`);
				return;
			}
				const previous = this.instances[id];
				const api = previous?.api || new SemsApi(
					payload.username,
					payload.password,
					Math.max(5000, Number(payload.requestTimeout) || 30_000)
				);
				const errorCount = previous?.errorCount || 0;
				const hasReceivedData = previous?.hasReceivedData || false;
				this.clearInstance(id);
				this.instances[id] = {
					timer: null,
					payload,
					api,
					errorCount,
					hasReceivedData
				};

				this.pollOne(payload).catch((err) => {
					this.handlePollError(payload, err, "initial fetch");
				});
		} else if (notification === "STOP_GOODWE") {
			const sid = payload?.identifier;
			if (sid) {
				this.clearInstance(sid);
			}
		}
	}
});
