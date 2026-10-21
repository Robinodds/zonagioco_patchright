const idBook = "42";


// Arrotonda a 2 decimali come mostra il book (half-up), non tronca.
function arrotonda(p) {
  return Math.round(p * 100) / 100;
}

function parseSoccerOdds(soccerData) {
  const results = [];

  for (let j = 0; j < soccerData.length; j++) {
    const response = soccerData[j].data;
    const eventi = response.events || [];
    const campionato = soccerData[j].campionato;
    const nazione = soccerData[j].nazione;


    // Formato relazionale: events -> marketIds -> markets -> oddIds -> odds.
    const oddsById = {};
    for (let o of response.odds || []) oddsById[o.id] = o;

    const marketsById = {};
    for (let m of response.markets || []) marketsById[m.id] = m;

    for (let i = 0; i < eventi.length; i++) {
      const evento = eventi[i];

      // Solo prematch: salta partite gia iniziate.
      if (evento.startDate && new Date(evento.startDate) < new Date()) {
        continue;
      }

      const squadre = (evento.name || '').split(' vs. ');
      if (squadre[0] === null || squadre[1] === null) {
        continue;
      }

      let index_ = squadre[0].search('U23');
      if (index_ > 0) {
        squadre[0] = squadre[0].substr(0, index_).trim();
      }

      index_ = squadre[1].search('U23');
      if (index_ > 0) {
        squadre[1] = squadre[1].substr(0, index_).trim();
      }

      index_ = squadre[0].indexOf('(');
      if (index_ > 0) {
        squadre[0] = squadre[0].substr(0, index_).trim();
      }

      index_ = squadre[1].indexOf('(');
      if (index_ > 0) {
        squadre[1] = squadre[1].substr(0, index_).trim();
      }

      const partita = {
        book: 'Zona Gioco',
        id_book: idBook,
        home: squadre[0].replace(/\s+/g, ' ').trim(),
        away: squadre[1].replace(/\s+/g, ' ').trim(),
        GG: 1,
        NG: 1,
        UN: 1,
        OV: 1,
        U1: 1,
        O1: 1,
        U3: 1,
        O3: 1,
        uno: 1,
        x: 1,
        due: 1,
        uno_x: 1,
        x_due: 1,
        uno_due: 1,
        data: '',
        campionato,
        ora: '',
        nazione,
      };

      const startingDate = new Date(evento.startDate);

      partita.data = startingDate.getFullYear() + '-' + (startingDate.getMonth() + 1) + '-' + startingDate.getDate();

      const minutes = startingDate.getMinutes().toString().padStart(2, '0');
      const hours = startingDate.getHours().toString().padStart(2, '0');

      partita.ora = `${hours}:${minutes}`;

      // Mercati dell'evento (risolti dagli id).
      const evMarkets = (evento.marketIds || []).map(id => marketsById[id]).filter(Boolean);

      // Se esiste la "1X2 Maggiorata" e' quella la quota realmente giocabile:
      // ha priorita sul 1x2 standard.
      const hasMaggiorata = evMarkets.some(m => m.typeId === 1 && /Maggiorata/i.test(m.name || ''));

      for (let mi = 0; mi < evMarkets.length; mi++) {
        const mercato = evMarkets[mi];
        const odds = (mercato.oddIds || []).map(id => oddsById[id]).filter(Boolean);

        if (mercato.name === 'U/O') {
          const extraUoOddIds = mercato.lines.filter(line => ['1.5', '2.5', '3.5'].includes(line.sv)).flatMap(line => line.oddIds);

          // if (campionato === 'Segunda Division' && partita.home === 'Granada') {
          //   console.log(evMarkets, 'markets for Granada');
          //   console.log(odds, 'odds for Granada');
          //   console.log(extraUoOddIds, 'extra U/O odd IDs for Granada');
          // }

          odds.push(...extraUoOddIds.map(id => oddsById[id]).filter(Boolean));
        }

        if (mercato.typeId === 1) {
          // 1x2 (standard o Maggiorata). Se c'e la Maggiorata, usa solo quella.
          const isMaggiorata = /Maggiorata/i.test(mercato.name || '');
          if (hasMaggiorata && !isMaggiorata) {
            continue;
          }

          for (let oi = 0; oi < odds.length; oi++) {
            const o = odds[oi];
            if (!o.price || o.oddStatus !== 0) {
              continue;
            }

            if (o.typeId === 1) {
              partita.uno = arrotonda(o.price);
            } else if (o.typeId === 2) {
              partita.x = arrotonda(o.price);
            } else if (o.typeId === 3) {
              partita.due = arrotonda(o.price);
            }
          }
        } else if (mercato.typeId === 10) {
          // Doppia chance: 9=1X, 10=12, 11=X2
          for (let oi = 0; oi < odds.length; oi++) {
            const o = odds[oi];
            if (!o.price || o.oddStatus !== 0) {
              continue;
            }

            if (o.typeId === 9) {
              partita.uno_x = arrotonda(o.price);
            } else if (o.typeId === 10) {
              partita.uno_due = arrotonda(o.price);
            } else if (o.typeId === 11) {
              partita.x_due = arrotonda(o.price);
            }
          }
        } else if (mercato.typeId === 29) {
          // Goal / Nogoal: 74=Goal, 76=Nogoal
          for (let oi = 0; oi < odds.length; oi++) {
            const o = odds[oi];
            if (!o.price || o.oddStatus !== 0) {
              continue;
            }

            if (o.typeId === 74) {
              partita.GG = arrotonda(o.price);
            } else if (o.typeId === 76) {
              partita.NG = arrotonda(o.price);
            }
          }
        } else if (mercato.typeId === 18) {
          // U/O: la linea e' in mercato.sv (1.5 / 2.5 / 3.5). 12=Over, 13=Under
          const sv = String(mercato.sv);
          for (let oi = 0; oi < odds.length; oi++) {
            const o = odds[oi];
            if (!o.price || o.oddStatus !== 0) {
              continue;
            }

            // if (sv === '2.5') {
            if (o.name.includes('2.5')) {
              if (o.typeId === 12) {
                partita.OV = arrotonda(o.price);
              } else if (o.typeId === 13) {
                partita.UN = arrotonda(o.price);
              }
              // } else if (sv === '1.5') {
            } else if (o.name.includes('1.5')) {
              if (o.typeId === 12) {
                partita.O1 = arrotonda(o.price);
              } else if (o.typeId === 13) {
                partita.U1 = arrotonda(o.price);
              }
              // } else if (sv === '3.5') {
            } else if (o.name.includes('3.5')) {
              if (o.typeId === 12) {
                partita.O3 = arrotonda(o.price);
              } else if (o.typeId === 13) {
                partita.U3 = arrotonda(o.price);
              }
            }
          }
        }
      }

      results.push(partita);
    }
  }

  return results;
}

