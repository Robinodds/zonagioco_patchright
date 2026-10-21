const db = require("db.js");

async function saveToDbase(parsedData, scraperOptions) {
  const { soccerOdds/*, tennisOdds, basketOdds */ } = parsedData;

  if (scraperOptions.enableSoccer) {
    // Soccer market cleanup
    await db.eliminaQuote('Zona Gioco', 'odds');
    await db.eliminaQuote('Zona Gioco', 'odds_gg');
    await db.eliminaQuote('Zona Gioco', 'odds_o15');
    await db.eliminaQuote('Zona Gioco', 'odds_o25');
    await db.eliminaQuote('Zona Gioco', 'odds_o35');
    //await db.eliminaQuote('Zona Gioco','odds_rig');

    // Bulk additions
    await db.aggiungiQuoteDCBulk(soccerOdds);
    await db.aggiungiQuoteGGBulk(soccerOdds);
    await db.aggiungiQuoteO15Bulk(soccerOdds);
    await db.aggiungiQuoteO25Bulk(soccerOdds);
    await db.aggiungiQuoteO35Bulk(soccerOdds);
  }

  // if (scraperOptions.enableTennis) {
  //   // Tennis market cleanup
  //   await db.eliminaQuote('Zona Gioco', 'odds_tennis');

  //   // Bulk additions
  //   await db.aggiungiQuoteTennisVoidSetBulk(tennisOdds);
  // }

  // if (scraperOptions.enableBasket) {
  //   // Basket market cleanup
  //   await db.eliminaQuote('Zona Gioco', 'odds_b');

  //   // Bulk additions
  //   await db.aggiungiQuoteBasketBulk(basketOdds);
  // }
}

module.exports = {
  db,
  saveToDbase
};