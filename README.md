# MMM-GoodWeSEMS

Modulo per [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror): dati impianto **GoodWe** dal portale **SEMS** (account cloud ufficiale). Solo lettura: nessun comando verso inverter o impianto.

## Installazione

```bash
cd ~/MagicMirror/modules
git clone https://github.com/<username>/MMM-GoodWeSEMS.git
```

Aggiungi in `config/config.js`:

```javascript
{
	module: "MMM-GoodWeSEMS",
	position: "bottom_right",
	header: "GoodWe",
	config: {
		username: "email_sems",
		password: "password_sems",
		// powerStationId: "", // opzionale: UUID stazione; vuoto = prima disponibile
		updateInterval: 20 * 1000,
		updateIntervalScreenOff: 60 * 60 * 1000,
		listenPresenceNotification: true,
		locale: null,
		showFlow: true,
		showKpi: true
	}
}
```

Riavvia MagicMirror.

## Funzioni

- Flusso energia (FV / rete / carico / batteria se presente nel JSON SEMS)
- KPI e produzione
- Intervallo di poll **veloce** con schermo attivo / presenza (`USER_PRESENCE`, es. MMM-PIR-Sensor) e **lento** in assenza o con modulo nascosto
- Orario ultimo aggiornamento in ora locale del dispositivo

## Test

```bash
npm install
npm test
```

## Licenza

MIT (vedi `LICENSE`).
