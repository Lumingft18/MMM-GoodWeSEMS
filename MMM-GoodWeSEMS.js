/* Modulo solo visualizzazione: nessun comando verso l’inverter o l’impianto. */

Module.register("MMM-GoodWeSEMS", {
	defaults: {
		username: "",
		password: "",
		powerStationId: "",
		/**
		 * Intervallo “veloce” quando lo specchio è considerato attivo (schermo acceso / modulo visibile).
		 * Se non imposti `updateIntervalScreenOn`, vale `updateInterval` (compatibilità con config vecchi).
		 * Minimo effettivo lato server: 10 s.
		 */
		updateInterval: 20 * 1000,
		/** Override esplicito dell’intervallo veloce (ms). Se omesso → `updateInterval`. */
		updateIntervalScreenOn: null,
		/** Intervallo “lento” quando lo schermo è spento o il modulo è nascosto (ms). */
		updateIntervalScreenOff: 60 * 60 * 1000,
		/**
		 * Se true, reagisce a `USER_PRESENCE` (es. MMM-PIR-Sensor che inoltra presenza/assenza).
		 * Presenza false o modulo in suspend → polling lento; presenza true e modulo visibile → veloce.
		 */
		listenPresenceNotification: true,
		/** Es. "it-IT" per l’etichetta orario; se vuoto usa lingua/fuso del browser (consigliato sul Pi). */
		locale: null,
		requestTimeout: 30 * 1000,
		showFlow: true,
		showKpi: true,
		colors: {
			pv: "#B4CD34",
			gridExport: "#38bdf8",
			gridImport: "#f87171",
			load: "#3b82f6",
			batteryCharge: "#76DAFE",
			batteryDischarge: "#1E7DB5"
		}
	},

	view: null,
	errorMessage: null,

	/** @type {boolean} Modulo nascosto (MagicMirror hide → suspend). */
	_mmHidden: false,

	/** @type {boolean} Presenza utente da PIR / USER_PRESENCE (default true all’avvio). */
	_userPresent: true,

	getTranslations () {
		return {
			en: "translations/en.json",
			it: "translations/it.json"
		};
	},

	getScripts () {
		// Niente "/" nel nome: altrimenti Loader lo tratta come path del sito e non carica dal modulo.
		return ["goodwesems_poll.js"];
	},

	getStyles () {
		return ["MMM-GoodWeSEMS.css"];
	},

	start () {
		Log.info(`Starting module: ${this.name}`);
		this.pushPollingToNode();
	},

	suspend () {
		this._mmHidden = true;
		this.pushPollingToNode();
	},

	resume () {
		this._mmHidden = false;
		this.pushPollingToNode();
	},

	/**
	 * Polling veloce solo se il modulo è visibile e (se abilitato) la presenza è true.
	 * @returns {boolean}
	 */
	_polling () {
		const g = typeof globalThis !== "undefined" ? globalThis : window;
		return g.__MMMGoodWeSEMSPolling;
	},

	shouldUseFastPolling () {
		const p = this._polling();
		if (!p) {
			return true;
		}
		return p.shouldUseFastPolling({
			listenPresenceNotification: this.config.listenPresenceNotification,
			userPresent: this._userPresent,
			mmHidden: this._mmHidden
		});
	},

	/** @returns {number} */
	getFastPollIntervalMs () {
		const p = this._polling();
		return p ? p.getFastIntervalMs(this.config) : Number(this.config.updateInterval) || 20_000;
	},

	/** @returns {number} */
	getSlowPollIntervalMs () {
		const p = this._polling();
		return p ? p.getSlowIntervalMs(this.config) : 60 * 60 * 1000;
	},

	/** @returns {number} */
	getCurrentPollIntervalMs () {
		const p = this._polling();
		if (!p) {
			return Number(this.config.updateInterval) || 60_000;
		}
		return p.getCurrentPollIntervalMs(this.config, {
			userPresent: this._userPresent,
			mmHidden: this._mmHidden
		});
	},

	/**
	 * `updatedAt` dal server è ISO UTC; qui si converte all’ora locale del dispositivo (Electron sullo specchio).
	 * @param {string|undefined} iso
	 * @returns {string}
	 */
	formatUpdatedLocalTime (iso) {
		if (!iso || typeof iso !== "string") {
			return "";
		}
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) {
			return "";
		}
		const loc = this.config.locale || undefined;
		return d.toLocaleTimeString(loc, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false
		});
	},

	pushPollingToNode () {
		if (!this._polling()) {
			Log.error(`${this.name}: goodwesems_poll.js non caricato — impossibile avviare il poll SEMS.`);
			return;
		}
		this.sendSocketNotification("FETCH_GOODWE", this.buildPayload());
	},

	notificationReceived (notification, payload) {
		if (!this.config.listenPresenceNotification) {
			return;
		}
		if (notification !== "USER_PRESENCE") {
			return;
		}
		this._userPresent = payload === true;
		this.pushPollingToNode();
	},

	buildPayload () {
		return {
			identifier: this.identifier,
			username: this.config.username,
			password: this.config.password,
			powerStationId: this.config.powerStationId || "",
			updateInterval: this.getCurrentPollIntervalMs(),
			requestTimeout: this.config.requestTimeout
		};
	},

	socketNotificationReceived (notification, payload) {
		if (payload && payload.identifier !== this.identifier) {
			return;
		}
		if (notification === "GOODWE_DATA") {
			this.errorMessage = null;
			this.view = payload.view;
			this.updateDom();
		} else if (notification === "GOODWE_ERROR") {
			this.errorMessage = payload.message || this.translate("ERROR");
			this.updateDom();
		}
	},

	/**
	 * @param {number|null|undefined} w
	 * @returns {string}
	 */
	formatW (w) {
		if (w === null || w === undefined || Number.isNaN(Number(w))) {
			return "—";
		}
		const n = Number(w);
		if (Math.abs(n) >= 1000) {
			return `${(n / 1000).toFixed(2)} kW`;
		}
		return `${Math.round(n)} W`;
	},

	/**
	 * @param {number|null|undefined} w
	 * @returns {boolean}
	 */
	isFlowActive (w) {
		return w !== null && w !== undefined && Math.abs(Number(w)) >= 15;
	},

	/**
	 * @param {HTMLElement} wrap
	 * @param {Record<string, unknown>} v
	 */
	appendEnergyFlow (wrap, v) {
		const box = document.createElement("div");
		box.className = "mgw-energy";

		const pf = v.powerflow;
		const inv = (v.inverters && v.inverters[0]) || {};
		const hasPf = Boolean(pf && v.station && v.station.hasPowerflow);
		const showBat = v.station && v.station.showBattery !== false;

		const pvW = hasPf ? (pf.pv ?? null) : (inv.pvPower ?? inv.pac ?? v.pacTotal ?? null);
		const gridW = hasPf ? (pf.grid ?? null) : null;
		const loadW = hasPf ? (pf.load ?? null) : null;
		const batW = hasPf && showBat ? (pf.battery ?? null) : null;
		const soc = hasPf && pf.soc != null ? pf.soc : null;

		const mkNode = (cls, ico, lblKey, watts, hot) => {
			const el = document.createElement("div");
			el.className = `mgw-node ${cls}${hot ? " mgw-hot" : ""}`;
			const socHtml = soc !== null && showBat && cls === "mgw-battery" && soc >= 0 && soc <= 100
				? `<div class="mgw-lbl">SoC ${soc}%</div>`
				: "";
			el.innerHTML = `<div class="mgw-ico">${ico}</div><div class="mgw-lbl">${this.translate(lblKey)}</div><div class="mgw-val">${this.formatW(watts)}</div>${socHtml}`;
			return el;
		};

		const mkVConn = (active, anim) => {
			const wrapC = document.createElement("div");
			wrapC.className = "mgw-conn mgw-conn-v";
			const line = document.createElement("div");
			line.className = `mgw-line mgw-line-v${active ? " mgw-on" : ""}${anim ? ` ${anim}` : ""}`;
			wrapC.appendChild(line);
			const ar = document.createElement("span");
			ar.className = "mgw-arrow";
			ar.textContent = active ? "▼" : "·";
			wrapC.appendChild(ar);
			return wrapC;
		};

		const mkHConn = (active, animClasses, arrowChar) => {
			const wrapC = document.createElement("div");
			wrapC.className = "mgw-conn mgw-conn-h";
			const line = document.createElement("div");
			line.className = `mgw-line mgw-line-h${active ? " mgw-on" : ""}`;
			if (active && animClasses) {
				animClasses.split(/\s+/).forEach((c) => {
					if (c) {
						line.classList.add(c);
					}
				});
			}
			wrapC.appendChild(line);
			const ar = document.createElement("span");
			ar.className = "mgw-arrow mgw-arrow-h";
			ar.textContent = active ? arrowChar : "·";
			wrapC.appendChild(ar);
			return wrapC;
		};

		const rowPv = document.createElement("div");
		rowPv.className = "mgw-row mgw-row-center";
		rowPv.appendChild(mkNode("mgw-solar", "☀", "PV", pvW, this.isFlowActive(pvW)));
		box.appendChild(rowPv);

		box.appendChild(mkVConn(this.isFlowActive(pvW), this.isFlowActive(pvW) ? "mgw-anim-v" : ""));

		const rowInv = document.createElement("div");
		rowInv.className = "mgw-row mgw-row-mid";
		if (hasPf) {
			rowInv.appendChild(mkNode("mgw-grid", "⌁", "GRID", gridW, this.isFlowActive(gridW)));

			let gridAnim = "";
			if (this.isFlowActive(gridW)) {
				gridAnim = gridW > 0 ? "mgw-grid-exp" : "mgw-grid-imp";
			}
			const gridArrow = this.isFlowActive(gridW) ? (gridW > 0 ? "◀" : "▶") : "·";
			rowInv.appendChild(mkHConn(this.isFlowActive(gridW), gridAnim, gridArrow));

			rowInv.appendChild(mkNode("mgw-inv", "⎍", "INVERTER", inv.pac ?? v.pacTotal, this.isFlowActive(inv.pac ?? v.pacTotal)));

			const loadAnim = this.isFlowActive(loadW) ? "mgw-anim-h-l" : "";
			rowInv.appendChild(mkHConn(this.isFlowActive(loadW), loadAnim, this.isFlowActive(loadW) ? "▶" : "·"));

			rowInv.appendChild(mkNode("mgw-load", "⌂", "HOME", loadW, this.isFlowActive(loadW)));
		} else {
			rowInv.appendChild(mkNode("mgw-inv", "⎍", "INVERTER", inv.pac ?? v.pacTotal, this.isFlowActive(inv.pac ?? v.pacTotal)));
		}
		box.appendChild(rowInv);

		if (hasPf && showBat) {
			const wrapBt = document.createElement("div");
			wrapBt.className = "mgw-conn mgw-conn-v mgw-conn-v-up";
			const arU = document.createElement("span");
			arU.className = "mgw-arrow";
			arU.textContent = this.isFlowActive(batW) ? "▲" : "·";
			wrapBt.appendChild(arU);
			const lineB = document.createElement("div");
			lineB.className = `mgw-line mgw-line-v${this.isFlowActive(batW) ? " mgw-on mgw-anim-v" : ""}`;
			wrapBt.appendChild(lineB);
			box.appendChild(wrapBt);

			const rowBt = document.createElement("div");
			rowBt.className = "mgw-row mgw-row-center";
			rowBt.appendChild(mkNode("mgw-battery", "▣", "BATTERY", batW, this.isFlowActive(batW)));
			box.appendChild(rowBt);
		} else if (!hasPf) {
			const hint = document.createElement("div");
			hint.className = "mgw-hint dimmed xsmall";
			hint.textContent = this.translate("NO_POWERFLOW");
			box.appendChild(hint);
		}

		wrap.appendChild(box);
	},

	/**
	 * @returns {HTMLElement}
	 */
	getDom () {
		const wrap = document.createElement("div");
		wrap.className = "mmm-goodwe xsmall";

		if (this.errorMessage && !this.view) {
			wrap.innerHTML = `<div class="dimmed">${this.translate("ERROR")}: ${this.errorMessage}</div>`;
			return wrap;
		}

		if (!this.view) {
			wrap.innerHTML = `<div class="dimmed">${this.translate("LOADING")}</div>`;
			return wrap;
		}

		const v = this.view;
		const station = v.station || {};
		const header = document.createElement("div");
		header.className = "mmm-goodwe-header";
		const title = station.name || this.translate("TITLE");
		const clock = this.formatUpdatedLocalTime(v.updatedAt);
		const sub = clock ? `${this.translate("UPDATED")}: ${clock}` : "";
		header.innerHTML = `<div class="mmm-goodwe-title bright">${title}</div><div class="mmm-goodwe-sub">${sub}</div>`;
		wrap.appendChild(header);

		if (this.errorMessage) {
			const err = document.createElement("div");
			err.className = "dimmed";
			err.style.marginBottom = "0.25em";
			err.textContent = `${this.translate("ERROR")}: ${this.errorMessage}`;
			wrap.appendChild(err);
		}

		if (this.config.showKpi) {
			const kpi = document.createElement("div");
			kpi.className = "mmm-goodwe-kpi";
			const k = v.kpi || {};
			const inv0 = (v.inverters && v.inverters[0]) || {};
			const parts = [
				`<span>${this.translate("PAC")}: <span class="bright">${this.formatW(v.pacTotal)}</span></span>`
			];
			if (inv0.eday != null) {
				parts.push(`<span>${this.translate("ENERGY_TODAY")}: <span class="bright">${inv0.eday} kWh</span></span>`);
			}
			if (k.monthGeneration != null) {
				parts.push(`<span>${this.translate("ENERGY_MONTH")}: <span class="bright">${k.monthGeneration} kWh</span></span>`);
			}
			if (k.totalEnergy != null) {
				parts.push(`<span>${this.translate("ENERGY_TOTAL")}: <span class="bright">${k.totalEnergy} kWh</span></span>`);
			}
			kpi.innerHTML = parts.join(" ");
			wrap.appendChild(kpi);
		}

		if (this.config.showFlow) {
			this.appendEnergyFlow(wrap, v);
		}

		if (v.inverters && v.inverters.length > 1) {
			const invDiv = document.createElement("div");
			invDiv.className = "mmm-goodwe-inverters";
			invDiv.textContent = v.inverters
				.map((i) => `${i.name}: ${this.formatW(i.pac)} (${i.statusLabel})`)
				.join(" · ");
			wrap.appendChild(invDiv);
		}

		return wrap;
	}
});
