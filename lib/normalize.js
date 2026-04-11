/**
 * Maps GoodWe SEMS API typos and builds a stable view model for the UI.
 * Aligned with Home Assistant custom_components/sems/const.py and __init__.py.
 */

const { parseSemPowerValue } = require("./parseSemPower.js");

const SPELL = {
	battery: "bettery",
	batteryStatus: "betteryStatus",
	homeKit: "homKit",
	temperature: "tempperature",
	hasEnergyStatisticsCharts: "hasEnergeStatisticsCharts",
	energyStatisticsCharts: "energeStatisticsCharts",
	energyStatisticsTotals: "energeStatisticsTotals",
	thisMonthTotalE: "thismonthetotle",
	lastMonthTotalE: "lastmonthetotle"
};

const STATUS_LABELS = {
	"-1": "Offline",
	"0": "Waiting",
	"1": "Normal",
	"2": "Fault"
};

/**
 * @param {unknown} v
 * @returns {number|null}
 */
function num (v) {
	if (v === null || v === undefined || v === "") {
		return null;
	}
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} status
 * @returns {string}
 */
function statusLabel (status) {
	const key = String(status);
	return STATUS_LABELS[key] || "Unknown";
}

/**
 * @param {Record<string, unknown>} inv
 * @returns {{ p: number, u: number|null, i: number|null }[]}
 */
function mpptFromInverter (inv) {
	const out = [];
	for (let i = 1; i <= 4; i += 1) {
		const uKey = `vpv${i}`;
		const iKey = `ipv${i}`;
		const pKey = `ppv${i}`;
		const u = num(inv[uKey]);
		const ii = num(inv[iKey]);
		let p = num(inv[pKey]);
		if (p === null && u !== null && ii !== null) {
			p = u * ii;
		}
		if (p !== null && p > 0) {
			out.push({
				p,
				u,
				i: ii
			});
		}
	}
	return out;
}

/**
 * @param {Record<string, unknown>} raw - getMonitorDetail `data` object
 * @returns {Record<string, unknown>}
 */
function normalizeSemsData (raw) {
	const info = /** @type {Record<string, unknown>} */ (raw.info || {});
	const kpiRaw = /** @type {Record<string, unknown>} */ (raw.kpi || {});

	const stationId = typeof info.powerstation_id === "string" ? info.powerstation_id : "";
	const stationName = typeof info.stationname === "string" ? info.stationname : "GoodWe";
	const currency = typeof kpiRaw.currency === "string" ? kpiRaw.currency : null;

	const kpi = {
		pac: num(kpiRaw.pac),
		power: num(kpiRaw.power),
		totalEnergy: num(kpiRaw.total_power),
		monthGeneration: num(kpiRaw.month_generation),
		dayIncome: num(kpiRaw.day_income),
		totalIncome: num(kpiRaw.total_income),
		yieldRate: num(kpiRaw.yield_rate)
	};

	const inverterList = Array.isArray(raw.inverter) ? raw.inverter : [];
	/** @type {Record<string, unknown>[]} */
	const inverters = [];

	for (const entry of inverterList) {
		const inv = /** @type {Record<string, unknown>} */ (
			entry && typeof entry === "object" && entry.invert_full && typeof entry.invert_full === "object"
				? entry.invert_full
				: {}
		);
		const sn = typeof inv.sn === "string" ? inv.sn : String(entry?.sn || "");
		if (!sn) {
			continue;
		}

		const temp = num(inv[SPELL.temperature]) ?? num(inv.tempperature) ?? num(inv.innerTemp);
		const socRaw = num(inv.soc);
		const soc =
			socRaw !== null && socRaw >= 0 && socRaw <= 100 ? socRaw : null;

		inverters.push({
			sn,
			name: typeof inv.name === "string" ? inv.name : sn,
			model: typeof inv.model_type === "string" ? inv.model_type : null,
			status: inv.status,
			statusLabel: statusLabel(inv.status),
			pac: num(inv.pac),
			eday: num(inv.eday),
			etotal: num(inv.etotal),
			pvPower: num(inv.pv_power),
			temp,
			mppt: mpptFromInverter(inv),
			battery: soc !== null || num(inv.total_pbattery) !== null
				? {
					soc,
					power: num(inv.total_pbattery) ?? num(inv[SPELL.battery])
				}
				: null
		});
	}

	const hasPowerflow = Boolean(raw.hasPowerflow);
	let powerflow = null;
	if (hasPowerflow) {
		const pf = /** @type {Record<string, unknown>} */ (raw.powerflow || {});
		const hk = /** @type {Record<string, unknown>} */ (raw[SPELL.homeKit] || raw.homKit || {});

		const batStr = pf[SPELL.battery] ?? pf.battery;

		powerflow = {
			pv: parseSemPowerValue(pf.pv) ?? num(pf.pv),
			grid: parseSemPowerValue(pf.grid) ?? num(pf.grid),
			load: parseSemPowerValue(pf.load) ?? num(pf.load),
			battery: parseSemPowerValue(batStr) ?? num(pf.battery),
			soc: num(pf.soc) ?? num(hk.soc),
			genset: parseSemPowerValue(pf.genset) ?? num(pf.genset),
			sn: typeof hk.sn === "string" ? hk.sn : null,
			pvStatus: num(pf.pvStatus),
			loadStatus: num(pf.loadStatus),
			gridStatus: num(pf.gridStatus),
			batteryStatus: num(pf[SPELL.batteryStatus]) ?? num(pf.batteryStatus)
		};
	}

	const invPacSum = inverters.reduce((s, inv) => s + (Number(inv.pac) || 0), 0);
	const kp = kpi.pac;
	const kpow = kpi.power;
	let pacSum = invPacSum;
	if (!pacSum && kp) {
		pacSum = kp;
	}
	if (!pacSum && kpow) {
		pacSum = kpow <= 200 ? Math.round(kpow * 1000) : Math.round(kpow);
	}
	if (!pacSum) {
		pacSum = kp ?? kpow ?? 0;
	}

	/** Serie per grafico a barre da energeStatisticsCharts (stesso payload monitor). */
	const chartBars = [];
	const ch = raw[SPELL.energyStatisticsCharts];
	if (ch && typeof ch === "object") {
		const addBar = (key, labelKey) => {
			const val = num(/** @type {Record<string, unknown>} */ (ch)[key]);
			if (val !== null && val > 0) {
				chartBars.push({ labelKey, value: val });
			}
		};
		addBar("buy", "CHART_BUY");
		addBar("sell", "CHART_SELL");
		addBar("selfUseOfPv", "CHART_SELFPV");
		addBar("consumptionOfLoad", "CHART_CONSUMPTION");
		addBar("charge", "CHART_CHARGE");
		addBar("disCharge", "CHART_DISCHARGE");
	}

	return {
		updatedAt: new Date().toISOString(),
		station: {
			id: stationId,
			name: stationName,
			currency,
			hasBattery: Boolean(info.is_stored) || inverters.some((i) => i.battery && i.battery.soc !== null),
			hasPowerflow,
			/** `isShowBattery === false` nasconde il nodo batteria (come SEMS). Se assente, default true. */
			showBattery: raw.isShowBattery !== false
		},
		kpi,
		inverters,
		powerflow,
		pacTotal: pacSum,
		chartBars,
		hasStatisticsCharts: Boolean(raw[SPELL.hasEnergyStatisticsCharts])
	};
}

module.exports = {
	normalizeSemsData,
	SPELL,
	STATUS_LABELS,
	parseSemPowerValue
};
