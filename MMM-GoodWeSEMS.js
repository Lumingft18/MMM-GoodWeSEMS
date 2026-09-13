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
		/** Se true, inverte import/export rete (impianti con segno SEMS opposto). */
		invertGrid: false,
		/** Se true, inverte carica/scarica batteria. */
		invertBattery: false,
		colors: {
			pv: "#F5C518",
			gridExport: "#38bdf8",
			gridImport: "#f87171",
			load: "#7dd3fc",
			batteryCharge: "#34d399",
			batteryDischarge: "#a78bfa",
			inverter: "#e2e8f0"
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
		const n = Math.abs(Number(w));
		if (n >= 1000) {
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
	 * SEMS: watt spesso sempre positivi; direzione in status (-1/0/1).
	 * Se il watt è già negativo, il segno vince.
	 * Rete: loadStatus 1 = import, -1 = export (HA / portal).
	 * Fallback: watt > 0 = export (convenzione già usata da questo modulo).
	 * @param {number|null} watts
	 * @param {number|null} gridStatus
	 * @param {number|null} loadStatus
	 * @returns {"export"|"import"|"idle"}
	 */
	gridDirection (watts, gridStatus, loadStatus) {
		let dir = "idle";
		const n = Number(watts);
		const signed = Number.isFinite(n) && Math.abs(n) >= 15 && n < 0;
		if (signed) {
			dir = "import";
		} else {
			const st = loadStatus ?? gridStatus;
			if (st === 1) {
				dir = "import";
			} else if (st === -1) {
				dir = "export";
			} else if (Number.isFinite(n) && Math.abs(n) >= 15) {
				dir = "export";
			}
		}
		if (this.config.invertGrid && dir !== "idle") {
			dir = dir === "export" ? "import" : "export";
		}
		return dir;
	},

	/**
	 * SEMS betteryStatus: 1 = carica, -1 = scarica.
	 * Fallback watt: negativo = carica, positivo = scarica.
	 * @param {number|null} watts
	 * @param {number|null} batteryStatus
	 * @returns {"charge"|"discharge"|"idle"}
	 */
	batteryDirection (watts, batteryStatus) {
		let dir = "idle";
		const n = Number(watts);
		const signed = Number.isFinite(n) && Math.abs(n) >= 15 && n < 0;
		if (signed) {
			dir = "charge";
		} else if (batteryStatus === 1) {
			dir = "charge";
		} else if (batteryStatus === -1) {
			dir = "discharge";
		} else if (Number.isFinite(n) && Math.abs(n) >= 15) {
			dir = "discharge";
		}
		if (this.config.invertBattery && dir !== "idle") {
			dir = dir === "charge" ? "discharge" : "charge";
		}
		return dir;
	},

	/**
	 * @param {number|null|undefined} w
	 * @returns {string}
	 */
	flowDur (w) {
		const n = Math.abs(Number(w) || 0);
		const sec = Math.max(0.7, 2.4 - Math.min(n, 4000) / 2800);
		return `${sec.toFixed(2)}s`;
	},

	/**
	 * @param {string} name
	 * @param {string} color
	 * @param {number|null} [soc]
	 * @returns {string}
	 */
	iconSvg (name, color, soc) {
		const c = color || "#e2e8f0";
		if (name === "sun") {
			return `<svg class="mgw-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="${c}"/><g stroke="${c}" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M12 2.4v2.6M12 19v2.6M2.4 12h2.6M19 12h2.6M5.1 5.1l1.8 1.8M17.1 17.1l1.8 1.8M5.1 18.9l1.8-1.8M17.1 6.9l1.8-1.8"/></g></svg>`;
		}
		if (name === "grid") {
			return `<svg class="mgw-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="${c}" stroke-width="1.7" stroke-linejoin="round" d="M4 20h16M8 20V9l4-5 4 5v11"/><path fill="none" stroke="${c}" stroke-width="1.5" d="M8 12h8M8 16h8"/><circle cx="12" cy="12" r="1.2" fill="${c}"/></svg>`;
		}
		if (name === "home") {
			return `<svg class="mgw-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round" d="M3.6 11.2 12 4.2l8.4 7V20a1 1 0 0 1-1 1h-5.2v-6.2H9.8V21H4.6a1 1 0 0 1-1-1z"/></svg>`;
		}
		if (name === "inv") {
			return `<svg class="mgw-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="${c}" stroke-width="1.7"/><path d="M8 12h3l2-3 2 6 1-3h2" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
		}
		const pct = soc !== null && soc !== undefined ? Math.max(0, Math.min(100, Number(soc))) : 0;
		const fillH = 10.2 * (pct / 100);
		const fillY = 16.4 - fillH;
		return `<svg class="mgw-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5.2" width="10" height="13.6" rx="1.6" fill="none" stroke="${c}" stroke-width="1.7"/><rect x="10" y="3.2" width="4" height="2" rx="0.6" fill="${c}"/><rect x="8.3" y="${fillY}" width="7.4" height="${fillH}" rx="0.8" fill="${c}" opacity="0.85"/></svg>`;
	},

	/**
	 * @param {SVGElement} svg
	 * @param {string} d
	 * @param {string} color
	 * @param {boolean} active
	 * @param {boolean} reverse
	 * @param {string} dur
	 */
	appendFlowPath (svg, d, color, active, reverse, dur) {
		const NS = "http://www.w3.org/2000/svg";
		const track = document.createElementNS(NS, "path");
		track.setAttribute("d", d);
		track.setAttribute("class", "mgw-track");
		svg.appendChild(track);

		if (!active) {
			return;
		}

		const glow = document.createElementNS(NS, "path");
		glow.setAttribute("d", d);
		glow.setAttribute("class", "mgw-flow mgw-flow-glow");
		glow.setAttribute("stroke", color);
		svg.appendChild(glow);

		const flow = document.createElementNS(NS, "path");
		flow.setAttribute("d", d);
		flow.setAttribute("class", `mgw-flow${reverse ? " mgw-flow-rev" : ""}`);
		flow.setAttribute("stroke", color);
		flow.style.animationDuration = dur;
		svg.appendChild(flow);

		for (let i = 0; i < 3; i += 1) {
			const dot = document.createElementNS(NS, "circle");
			dot.setAttribute("r", i === 0 ? "3.1" : "2.2");
			dot.setAttribute("fill", color);
			dot.setAttribute("class", "mgw-dot");
			const motion = document.createElementNS(NS, "animateMotion");
			motion.setAttribute("dur", dur);
			motion.setAttribute("repeatCount", "indefinite");
			motion.setAttribute("begin", `${(i * 0.28).toFixed(2)}s`);
			motion.setAttribute("path", reverse ? this.reversePath(d) : d);
			dot.appendChild(motion);
			svg.appendChild(dot);
		}
	},

	/**
	 * Inverte un path a due punti "M x y L x y".
	 * @param {string} d
	 * @returns {string}
	 */
	reversePath (d) {
		const m = d.match(/M\s*([\d.]+)\s+([\d.]+)\s+L\s*([\d.]+)\s+([\d.]+)/i);
		if (!m) {
			return d;
		}
		return `M ${m[3]} ${m[4]} L ${m[1]} ${m[2]}`;
	},

	/**
	 * @param {string} cls
	 * @param {string} icon
	 * @param {string} label
	 * @param {string} value
	 * @param {string} chip
	 * @param {string} color
	 * @param {boolean} hot
	 * @returns {HTMLElement}
	 */
	mkCard (cls, icon, label, value, chip, color, hot) {
		const el = document.createElement("div");
		el.className = `mgw-card ${cls}${hot ? " mgw-hot" : ""}`;
		el.style.setProperty("--mgw-c", color);
		el.innerHTML = `<div class="mgw-ico">${icon}</div><div class="mgw-meta"><div class="mgw-lbl">${label}</div><div class="mgw-val">${value}</div>${chip ? `<div class="mgw-chip">${chip}</div>` : ""}</div>`;
		return el;
	},

	/**
	 * @param {Record<string, unknown>} v
	 * @param {{pvW: number|null, loadW: number|null, gridDir: string, batDir: string, hasBat: boolean}} flow
	 * @returns {string}
	 */
	flowStory (flow) {
		const bits = [];
		if (this.isFlowActive(flow.pvW)) {
			bits.push(this.translate("PV"));
		}
		if (flow.hasBat && flow.batDir === "discharge") {
			bits.push(this.translate("BATTERY"));
		}
		if (flow.gridDir === "import") {
			bits.push(this.translate("GRID"));
		}
		if (bits.length && this.isFlowActive(flow.loadW)) {
			return this.translate("STORY_TO_HOME").replace("{from}", bits.join(this.translate("STORY_AND")));
		}
		if (this.isFlowActive(flow.pvW) && flow.gridDir === "export" && flow.hasBat && flow.batDir === "charge") {
			return this.translate("STORY_PV_SPLIT");
		}
		if (this.isFlowActive(flow.pvW) && flow.gridDir === "export") {
			return this.translate("STORY_PV_EXPORT");
		}
		if (this.isFlowActive(flow.pvW) && flow.hasBat && flow.batDir === "charge") {
			return this.translate("STORY_PV_CHARGE");
		}
		if (!this.isFlowActive(flow.pvW) && flow.hasBat && flow.batDir === "charge" && flow.gridDir === "import") {
			return this.translate("STORY_GRID_CHARGE");
		}
		return this.translate("STORY_IDLE");
	},

	/**
	 * @param {HTMLElement} wrap
	 * @param {Record<string, unknown>} v
	 */
	appendEnergyFlow (wrap, v) {
		const C = this.config.colors || {};
		const pf = v.powerflow;
		const inv = (v.inverters && v.inverters[0]) || {};
		const hasPf = Boolean(pf && v.station && v.station.hasPowerflow);
		const showBat = Boolean(v.station && v.station.showBattery !== false);

		const pvW = hasPf ? (pf.pv ?? null) : (inv.pvPower ?? inv.pac ?? v.pacTotal ?? null);
		const gridW = hasPf ? (pf.grid ?? null) : null;
		const loadW = hasPf ? (pf.load ?? null) : null;
		const batW = hasPf && showBat ? (pf.battery ?? null) : null;
		const soc = hasPf && pf.soc != null ? Number(pf.soc) : null;
		const gridDir = hasPf ? this.gridDirection(gridW, pf.gridStatus, pf.loadStatus) : "idle";
		const batDir = hasPf && showBat ? this.batteryDirection(batW, pf.batteryStatus) : "idle";

		const box = document.createElement("div");
		box.className = `mgw-energy${showBat && hasPf ? "" : " mgw-nobat"}`;

		const story = document.createElement("div");
		story.className = "mgw-story";
		story.textContent = hasPf
			? this.flowStory({ pvW, loadW, gridDir, batDir, hasBat: showBat })
			: this.translate("NO_POWERFLOW");
		box.appendChild(story);

		const stage = document.createElement("div");
		stage.className = "mgw-stage";

		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("class", "mgw-lines");
		svg.setAttribute("viewBox", showBat && hasPf ? "0 0 580 360" : "0 0 580 248");
		svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

		if (hasPf) {
			this.appendFlowPath(svg, "M290 104 L290 128", C.pv || "#F5C518", this.isFlowActive(pvW), false, this.flowDur(pvW));
			const gridOn = gridDir !== "idle" && this.isFlowActive(gridW);
			const gridColor = gridDir === "import" ? (C.gridImport || "#f87171") : (C.gridExport || "#38bdf8");
			this.appendFlowPath(svg, "M100 186 L236 186", gridColor, gridOn, gridDir === "export", this.flowDur(gridW));
			this.appendFlowPath(svg, "M344 186 L480 186", C.load || "#7dd3fc", this.isFlowActive(loadW), false, this.flowDur(loadW));
			if (showBat) {
				const batOn = batDir !== "idle" && this.isFlowActive(batW);
				const batColor = batDir === "charge" ? (C.batteryCharge || "#34d399") : (C.batteryDischarge || "#a78bfa");
				this.appendFlowPath(svg, "M290 246 L290 268", batColor, batOn, batDir === "discharge", this.flowDur(batW));
			}
		} else {
			this.appendFlowPath(svg, "M290 104 L290 128", C.pv || "#F5C518", this.isFlowActive(pvW), false, this.flowDur(pvW));
		}
		stage.appendChild(svg);

		const pvHot = this.isFlowActive(pvW);
		stage.appendChild(this.mkCard(
			"mgw-solar",
			this.iconSvg("sun", C.pv || "#F5C518"),
			this.translate("PV"),
			this.formatW(pvW),
			pvHot ? this.translate("PV_ON") : this.translate("PV_OFF"),
			C.pv || "#F5C518",
			pvHot
		));

		if (hasPf) {
			const gridHot = gridDir !== "idle";
			const gridColor = gridDir === "import" ? (C.gridImport || "#f87171") : (C.gridExport || "#38bdf8");
			const gridChip = gridDir === "import"
				? this.translate("GRID_IMPORT")
				: gridDir === "export"
					? this.translate("GRID_EXPORT")
					: this.translate("GRID_IDLE");
			stage.appendChild(this.mkCard(
				"mgw-grid",
				this.iconSvg("grid", gridColor),
				this.translate("GRID"),
				this.formatW(gridW),
				gridChip,
				gridColor,
				gridHot
			));
		}

		const invW = inv.pac ?? v.pacTotal;
		stage.appendChild(this.mkCard(
			"mgw-inv",
			this.iconSvg("inv", C.inverter || "#e2e8f0"),
			this.translate("INVERTER"),
			this.formatW(invW),
			inv.statusLabel || "",
			C.inverter || "#e2e8f0",
			this.isFlowActive(invW)
		));

		if (hasPf) {
			stage.appendChild(this.mkCard(
				"mgw-load",
				this.iconSvg("home", C.load || "#7dd3fc"),
				this.translate("HOME"),
				this.formatW(loadW),
				this.isFlowActive(loadW) ? this.translate("HOME_ON") : this.translate("HOME_IDLE"),
				C.load || "#7dd3fc",
				this.isFlowActive(loadW)
			));
		}

		if (hasPf && showBat) {
			const batHot = batDir !== "idle";
			const batColor = batDir === "charge" ? (C.batteryCharge || "#34d399") : (C.batteryDischarge || "#a78bfa");
			const batChip = batDir === "charge"
				? this.translate("BAT_CHARGE")
				: batDir === "discharge"
					? this.translate("BAT_DISCHARGE")
					: this.translate("BAT_IDLE");
			const card = this.mkCard(
				"mgw-battery",
				this.iconSvg("bat", batColor, soc),
				this.translate("BATTERY"),
				this.formatW(batW),
				soc !== null && soc >= 0 && soc <= 100
					? `${batChip} ${Math.round(soc)}%`
					: batChip,
				batColor,
				batHot
			);
			if (soc !== null && soc >= 0 && soc <= 100) {
				const bar = document.createElement("div");
				bar.className = "mgw-soc";
				bar.innerHTML = `<span style="width:${Math.round(soc)}%"></span>`;
				card.appendChild(bar);
			}
			stage.appendChild(card);
		}

		box.appendChild(stage);
		wrap.appendChild(box);
	},

	/**
	 * @returns {HTMLElement}
	 */
	getDom () {
		const wrap = document.createElement("div");
		wrap.className = "mmm-goodwe";

		if (this.errorMessage && !this.view) {
			wrap.innerHTML = `<div class="mgw-empty">${this.translate("ERROR")}: ${this.errorMessage}</div>`;
			return wrap;
		}

		if (!this.view) {
			wrap.innerHTML = `<div class="mgw-empty">${this.translate("LOADING")}</div>`;
			return wrap;
		}

		const v = this.view;
		const station = v.station || {};
		const header = document.createElement("div");
		header.className = "mmm-goodwe-header";
		const title = station.name || this.translate("TITLE");
		const clock = this.formatUpdatedLocalTime(v.updatedAt);
		const sub = clock ? `${this.translate("UPDATED")} ${clock}` : "";
		header.innerHTML = `<div class="mmm-goodwe-title">${title}</div><div class="mmm-goodwe-sub">${sub}</div>`;
		wrap.appendChild(header);

		if (this.errorMessage) {
			const err = document.createElement("div");
			err.className = "mgw-empty";
			err.textContent = `${this.translate("ERROR")}: ${this.errorMessage}`;
			wrap.appendChild(err);
		}

		if (this.config.showKpi) {
			const kpi = document.createElement("div");
			kpi.className = "mmm-goodwe-kpi";
			const k = v.kpi || {};
			const inv0 = (v.inverters && v.inverters[0]) || {};
			const tiles = [
				[this.translate("PAC"), this.formatW(v.pacTotal)]
			];
			if (inv0.eday != null) {
				tiles.push([this.translate("ENERGY_TODAY"), `${inv0.eday} kWh`]);
			}
			if (k.monthGeneration != null) {
				tiles.push([this.translate("ENERGY_MONTH"), `${k.monthGeneration} kWh`]);
			}
			if (k.totalEnergy != null) {
				tiles.push([this.translate("ENERGY_TOTAL"), `${k.totalEnergy} kWh`]);
			}
			kpi.innerHTML = tiles
				.map(([lbl, val]) => `<div class="mgw-kpi"><span class="mgw-kpi-lbl">${lbl}</span><span class="mgw-kpi-val">${val}</span></div>`)
				.join("");
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
