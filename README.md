# MMM-GoodWeSEMS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/Lumingft18/MMM-GoodWeSEMS/blob/main/LICENSE)
[![MagicMirror²](https://img.shields.io/badge/MagicMirror²-module-blue)](https://magicmirror.builders/)

**English:** Third-party module for [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror): read-only monitoring of **GoodWe** photovoltaic (or hybrid) plants through the official **SEMS** cloud portal. No inverter commands, no write operations.

**Italiano:** Modulo per MagicMirror² che mostra dati impianto **GoodWe** dal portale **SEMS** (account cloud). Solo lettura: nessun comando verso inverter o impianto.

Repository: **https://github.com/Lumingft18/MMM-GoodWeSEMS**

---

## Cosa mostra

| Area | Contenuto |
|------|-------------|
| **Flusso energia** | FV, rete, carico, batteria (se il JSON SEMS lo espone) |
| **KPI** | Produzione istantanea, energia oggi / mese / totale dove disponibile |
| **Presenza / PIR** | Poll più frequente con schermo attivo o `USER_PRESENCE: true` (es. [MMM-PIR-Sensor](https://github.com/paviro/MMM-PIR-Sensor)); poll ridotto in assenza o con modulo nascosto (`suspend`) |
| **Orario** | “Aggiornato” in ora **locale** del dispositivo (corretto fuso rispetto a ISO UTC) |

---

## Requisiti

- [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) installato  
- Account **GoodWe SEMS** (stesso login dell’app / portale)  
- Node.js **≥ 18** (allineato al core MagicMirror recente)

---

## Installazione

```bash
cd ~/MagicMirror/modules
git clone https://github.com/Lumingft18/MMM-GoodWeSEMS.git
```

Aggiungi in `config/config.js` (non committare credenziali su Git):

```javascript
{
	module: "MMM-GoodWeSEMS",
	position: "bottom_right",
	header: "GoodWe",
	config: {
		username: "tua_email_sems",
		password: "tua_password_sems",
		// powerStationId: "", // opzionale: UUID stazione SEMS; vuoto = prima disponibile
		updateInterval: 20 * 1000,
		updateIntervalScreenOn: null,
		updateIntervalScreenOff: 60 * 60 * 1000,
		listenPresenceNotification: true,
		locale: null,
		requestTimeout: 30 * 1000,
		showFlow: true,
		showKpi: true
	}
}
```

Riavvia MagicMirror (`pm2 restart` o come avvii di solito).

---

## Opzioni `config`

| Chiave | Tipo | Default | Note |
|--------|------|---------|------|
| `username` | string | — | Email account SEMS |
| `password` | string | — | Password SEMS |
| `powerStationId` | string | `""` | UUID impianto; vuoto = risoluzione automatica |
| `updateInterval` | number (ms) | `20000` | Intervallo veloce se non usi `updateIntervalScreenOn` |
| `updateIntervalScreenOn` | number / null | `null` | Override esplicito del poll veloce (min. effettivo lato server: **10 s**) |
| `updateIntervalScreenOff` | number (ms) | `3600000` | Poll lento (es. schermo spento / assenza) |
| `listenPresenceNotification` | boolean | `true` | Se `false`, ignora `USER_PRESENCE` e usa solo visibilità modulo |
| `locale` | string / null | `null` | Es. `"it-IT"` per formato ora; `null` = default browser |
| `requestTimeout` | number (ms) | `30000` | Timeout richieste HTTP al backend |
| `showFlow` | boolean | `true` | Diagramma flusso energia |
| `showKpi` | boolean | `true` | Riga KPI compatta |

---

## Test (sviluppo)

Dalla cartella del modulo:

```bash
npm install
npm test
```

---

## Sicurezza

- Non pubblicare `config.js` con password.  
- Per segnalazioni sensibili usa [Security advisories](https://github.com/Lumingft18/MMM-GoodWeSEMS/security) se abilitate nel repo.

---

## Licenza

[MIT](LICENSE).

---

## Crediti

Mantenuto da [@Lumingft18](https://github.com/Lumingft18). Contributi e issue benvenuti sul repo.
