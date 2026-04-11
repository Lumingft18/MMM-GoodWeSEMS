const { normalizeSemsData } = require("../lib/normalize.js");
const { parseSemPowerValue } = require("../lib/parseSemPower.js");

describe("MMM-GoodWeSEMS normalizeSemsData", () => {
	it("should map inverter list and KPI", () => {
		const raw = {
			info: {
				powerstation_id: "ps-1",
				stationname: "Test plant",
				is_stored: false,
				battery_capacity: 0
			},
			kpi: {
				pac: 250,
				power: 0.25,
				total_power: 9000,
				month_generation: 120,
				currency: "EUR"
			},
			inverter: [
				{
					invert_full: {
						sn: "SN001",
						name: "Inv A",
						model_type: "GW3000",
						status: 1,
						pac: 250,
						eday: 3.5,
						etotal: 9000,
						pv_power: 250,
						vpv1: 100,
						ipv1: 2.5
					}
				}
			],
			hasPowerflow: false
		};

		const v = normalizeSemsData(raw);
		expect(v.station.id).toBe("ps-1");
		expect(v.station.name).toBe("Test plant");
		expect(v.station.hasPowerflow).toBe(false);
		expect(v.inverters).toHaveLength(1);
		expect(v.inverters[0].sn).toBe("SN001");
		expect(v.inverters[0].statusLabel).toBe("Normal");
		expect(v.pacTotal).toBe(250);
		expect(v.kpi.totalEnergy).toBe(9000);
	});

	it("should parse powerflow when hasPowerflow (stringhe SEMS tipo …(W))", () => {
		const raw = {
			info: { powerstation_id: "p", stationname: "H", is_stored: true, isShowBattery: true },
			kpi: { currency: "EUR" },
			inverter: [],
			hasPowerflow: true,
			powerflow: {
				pv: "1200(W)",
				grid: "-300(W)",
				load: "900(W)",
				bettery: "50(W)",
				soc: 88,
				genset: "0(W)"
			},
			homKit: { sn: "HK1" }
		};

		const v = normalizeSemsData(raw);
		expect(v.station.hasPowerflow).toBe(true);
		expect(v.powerflow).not.toBeNull();
		expect(v.powerflow.pv).toBe(1200);
		expect(v.powerflow.grid).toBe(-300);
		expect(v.powerflow.load).toBe(900);
		expect(v.powerflow.battery).toBe(50);
		expect(v.powerflow.soc).toBe(88);
	});

	it("should build chartBars from energeStatisticsCharts", () => {
		const raw = {
			info: {},
			kpi: {},
			inverter: [],
			hasPowerflow: false,
			hasEnergeStatisticsCharts: true,
			energeStatisticsCharts: {
				buy: 5.12,
				sell: 23.22,
				selfUseOfPv: 7.08,
				consumptionOfLoad: 12.2
			}
		};
		const v = normalizeSemsData(raw);
		expect(v.chartBars.length).toBe(4);
		expect(v.hasStatisticsCharts).toBe(true);
	});
});

describe("parseSemPowerValue", () => {
	it("parses W and kW suffixes", () => {
		expect(parseSemPowerValue("2337(W)")).toBe(2337);
		expect(parseSemPowerValue("-1.2(kW)")).toBe(-1200);
		expect(parseSemPowerValue("")).toBeNull();
	});
});
