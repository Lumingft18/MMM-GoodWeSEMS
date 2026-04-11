/**
 * Node helper: solo lettura SEMS (monitoraggio). Nessuna chiamata di controllo inverter / impianto.
 */
const NodeHelper = require("node_helper");
const Log = require("logger");
const path = require("node:path");

const { SemsApi } = require(path.join(__dirname, "lib", "semsApi.js"));
const { normalizeSemsData } = require(path.join(__dirname, "lib", "normalize.js"));

module.exports = NodeHelper.create({
	/** @type {Record<string, { timer: ReturnType<typeof setTimeout> | null, payload: object }>} */
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
	scheduleNext (payload) {
		const id = payload.identifier;
		const inst = this.instances[id];
		if (!inst) {
			return;
		}
		if (inst.timer) {
			clearTimeout(inst.timer);
		}
		const delay = Math.max(10_000, Number(payload.updateInterval) || 60_000);
		inst.timer = setTimeout(() => {
			this.pollOne(payload).catch((err) => {
				Log.error(`${this.name} poll error:`, err);
				this.sendSocketNotification("GOODWE_ERROR", {
					identifier: id,
					message: err.message || String(err)
				});
				this.scheduleNext(payload);
			});
		}, delay);
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

		const timeout = Math.max(5000, Number(payload.requestTimeout) || 30_000);
		const api = new SemsApi(payload.username, payload.password, timeout);

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
			this.clearInstance(id);
			this.instances[id] = {
				timer: null,
				payload
			};

			this.pollOne(payload).catch((err) => {
				Log.error(`${this.name} initial fetch:`, err);
				this.sendSocketNotification("GOODWE_ERROR", {
					identifier: id,
					message: err.message || String(err)
				});
				this.scheduleNext(payload);
			});
		} else if (notification === "STOP_GOODWE") {
			const sid = payload?.identifier;
			if (sid) {
				this.clearInstance(sid);
			}
		}
	}
});
