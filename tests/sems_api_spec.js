const { flattenGatewayFactors, mapGatewayInverter } = require("../lib/semsApi.js");
const { normalizeSemsData } = require("../lib/normalize.js");

describe("SEMS+ gateway response mapping", () => {
	it("flattens grouped factor payloads", () => {
		const flat = flattenGatewayFactors([
			{ code: "ac", factors: [{ code: "pAc", data: "0.439" }, { code: "Fac", data: 50 }] },
			{ code: "MPPT-1:Vpv", data: 0 }
		]);

		expect(flat).toEqual({ "pAc": "0.439", Fac: 50, "MPPT-1:Vpv": 0 });
	});

	it("maps gateway inverter telemetry into existing view model", () => {
		const inverter = mapGatewayInverter(
			{ sn: "test-device", name: "Inverter", status: 1, modelType: "GW5K" },
			{
				pAc: "0.439",
				Temperature: "31",
				"MPPT-1:Vpv": "100",
				"MPPT-1:Ipv": "2.5",
				"MPPT-2:Vpv": "0",
				"MPPT-2:Ipv": "0"
			},
			{ proPvStatsToday: "14.4", proPvStatsTotal: "15416.2" }
		);
		const view = normalizeSemsData({
			info: { powerstation_id: "station-1", stationname: "Home" },
			kpi: { pac: inverter.invert_full.pac, total_power: inverter.invert_full.etotal },
			inverter: [inverter]
		});

		expect(view.inverters).toHaveLength(1);
		expect(view.inverters[0].pac).toBe(439);
		expect(view.inverters[0].eday).toBe(14.4);
		expect(view.inverters[0].etotal).toBe(15416.2);
		expect(view.inverters[0].temp).toBe(31);
		expect(view.inverters[0].mppt).toEqual([{ p: 250, u: 100, i: 2.5 }]);
		expect(view.pacTotal).toBe(439);
	});
});
