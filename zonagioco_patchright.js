const path = require("node:path");
const process = require("process");
const { scrapeUrls } = require("./zonagioco_patchright_batch");
const { parseSoccerOdds } = require("./zonagioco_parser");
const { db, saveToDbase } = require("./zonagioco_db");

let timeout = setTimeout((function () {
  console.log("Zonagioco: Timeout chiusura forzata");
  return process.exit(22);
}), 60000);

const SPORTS = {
  calcio: 0,
  tennis: 1,
  basket: 2
};

// Keep this page open to establish and refresh cookies shared by all worker pages.
const BASE_URL = new URL('https://www.zonagioco.it/').origin;

const USER_DATA_DIR = path.join(__dirname, "patchright_profile");

const SCRAPER_OPTIONS = {
  baseUrl: BASE_URL,
  concurrency: 10,
  headless: false,
  jsonOutputPath: path.join(__dirname, "zonagioco_debug.json"),
  maxRetries: 2,
  allowSafetyNavigation: false,
  screenshotsBaseDirectory: path.join(__dirname, "zonagioco_screenshots"),
  screenshotsEnabledFailure: false,
  screenshotsEnabledSuccess: false,

  // Enable temporarily to overwrite zonagioco_debug.json with this run's data.
  saveJsonToFile: true,

  enableSoccer: true,
  enableTennis: false,
  enableBasket: false,
  userDataDir: USER_DATA_DIR,
};

const soccerTargets = [];
// const tennisTargets = [];
// const basketTargets = [];

async function loadTargets() {
  try {
    const sportsQuery = "select id, campionato, nazione, descrizione, 0 as sport from campionati_dinamici where book ='zonagioco' and attivo = 1";

    // 1. Fetch database targets
    const result = await db.query(sportsQuery);

    if (result.length == 0) {
      return process.exit(22);
    }

    for (let i = 0; i < result.length; i++) {
      const sport = result[i].sport;
      const campionato = result[i].campionato;
      const nazione = result[i].nazione;
      const descrizione = result[i].descrizione;

      if (sport === SPORTS.calcio && SCRAPER_OPTIONS.enableSoccer) {
        const soccerUrl = `https://sb2frontend-1-altenar2.biahosted.com/api/Widget/GetOverviewWithGroups?culture=it-IT&timezoneOffset=-120&integration=zonagioco&deviceType=1&numFormat=en-GB&countryCode=IT&eventCount=0&sportId=0&champIds=${result[i].id}&withLive=true&marketGroupId=1&marketTypeIds=1%2C18%2C10%2C29`;
        const soccerSafetyUrl = null;

        soccerTargets.push({
          url: soccerUrl,
          safetyUrl: soccerSafetyUrl,
          sport,
          campionato,
          nazione,
          descrizione,
          mercato: "1X2"
        });
      }

      // if (result[i].sport === SPORTS.tennis && SCRAPER_OPTIONS.enableTennis) {
      //   const tennisUrl = ``;
      //   const tennisSafetyUrl = null;

      //   tennisTargets.push({
      //     url: tennisUrl,
      //     safetyUrl: tennisSafetyUrl,
      //     sport,
      //     campionato,
      //     nazione,
      //     mercato: "TT"
      //   });
      // }

      // if (result[i].sport === SPORTS.basket && SCRAPER_OPTIONS.enableBasket) {
      //   const basketUrl = ``;
      //   const basketSafetyUrl = null;

      //   basketTargets.push({
      //     url: basketUrl,
      //     safetyUrl: basketSafetyUrl,
      //     sport,
      //     campionato,
      //     nazione,
      //     mercato: "TT"
      //   });
      // }
    }

    // const allTargets = [
    //   ...tennisTargets,
    //   ...basketTargets
    // ];

    // return allTargets;

    return [...soccerTargets];
  } catch (err) {
    console.error("Workflow failed:", err);
  }
}

function filterFetchedData(data) {
  // Remove invalid data
  const filteredFetchedData = data.filter(item => item.data.events && item.data.events.length > 0);

  const soccerData = [];
  // const tennisData = [];
  // const basketData = [];

  filteredFetchedData.forEach(item => {
    if (item.sport === SPORTS.calcio) {
      soccerData.push({
        sport: item.sport,
        campionato: item.campionato,
        nazione: item.nazione,
        mercato: item.mercato,
        data: item.data
      });
    }

    // if (item.sport === SPORTS.tennis) {
    //   tennisData.push({
    //     sport: item.sport,
    //     campionato: item.campionato,
    //     nazione: item.nazione,
    //     mercato: item.mercato,
    //     data: item.data
    //   });
    // }

    // if (item.sport === SPORTS.basket) {
    //   basketData.push({
    //     sport: item.sport,
    //     campionato: item.campionato,
    //     nazione: item.nazione,
    //     mercato: item.mercato,
    //     data: item.data
    //   });
    // }
  });

  return {
    soccerData,
    // tennisData,
    // basketData
  };
}

async function main() {
  const targets = await loadTargets();

  const { data, errors } = await scrapeUrls(targets, SCRAPER_OPTIONS);

  if (errors.length > 0) {
    console.error("URLs that could not be scraped:", errors);
  }

  return { data, errors };
}

if (require.main === module) {
  main()
    .then(async ({ data, errors }) => {
      console.log(errors, 'errors');
      // console.log(data, 'data');

      const { soccerData/*, tennisData, basketData */ } = filterFetchedData(data);

      const soccerOdds = parseSoccerOdds(soccerData);
      // const tennisOdds = parseTennisOdds(tennisData);
      // const basketOdds = parseBasketOdds(basketData);

      await saveToDbase({ soccerOdds/*, tennisOdds, basketOdds */ }, SCRAPER_OPTIONS);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    })
    .finally(() => {
      console.log('Fine Zonagioco');

      db.closeConnection();
      if (timeout) clearTimeout(timeout);
    });
}