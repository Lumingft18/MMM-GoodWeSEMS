/**
 * SEMS powerflow espone spesso stringhe tipo "2337(W)", "1.2(kW)", "-817(W)" o "" offline.
 * @param {unknown} v
 * @returns {number|null} Potenza in watt, oppure null se assente / non leggibile.
 */
function parseSemPowerValue (v) {
	if (v === null || v === undefined) {
		return null;
	}
	if (typeof v === "number") {
		return Number.isFinite(v) ? v : null;
	}
	const s = String(v).trim();
	if (!s) {
		return null;
	}
	const kw = s.match(/(-?[\d.,]+)\s*\(\s*kW\s*\)/i);
	if (kw) {
		const n = parseFloat(kw[1].replace(",", "."));
		return Number.isFinite(n) ? n * 1000 : null;
	}
	const w = s.match(/(-?[\d.,]+)\s*\(\s*W\s*\)/i);
	if (w) {
		const n = parseFloat(w[1].replace(",", "."));
		return Number.isFinite(n) ? n : null;
	}
	const plain = parseFloat(s.replace(",", "."));
	return Number.isFinite(plain) ? plain : null;
}

module.exports = { parseSemPowerValue };