// function parseTennisOdds(tennisData) {
//   const results = [];

//   for (let j = 0; j < tennisData.length; j++) {
//     const tournamentData = tennisData[j].data;
//     const campionato = tennisData[j].campionato;
//     const nazione = tennisData[j].nazione;

//     for (let i = 0; i < tournamentData.length; i++) {
//       const riga = tournamentData[i];

//       if (riga.games.length == 0) {
//         continue;
//       }

//       const partita = {
//         book: "Bwin",
//         home: "",
//         away: "",
//         w1: 1,
//         w2: 1,
//         data: "",
//         campionato,
//         id_book,
//         ora: "",
//         nazione
//       };

//       const giocatori = riga.participants;
//       if (giocatori.length < 2 || riga.stage !== "PreMatch") {
//         continue;
//       }

//       partita.home = giocatori[0].name.value;
//       partita.away = giocatori[1].name.value;

//       let index_ = partita.home.indexOf('(');
//       if (index_ > 0) {
//         partita.home = partita.home.slice(0, index_).trim();
//       }

//       index_ = partita.away.indexOf('(');
//       if (index_ > 0) {
//         partita.away = partita.away.slice(0, index_).trim();
//       }

//       const home_tmp = partita.home.split(" ");
//       if (home_tmp.length == 2) {
//         partita.home = home_tmp[0].charAt(0) + ". " + home_tmp[1];
//       } else if (home_tmp.length >= 3) {
//         partita.home = home_tmp[0].charAt(0) + ". " + home_tmp[home_tmp.length - 2] + " " + home_tmp[home_tmp.length - 1];
//       }

