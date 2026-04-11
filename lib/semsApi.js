/**
 * Client API GoodWe SEMS — solo operazioni di lettura (login, elenco impianto, dettaglio monitor).
 * Non espone comandi di controllo inverter (es. SaveRemoteControlInverter).
 */
const https = require("node:https");
const { URL } = require("node:url");

const LOGIN_URL = "https://www.semsportal.com/api/v2/Common/CrossLogin";
const URL_PART_STATIONS = "/PowerStation/GetPowerStationIdByOwner";
const URL_PART_MONITOR = "/v3/PowerStation/GetMonitorDetailByPowerstationId";

/** Endpoint POST oltre al login: solo lettura dati impianto. */
const ALLOWED_DATA_PATHS = new Set([URL_PART_STATIONS, URL_PART_MONITOR]);

const DEFAULT_HEADERS_LOGIN = {
	"Content-Type": "application/json",
	Accept: "application/json",
	token: "{\"version\":\"\",\"client\":\"ios\",\"language\":\"en\"}"
};

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string|null} body
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
function httpsPost (url, headers, body, timeoutMs) {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const opts = {
			method: "POST",
			hostname: u.hostname,
			path: `${u.pathname}${u.search}`,
			headers,
			rejectUnauthorized: true
		};

		const req = https.request(opts, (res) => {
			let data = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
					return;
				}
				try {
					resolve(JSON.parse(data));
				} catch (e) {
					reject(new Error(`Invalid JSON: ${e.message}`));
				}
			});
		});

		req.on("error", reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
		});

		if (body !== null && body !== undefined) {
			req.write(body);
		}
		req.end();
	});
}

function isOkCode (code) {
	return code === 0 || code === "0";
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
		/** @type {Record<string, unknown> & { api?: string } | null} */
		this.token = null;
	}

	/**
	 * @param {boolean} renew
	 * @returns {Promise<void>}
	 */
	async ensureToken (renew) {
		if (this.token && !renew) {
			return;
		}
		const loginBody = JSON.stringify({
			account: this.username,
			pwd: this.password
		});
		const json = await httpsPost(LOGIN_URL, DEFAULT_HEADERS_LOGIN, loginBody, this.timeoutMs);
		if (!isOkCode(json.code)) {
			throw new Error(String(json.msg || json.message || "SEMS login failed"));
		}
		const tokenDict = json.data;
		if (!tokenDict || typeof tokenDict !== "object") {
			throw new Error("SEMS login: missing data");
		}
		tokenDict.api = json.api;
		this.token = /** @type {Record<string, unknown> & { api: string }} */ (tokenDict);
	}

	/**
	 * @param {string} urlPart
	 * @param {string|null} dataBody
	 * @param {string} operationName
	 * @param {number} retriesLeft
	 * @returns {Promise<any>}
	 */
	async makeApiCall (urlPart, dataBody, operationName, retriesLeft) {
		if (!ALLOWED_DATA_PATHS.has(urlPart)) {
			throw new Error(`SEMS: endpoint non consentito (solo lettura): ${urlPart}`);
		}
		await this.ensureToken(false);
		if (!this.token || typeof this.token.api !== "string") {
			throw new Error("SEMS: no API base URL");
		}
		const base = String(this.token.api).replace(/\/+$/, "");
		const part = String(urlPart).replace(/^\/+/, "");
		const url = `${base}/${part}`;
		const headers = {
			"Content-Type": "application/json",
			Accept: "application/json",
			token: JSON.stringify(this.token)
		};

		try {
			const jsonResponse = await httpsPost(url, headers, dataBody, this.timeoutMs);
			if (!isOkCode(jsonResponse.code)) {
				if (retriesLeft > 0) {
					await this.ensureToken(true);
					return this.makeApiCall(urlPart, dataBody, operationName, retriesLeft - 1);
				}
				throw new Error(
					`${operationName}: code ${jsonResponse.code} — ${jsonResponse.msg || ""}`
				);
			}
			if (jsonResponse.data === undefined || jsonResponse.data === null) {
				if (retriesLeft > 0) {
					await this.ensureToken(true);
					return this.makeApiCall(urlPart, dataBody, operationName, retriesLeft - 1);
				}
				throw new Error(`${operationName}: missing data field`);
			}
			return jsonResponse.data;
		} catch (err) {
			if (retriesLeft > 0) {
				await this.ensureToken(true);
				return this.makeApiCall(urlPart, dataBody, operationName, retriesLeft - 1);
			}
			throw err;
		}
	}

	/**
	 * @returns {Promise<string>}
	 */
	async getPowerStationId () {
		const data = await this.makeApiCall(URL_PART_STATIONS, null, "getPowerStationIds", 2);
		if (typeof data === "string") {
			return data;
		}
		if (data && typeof data === "object" && typeof data.powerstation_id === "string") {
			return data.powerstation_id;
		}
		if (data && typeof data === "object" && typeof data.id === "string") {
			return data.id;
		}
		throw new Error("SEMS: could not resolve power station id from response");
	}

	/**
	 * @param {string} powerStationId
	 * @returns {Promise<Record<string, unknown>>}
	 */
	async getMonitorDetail (powerStationId) {
		const body = JSON.stringify({ powerStationId });
		const data = await this.makeApiCall(URL_PART_MONITOR, body, "getData", 2);
		return typeof data === "object" && data !== null ? data : {};
	}
}

module.exports = { SemsApi };
