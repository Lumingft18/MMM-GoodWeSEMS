/**
 * Read-only GoodWe SEMS client.
 * Prefer current SEMS+ gateway. Keep legacy login and monitor endpoint as fallback.
 */
const crypto = require("node:crypto");
const https = require("node:https");
const { URL } = require("node:url");
const { parseSemPowerValue } = require("./parseSemPower.js");

const NEW_LOGIN_URL = "https://eu-semsplus.goodwe.com/web/sems/sems-user/api/v1/auth/cross-login";
const LEGACY_LOGIN_URL = "https://www.semsportal.com/api/v2/Common/CrossLogin";
const LEGACY_API_FALLBACK = "https://eu.semsportal.com/api";
const GATEWAY_API_FALLBACK = "https://eu-gateway.semsportal.com/web/sems";
const URL_PART_STATIONS = "/PowerStation/GetPowerStationIdByOwner";
const URL_PART_MONITOR = "/v3/PowerStation/GetMonitorDetailByPowerstationId";
const SUCCESS_CODES = new Set([0, "0", "00000"]);
const GATEWAY_CLIENT = "semsPlusWeb";
const WEB_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const APP_USER_AGENT = "PVMaster/2.9.5 (iPhone; iOS 17.5; Scale/3.00)";
const ALLOWED_LEGACY_PATHS = new Set([URL_PART_STATIONS, URL_PART_MONITOR]);

/**
 * @param {string} url
 * @param {string} method
 * @param {Record<string, string>} headers
 * @param {string|null} body
 * @param {number} timeoutMs
 * @returns {Promise<{statusCode:number, json:Record<string, any>}>}
 */