//       const away_tmp = partita.away.split(" ");
//       if (away_tmp.length == 2) {
//         partita.away = away_tmp[0].charAt(0) + ". " + away_tmp[1];
//       } else if (away_tmp.length >= 3) {
//         partita.away = away_tmp[0].charAt(0) + ". " + away_tmp[away_tmp.length - 2] + " " + away_tmp[away_tmp.length - 1];
//       }

//       const data_stringa = new Date(riga.startDate);
//       const t = new Date(data_stringa.toLocaleString());

//       const stringa_data = t.getFullYear() + "-" + (t.getMonth() + 1) + "-" + t.getDate();

//       const ore = t.getHours().toString().padStart(2, '0');
//       const minuti = t.getMinutes().toString().padStart(2, '0');

//       const ora = `${ore}:${minuti}`;

//       partita.data = stringa_data;
//       partita.ora = ora;

//       for (let games = 0; games < riga.games.length; games++) {
//         const game = riga.games[games];

//         if (game.name.value !== "Vincitore partita") {
//           continue;
//         }

//         partita.w1 = game.results[0].odds;
//         partita.w2 = game.results[1].odds;
//       }

//       results.push(partita);
//     }
//   }

//   return results;
// }

// function parseBasketOdds(basketData) {
//   const results = [];

//   for (let j = 0; j < basketData.length; j++) {
//     const tournamentData = basketData[j].data;
//     const campionato = basketData[j].campionato;
//     const nazione = basketData[j].nazione;

//     for (let i = 0; i < tournamentData.length; i++) {
//       const riga = tournamentData[i];

//       if (riga.games.length == 0) {
//         continue;
//       }

//       const partita = {
//         book: "Bwin",
//         home: "",
//         away: "",
//         w1: 1,
//         w2: 1,
//         hnd1: 1,
//         hnd2: 1,
//         data: "",
//         campionato,
//         id_book,
//         ora: "",
//         nazione
//       };

//       const squadre = riga.participants;
//       if (squadre.length < 2) {
//         continue;
//       }

//       if (campionato === "NBA" || campionato === "NBA Summer League") {
//         partita.home = squadre[1].name.value;
//         partita.away = squadre[0].name.value;
//       } else {
//         partita.home = squadre[0].name.value;
//         partita.away = squadre[1].name.value;
//       }

//       const data_stringa = new Date(riga.startDate);
//       const t = new Date(data_stringa.toLocaleString());

//       const stringa_data = t.getFullYear() + "-" + (t.getMonth() + 1) + "-" + t.getDate();

//       const ore = t.getHours().toString().padStart(2, '0');
//       const minuti = t.getMinutes().toString().padStart(2, '0');

//       const ora = `${ore}:${minuti}`;

//       partita.data = stringa_data;
//       partita.ora = ora;

//       for (let games = 0; games < riga.games.length; games++) {
//         const game = riga.games[games];

//         if (game.name.value !== "Testa a testa (vincitore)") {
//           continue;
//         }

//         if (campionato === "NBA" || campionato === "NBA Summer League") {
//           partita.w2 = game.results[0].odds;
//           partita.w1 = game.results[1].odds;
//         } else {
//           partita.w1 = game.results[0].odds;
//           partita.w2 = game.results[1].odds;
//         }
//       }

//       results.push(partita);
//     }
//   }

//   return results;
// }

module.exports = {
  parseSoccerOdds,
  // parseTennisOdds,
  // parseBasketOdds
};