function requestJson (url, method, headers, body, timeoutMs) {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const req = https.request({
			method,
			hostname: u.hostname,
			path: `${u.pathname}${u.search}`,
			headers,
			rejectUnauthorized: true
		}, (res) => {
			let text = "";
			res.setEncoding("utf8");
			res.on("data", chunk => { text += chunk; });
			res.on("end", () => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					reject(new Error(`HTTP ${res.statusCode} from GoodWe`));
					return;
				}
				try {
					resolve({ statusCode: res.statusCode || 0, json: JSON.parse(text) });
				} catch (err) {
					reject(new Error(`GoodWe returned invalid JSON: ${err.message}`));
				}
			});
		});

		req.on("error", reject);
		req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${timeoutMs}ms`)));
		if (body !== null && body !== undefined) req.end(body);
		else req.end();
	});
}

function isSuccess (json) {
	return Boolean(json && SUCCESS_CODES.has(json.code));
}

function safeApiBase (candidate, fallback) {
	if (typeof candidate !== "string" || !candidate) return fallback;
	try {
		const u = new URL(candidate);
		const host = u.hostname.toLowerCase();
		if (u.protocol !== "https:" || !(host === "semsportal.com" || host.endsWith(".semsportal.com") || host === "goodwe.com" || host.endsWith(".goodwe.com"))) {
			return fallback;
		}
		return u.origin + u.pathname.replace(/\/+$/, "");
	} catch {
		return fallback;
	}
}

function flattenGatewayFactors (groups) {
	const flat = {};
	if (!Array.isArray(groups)) return flat;
	for (const group of groups) {
		const factors = Array.isArray(group?.factors) ? group.factors : [group];
		for (const factor of factors) {
			if (factor && factor.code !== undefined) flat[factor.code] = factor.data;
		}
	}
	return flat;
}

function gatewayNumber (value) {
	if (value === undefined || value === null || value === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function gatewayPowerWatts (value) {
	if (value === undefined || value === null || value === "") return null;
	const withUnit = parseSemPowerValue(value);
	if (withUnit !== null && /\(\s*k?W\s*\)/i.test(String(value))) return withUnit;
	const n = gatewayNumber(value);
	return n === null ? null : n * 1000;
}

function mapGatewayPowerflow (flow) {
	if (!flow || typeof flow !== "object") return null;
	const value = (...keys) => {
		for (const key of keys) {
			if (flow[key] !== undefined && flow[key] !== null && flow[key] !== "") return flow[key];
		}
		return undefined;
	};
	const power = (...keys) => {
		const raw = value(...keys);
		return raw === undefined ? null : gatewayPowerWatts(raw);
	};
	const mapped = {
		pv: power("pv", "PV", "pSystem"),
		grid: power("grid", "Grid", "pGrid"),
		load: power("load", "Load", "pConsum"),
		battery: power("bettery", "battery", "Bettery", "Battery", "pBat"),
		soc: gatewayNumber(value("soc", "SOC")),
		pvStatus: gatewayNumber(value("pvStatus", "PvStatus")),
		gridStatus: gatewayNumber(value("gridStatus", "GridStatus")),
		loadStatus: gatewayNumber(value("loadStatus", "LoadStatus")),
		batteryStatus: gatewayNumber(value("betteryStatus", "batteryStatus", "BetteryStatus", "BatteryStatus"))
	};
	return Object.values(mapped).some(item => item !== null) ? mapped : null;
}

function powerFromMppt (telemetry, channel) {
	const voltage = gatewayNumber(telemetry[`MPPT-${channel}:Vpv`]);
	const current = gatewayNumber(telemetry[`MPPT-${channel}:Ipv`]);
	return voltage !== null && current !== null ? voltage * current : undefined;
}

function mapGatewayInverter (device, telemetry, telecounting) {
	const sn = device.sn;
	const name = device.name || device.deviceName || sn;
	const pacKw = gatewayNumber(telemetry.pAc);
	const mpptPower1 = powerFromMppt(telemetry, 1);
	const mpptPower2 = powerFromMppt(telemetry, 2);
	const mpptPowers = [mpptPower1, mpptPower2].filter(value => value !== undefined);
	const inv = {
		sn,
		name,
		model_type: device.modelType || device.model || null,
		status: device.status,
		pac: pacKw === null ? undefined : pacKw * 1000,
		eday: gatewayNumber(telecounting.proPvStatsToday),
		etotal: gatewayNumber(telecounting.proPvStatsTotal),
		pv_power: mpptPowers.length ? mpptPowers.reduce((sum, value) => sum + value, 0) : undefined,
		tempperature: gatewayNumber(telemetry.Temperature),
		vpv1: gatewayNumber(telemetry["MPPT-1:Vpv"]),
		ipv1: gatewayNumber(telemetry["MPPT-1:Ipv"]),
		ppv1: mpptPower1,
		vpv2: gatewayNumber(telemetry["MPPT-2:Vpv"]),
		ipv2: gatewayNumber(telemetry["MPPT-2:Ipv"]),
		ppv2: mpptPower2,
		vac1: gatewayNumber(telemetry["PHASE-A:Vac"]),
		iac1: gatewayNumber(telemetry["PHASE-A:Iac"]),
		fac1: gatewayNumber(telemetry.Fac),
		vac2: gatewayNumber(telemetry["PHASE-B:Vac"]),
		iac2: gatewayNumber(telemetry["PHASE-B:Iac"]),
		fac2: gatewayNumber(telemetry.Fac),
		vac3: gatewayNumber(telemetry["PHASE-C:Vac"]),
		iac3: gatewayNumber(telemetry["PHASE-C:Iac"]),
		fac3: gatewayNumber(telemetry.Fac)
	};
	return { sn, name, status: device.status, invert_full: inv };
}

class SemsApi {
	/**
	 * @param {string} username
	 * @param {string} password
	 * @param {number} timeoutMs
	 */
	constructor (username, password, timeoutMs) {
		this.username = username;
		this.password = password;
		this.timeoutMs = timeoutMs;
		this.session = null;
		this.mode = null;
	}

	_gatewaySignature (uid, token) {
		const timestamp = Date.now();
		const digest = crypto.createHash("sha256").update(`${timestamp}@${uid}@${token}`, "utf8").digest("hex");
		return Buffer.from(`${digest}@${timestamp}`, "utf8").toString("base64");
	}

	_gatewayBase () {
		const api = safeApiBase(this.session?.api, GATEWAY_API_FALLBACK);
		const u = new URL(api);
		const pathname = u.pathname.replace(/\/+$/, "");
		return `${u.origin}${pathname.endsWith("/web/sems") ? pathname : "/web/sems"}`;
	}

	_gatewayHeaders (base) {
		const s = this.session;
		const token = {
			uid: s.uid,
			timestamp: String(s.timestamp),
			token: s.token,
			client: GATEWAY_CLIENT,
			version: "",
			language: "en",
			api: base,
			region: "eu"
		};
		return {
			"Content-Type": "application/json",
			Accept: "application/json, text/plain, */*",
			"User-Agent": APP_USER_AGENT,
			token: JSON.stringify(token),
			"x-signature": this._gatewaySignature(s.uid, s.token)
		};
	}

	async _loginNew () {
		const timestamp = Date.now();
		const signature = this._gatewaySignature("", "");
		const md5 = crypto.createHash("md5").update(this.password, "utf8").digest("hex");
		const body = JSON.stringify({
			account: this.username,
			pwd: Buffer.from(md5, "utf8").toString("base64"),
			agreement: 1,
			isChinese: false,
			isLocal: false
		});
		const headers = {
			"Content-Type": "application/json",
			Accept: "application/json, text/plain, */*",
			"User-Agent": WEB_USER_AGENT,
			Origin: "https://eu-semsplus.goodwe.com",
			Referer: "https://eu-semsplus.goodwe.com/",
			token: JSON.stringify({ uid: "", timestamp: 0, token: "", client: GATEWAY_CLIENT, version: "", language: "en" }),
			"x-signature": signature
		};
		const { json } = await requestJson(NEW_LOGIN_URL, "POST", headers, body, this.timeoutMs);
		if (!isSuccess(json)) {
			throw new Error(`SEMS+ login rejected (code=${json.code}, ${json.description || json.msg || json.message || "unknown error"})`);
		}
		const data = json.data;
		if (!data || !data.uid || !data.token) throw new Error("SEMS+ login returned no usable session");
		this.session = {
			uid: String(data.uid),
			token: String(data.token),
			timestamp: data.timestamp || timestamp,
			api: safeApiBase(json.api || data.api, GATEWAY_API_FALLBACK)
		};
		this.mode = "gateway";
	}

	async _loginLegacy () {
		const headers = {
			"Content-Type": "application/json",
			Accept: "application/json",
			"User-Agent": APP_USER_AGENT,
			token: JSON.stringify({ version: "v3.1", client: "ios", language: "en" })
		};
		const body = JSON.stringify({ account: this.username, pwd: this.password });
		const { json } = await requestJson(LEGACY_LOGIN_URL, "POST", headers, body, this.timeoutMs);
		if (!isSuccess(json)) {
			throw new Error(`Legacy SEMS login rejected (code=${json.code}, ${json.msg || json.message || "unknown error"})`);
		}
		if (!json.data || typeof json.data !== "object") throw new Error("Legacy SEMS login returned no session");
		this.session = { ...json.data, api: safeApiBase(json.api || json.data.api, LEGACY_API_FALLBACK) };
		this.mode = "legacy";
	}

	async ensureToken (renew = false) {
		if (renew) {
			this.session = null;
			this.mode = null;
		}
		if (this.session) return;
		let newLoginError;
		try {
			await this._loginNew();
			return;
		} catch (err) {
			newLoginError = err;
		}
		try {
			await this._loginLegacy();
		} catch (legacyError) {
			throw new Error(`SEMS+ login failed (${newLoginError.message}); legacy login failed (${legacyError.message})`);
		}
	}

	async _gatewayRequest (method, path, query = {}, body = undefined, retried = false) {
		await this.ensureToken();
		const base = this._gatewayBase();
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) params.set(key, String(value));
		const queryString = params.toString();
		const url = `${base}${path}${queryString ? `?${queryString}` : ""}`;
		const { json } = await requestJson(url, method, this._gatewayHeaders(base), body === undefined ? null : JSON.stringify(body), this.timeoutMs);
		if (!isSuccess(json)) {
			const msg = json.description || json.msg || json.message || "unknown error";
			if (!retried && /expired|re-?login|authoriz|token/i.test(String(msg))) {
				await this.ensureToken(true);
				if (this.mode === "gateway") return this._gatewayRequest(method, path, query, body, true);
			}
			throw new Error(`SEMS+ gateway request failed (code=${json.code}, ${msg})`);
		}
		return json.data;
	}

	async _legacyRequest (path, body, operation) {
		if (!ALLOWED_LEGACY_PATHS.has(path)) throw new Error(`SEMS: endpoint not allowed: ${path}`);
		await this.ensureToken();
		const base = String(this.session.api || LEGACY_API_FALLBACK).replace(/\/+$/, "");
		const token = { ...this.session };
		const headers = {
			"Content-Type": "application/json",
			Accept: "application/json",
			token: JSON.stringify(token),
			"User-Agent": APP_USER_AGENT
		};
		const { json } = await requestJson(`${base}${path}`, "POST", headers, body, this.timeoutMs);
		if (!isSuccess(json)) throw new Error(`${operation} failed (code=${json.code}, ${json.msg || json.message || "unknown error"})`);
		if (json.data === undefined || json.data === null) throw new Error(`${operation} returned no data`);
		return json.data;
	}

	async getPowerStationId () {
		await this.ensureToken();
		if (this.mode === "gateway") {
			const data = await this._gatewayRequest("POST", URL_PART_STATIONS, {}, {});
			if (Array.isArray(data)) {
				const station = data.find(item => item && (item.powerStationId || item.id || item.PowerStationId));
				if (station) return String(station.powerStationId || station.id || station.PowerStationId);
			}
			if (data && typeof data === "object") {
				const id = data.powerStationId || data.id || data.PowerStationId || data.powerstation_id;
				if (id) return String(id);
			}
			throw new Error("SEMS+: no station ID found for this account");
		}
		const data = await this._legacyRequest(URL_PART_STATIONS, null, "SEMS station lookup");
		if (typeof data === "string") return data;
		if (data && typeof data === "object") {
			const id = data.powerstation_id || data.powerStationId || data.id;
			if (id) return String(id);
		}
		throw new Error("SEMS: could not resolve power station ID");
	}

	async _getGatewayMonitorDetail (powerStationId) {
		const allStatus = await this._gatewayRequest("GET", "/sems-plant/api/stations/device/all-status", { stationId: powerStationId });
		let powerflow = null;
		try {
			const stationFlow = await this._gatewayRequest("GET", "/sems-plant/api/stations/flow", { stationId: powerStationId });
			powerflow = mapGatewayPowerflow(stationFlow?.powerflow || stationFlow?.powerFlow || stationFlow?.flow || stationFlow);
		} catch {
			// Station power-flow data is optional; inverter telemetry still works without it.
		}
		let basicInfo = {};
		try {
			basicInfo = await this._gatewayRequest("POST", "/sems-plant/api/portal/stations/basic/info", {}, { stationId: powerStationId }) || {};
		} catch {
			// Station labels/capacity are optional. Device telemetry remains useful without them.
		}
		const devices = [];
		for (const typeGroup of allStatus?.deviceDetailList || []) {
			for (const statusDetail of typeGroup?.statusDetailList || []) {
				const detailMap = statusDetail?.detailMap || {};
				for (const sn of Object.keys(detailMap)) {
					devices.push({ sn, deviceType: typeGroup.deviceType || "INVERTER", ...detailMap[sn] });
				}
			}
		}
		if (!devices.length) throw new Error("SEMS+ returned no inverter/device records for this station");

		const inverters = [];
		for (const device of devices) {
			const sn = device.sn;
			const deviceType = device.deviceType || "INVERTER";
			const query = { deviceType, pwId: powerStationId };
			const telemetry = flattenGatewayFactors(await this._gatewayRequest(
				"GET", `/sems-plant/api/equipments/${encodeURIComponent(sn)}/telemetry`, query
			));
			const telecounting = flattenGatewayFactors(await this._gatewayRequest(
				"GET", `/sems-plant/api/equipments/${encodeURIComponent(sn)}/telecounting`, query
			));
			inverters.push(mapGatewayInverter(device, telemetry, telecounting));
		}

		const sum = key => {
			const values = inverters.map(inv => gatewayNumber(inv.invert_full[key])).filter(value => value !== null);
			return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
		};
		return {
			info: {
				powerstation_id: powerStationId,
				stationname: basicInfo.name || "GoodWe",
				is_stored: Number(basicInfo.batteryCapacity) > 0 || Boolean(powerflow && (powerflow.soc !== null || powerflow.battery !== null))
			},
			kpi: {
				pac: sum("pac"),
				total_power: sum("etotal")
			},
			inverter: inverters,
			powerflow,
			hasPowerflow: Boolean(powerflow)
		};
	}

	async getMonitorDetail (powerStationId) {
		if (!powerStationId) throw new Error("SEMS: missing power station ID");
		await this.ensureToken();
		if (this.mode === "gateway") return this._getGatewayMonitorDetail(String(powerStationId));
		const body = JSON.stringify({ powerStationId });
		const data = await this._legacyRequest(URL_PART_MONITOR, body, "SEMS monitor detail");
		if (!data || typeof data !== "object" || !Array.isArray(data.inverter) || data.inverter.length === 0) {
			throw new Error("Legacy SEMS monitor endpoint returned no inverter data; account may require SEMS+ gateway");
		}
		return data;
	}
}

module.exports = { SemsApi, flattenGatewayFactors, mapGatewayInverter, mapGatewayPowerflow };
